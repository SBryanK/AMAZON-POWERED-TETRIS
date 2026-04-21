
# Chapter 9 — Bugfix History

This chapter documents every non-trivial bug fixed in the repo, *why*
it manifested, the root cause, and the design decision behind the fix.
It's ordered chronologically so you can follow the narrative.

## §1 — Python 3.14 / pydantic v1 crash on startup

**Symptom:** `python -m uvicorn main:app` exited with

```
pydantic.errors.ConfigError: unable to infer type for attribute "name"
```

**Root cause:** The project originally pinned `pydantic==1.10.5` and
`fastapi==0.95.2`. On Python 3.14 (which became the default on the
author's Mac) pydantic v1's `ModelField.infer()` fails because the
type-inference code relies on internals that changed in CPython.

**Fix:** Upgrade to pydantic v2 + fastapi ≥0.115 + update
`@validator` → `@field_validator` (v2 API). See
[requirements.txt](../backend/requirements.txt):

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
opencv-python>=4.10.0
mediapipe>=0.10.21
```

And `ScoreItem`:

```python
# Before (pydantic v1)
@validator('name')
def validate_name(cls, v): ...

# After (pydantic v2)
@field_validator('name')
@classmethod
def validate_name(cls, v): ...
```

**Trade-off:** Newer pydantic is ~2× faster but requires the `@classmethod`
decorator explicitly, which is easy to forget.

## §2 — Gesture control was overly sensitive / continuous

**Symptom:** Hovering the hand near a control box for half a second
made the piece zip across the board. Players complained it "felt like a
broken joystick, not keyboard Tetris."

**Root cause:** The backend continuously streamed `{zone: …}` and the
frontend's `onmessage` fired the move action **on every message**. So
15 messages/sec × a 500 ms hover = 7 consecutive move-lefts.

**Fix (two layers):**

1. **Backend debounce** — require the same zone for 2 consecutive
   frames before reporting it. Zone → `None` unconfirms instantly so
   the client re-arms quickly. See
   [main.py `ZONE_CONFIRM_FRAMES`](../backend/main.py).
2. **Frontend edge trigger** — in `GamePage.jsx`, keep a `prevZoneRef`
   and fire the discrete actions (LEFT/RIGHT/UP) **only on the
   transition** from "not in this zone" to "in this zone". DOWN retains
   held-key semantics because soft-drop is inherently continuous.

**Design reasoning:** We deliberately kept DOWN as held-key because
that's how keyboard Tetris works — holding ↓ drops fast; releasing
stops. The other actions fire once per keystroke. Mirroring that
mental model makes gestures feel familiar.

Also added a safety floor (`COMMAND_THROTTLE_MS = 90`) as belt-and-
suspenders against network flicker.

## §3 — Tetris board overlapping the pause/sound buttons

**Symptom:** On typical laptop monitors (16:9), the 20-row tall board
rendered over the top of the `⏸` and `🔊` buttons at the bottom of the
panel.

**Root cause:** `StyledStage.js` sized cells by **width**:

```js
// old
--cell-size: calc(25vw / ${props => props.width});
```

On a wide display, `25vw / 10 = 2.5vw`, and 20 × 2.5vw = **50 vw tall**
— which, on a 16:9 screen (width ÷ height ≈ 1.78), translates to
~89 vh. The panel container only reserved ~80 vh for the board, so
the overflow landed on top of the buttons.

**Fix — sized by viewport height instead:**

```js
// new
--cell-size: min(4vh, calc(25vw / ${props => props.width}));
width: max-content;     // never horizontally overflow
max-width: 100%;
```

And in [`GamePage.css`](../frontend/src/pages/GamePage.css):

```css
.tetris-panel {
  display: flex;
  flex-direction: column;
  justify-content: space-between;   /* was flex-start */
}
.panel-buttons {
  flex-shrink: 0;                   /* don't let the board steal space */
}
```

**Why `min(4vh, calc(25vw/width))` and not just `4vh`?**

On ultra-tall narrow displays (portrait kiosks), 4vh could exceed the
panel's width ÷ 10 and cause horizontal overflow. The `min(...)` picks
the smaller of the two — the board fits both dimensions.

## §4 — Mute/unmute had ~10-second lag and didn't resume music

Two separate issues that surfaced together when muting during the
game-over fanfare:

**Symptom A:** Click 🔊 during an active game → *music keeps playing*
for up to 10 seconds (the length of one melody pass). Line-clear SFX
also kept ringing out.

**Symptom B:** After muting once, un-muting later did not bring music
back — silence for the rest of the game.

**Root cause A:** The old `toggle()` only flipped `this.enabled`. But
Web Audio schedules oscillators on its own sample-accurate clock; once
`osc.start(t)` is called, the oscillator will play at time `t`
regardless of whether `this.enabled` is true. So the already-scheduled
notes of the current melody pass played to completion.

**Root cause B:** `toggle()` called `stopMusic()` on mute but never
called `startMusic()` on un-mute.

**Fix — redesigned SoundManager:**

1. **Single `masterGain` node** that every oscillator routes through.
   Mute is now a `gain.linearRampToValueAtTime(0, now + 0.01)` — ~10 ms
   crossfade. ✅ Instantaneous audibility change.
2. **`_activeSources: Set<Oscillator>`** — every scheduled oscillator
   registers on construction and deregisters in `onended`. Mute iterates
   this set and calls `osc.stop()` on everything. ✅ In-flight phrases
   cut off immediately.
3. **Split state**: `_wantsMusic` (game wants music) vs. `musicPlaying`
   (a loop is actually running). `toggle(true)` now checks
   `_wantsMusic` and restarts the loop if appropriate. ✅ Un-mute
   resumes music.
4. **`cancelScheduledValues`** in `toggle()` so rapid toggles don't
   leave stale ramps on `masterGain.gain`.

## §5 — Scoreboard rate-limit memory leak

**Symptom:** Running the backend for days caused `_rate_store` to grow
unbounded — one entry per distinct client IP, never cleaned up.

**Root cause:** `_check_rate_limit` only kept recent timestamps per
key but never removed **empty keys**. Each unique IP added a dict
entry forever.

**Fix:**

```python
if len(_rate_store) > 1024:
    for ip in list(_rate_store.keys()):
        if not _rate_store[ip] or now - _rate_store[ip][-1] > RATE_LIMIT_WINDOW:
            _rate_store.pop(ip, None)
```

Once the dict reaches 1024 entries, scan and purge any that are empty
or whose latest timestamp is older than the window. Amortized cost is
O(1) per request for the common path; O(n) very occasionally.

## §6 — HandControlOverlay transform accumulated each frame

**Symptom:** After ~30 seconds the overlay showed the user progressively
shifted left until completely off-screen.

**Root cause:**

```js
// old
ctx.translate(canvas.width, 0)
ctx.scale(-1, 1)
ctx.drawImage(video, 0, 0, …)
```

Canvas transforms are **cumulative**. Each frame was translating
another `canvas.width` pixels and flipping again. Net effect: a slow
drift and flickering between mirrored/non-mirrored.

**Fix:** Reset the transform matrix at the start of each frame:

```js
ctx.setTransform(1, 0, 0, 1, 0, 0)     // identity
ctx.translate(canvas.width, 0)
ctx.scale(-1, 1)
ctx.drawImage(video, 0, 0, …)
```

## §7 — Camera LED stayed on after navigating away

**Symptom:** Leaving `/game` back to `/` kept the webcam active;
laptop's camera light stayed on.

**Root cause:** The original overlay never called
`stream.getTracks().forEach(t => t.stop())` on unmount. The
`MediaStream` lives on the `<video>` element, and losing the React
reference doesn't release it — only explicit `.stop()` does.

**Fix:** Store the stream in a ref and stop tracks in the effect's
cleanup:

```js
return () => {
  streamRef.current?.getTracks().forEach(t => t.stop())
  streamRef.current = null
}
```

## §8 — `document.createElement('canvas')` at module level leaked across StrictMode renders

**Symptom:** In React StrictMode dev builds, the canvas ref ended up
stale after the double-mount, causing dropped frames.

**Root cause:**

```js
// old
const canvasRef = useRef(document.createElement('canvas'))
```

`useRef` initializes lazily per *instance*, but creating a DOM
element in the initializer meant the element was created, destroyed on
unmount, and re-initialized to a stale reference on re-mount (because
StrictMode intentionally double-runs effects in dev).

**Fix:** Lazy-create inside the effect:

```js
useEffect(() => {
  if (!canvasRef.current) canvasRef.current = document.createElement('canvas')
  …
}, [ws])
```

## §9 — WebSocket close while `DOWN` was held left soft-drop latched on

**Symptom:** Disconnecting the backend during a soft-drop gesture kept
the piece dropping forever.

**Root cause:** `onmessage` was the only thing that called
`setSoftDropping(false)` (on the `DOWN → !DOWN` edge); if the socket
died we never received that edge.

**Fix:** `onclose` handler + a dedicated `pause/game-over` effect both
release the drop:

```js
socket.onclose = () => {
  tetrisRef.current?.setSoftDropping(false)
  prevZoneRef.current = null
  …
}

useEffect(() => {
  if (paused || gameOver) tetrisRef.current?.setSoftDropping(false)
}, [paused, gameOver])
```

Plus a guard inside `Tetris.setSoftDropping` itself:

```js
if (active && (gameOver || gameOverExternal)) return
```

Three independent releases = no way to leak state. The cost of
redundancy is negligible.

## §10 — Dual piece-spawn race between `useStage` and `Tetris.jsx`

**Symptom:** Occasionally after a line clear two pieces spawned
overlapping at the top — one from `useStage`'s `resetPlayer()` and
another from `Tetris.jsx`'s `spawnPiece(nextShape)`.

**Root cause:** Both `useStage` and the piece-landed `useEffect` in
`Tetris.jsx` tried to reset the player. Depending on effect order on
a given render, sometimes both ran.

**Fix:** `useStage` no longer calls `resetPlayer()`; `Tetris.jsx`
owns spawning entirely. We made this explicit with a code comment:

```js
// useStage.js
if (player.collided) {
  // Don't call resetPlayer() here — Tetris.jsx manages piece spawning
  // via its own nextShape queue to avoid the dual-spawning race condition.
  return sweepRows(newStage)
}
```

## §11 — Misc resilience improvements (no reported user symptom)

- `/ws` now catches `json.JSONDecodeError` and bad base64 rather than
  crashing the coroutine and dropping the connection. Any malformed
  frame is answered with the last-known confirmed zone, so the client's
  state doesn't go stale.
- `detector.close()` is called in a `finally` block so the TFLite
  interpreter's native resources are always released.
- `.gitignore` updated to exclude `venv/`, `.venv/`, `env/`, `ENV/` —
  a 100 MB venv was narrowly avoided from being committed.

---

Next: [**Chapter 10 — Glossary**](./10-glossary.md).
