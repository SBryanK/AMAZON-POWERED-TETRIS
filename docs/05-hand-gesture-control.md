
# Chapter 5 — Hand-Gesture Control Pipeline

The gesture pipeline is the feature that makes this project
interesting. It's also the one with the most subtle behaviour, so this
chapter walks the entire pipeline end-to-end and explains *why* each
stage exists.

## 5.1 Full pipeline diagram

```
 (1) Webcam              (2) JPEG encode      (3) WebSocket     (4) MediaPipe
 ┌─────────┐             ┌───────────────┐    ┌──────────┐      ┌──────────┐
 │ <video> │─ 30-60 fps ─▶│ offscreen     │─ 15 fps ─▶│  /ws    │─▶│ Hand-    │
 │ MediaStr│             │ <canvas>      │           │(FastAPI) │  │ Landmark │
 └─────────┘             │ quality=0.5   │           └────┬─────┘  │ er       │
                         │ mirror-flip   │                │        └────┬─────┘
                         └───────────────┘                │             │ tip (x,y)
                                                          │             ▼
 (8) React engine       (7) Edge-trigger   (6) WebSocket  │      (5) ZONE_RECTS
 ┌────────────┐         ┌──────────────┐   ┌──────────┐   │      ┌──────────┐
 │ Tetris.jsx │◄── call ─│ GamePage.jsx│◄──│ onmessage│◄──┘      │ Debounce │◄─┐
 │ moveLeft() │         │ state       │   │ {zone}   │           │ (2 fr)   │  │
 │ rotate()   │         │ machine     │   └──────────┘           └────┬─────┘  │
 │ softDrop(B)│         └──────────────┘                              │        │
 └────────────┘                                                       └────────┘
```

### Glossary used in this chapter

- **Frame**: a single webcam picture (640 × 480 usually).
- **Zone**: one of `LEFT / RIGHT / UP / DOWN` — a rectangular region
  of the image. `null` means "finger not in any zone".
- **Raw zone**: the zone MediaPipe says the finger is in *right now*.
- **Confirmed zone**: the raw zone only after it has been seen
  `ZONE_CONFIRM_FRAMES` times in a row.
- **Edge trigger**: a state transition (`prev → current` differ). We
  fire an action **only on the edge**, not continuously.

## 5.2 Client side — `HandControlOverlay`

```js
const CAPTURE_INTERVAL_MS = 66      // ≈ 15 fps

useEffect(() => {
  navigator.mediaDevices
    .getUserMedia({video: {width: 640, height: 480}, audio: false})
    .then(stream => { videoRef.current.srcObject = stream; videoRef.current.play() })
    .catch(err => setCameraError(err.name))

  return () => streamRef.current?.getTracks().forEach(t => t.stop())
}, [])

useEffect(() => {
  if (!ws) return
  if (!canvasRef.current) canvasRef.current = document.createElement('canvas')

  const id = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return
    const v = videoRef.current
    if (!v?.videoWidth) return

    const c = canvasRef.current
    if (c.width !== v.videoWidth)  c.width  = v.videoWidth
    if (c.height !== v.videoHeight) c.height = v.videoHeight
    const ctx = c.getContext('2d')
    ctx.setTransform(1, 0, 0, 1, 0, 0)     // reset transforms every tick
    ctx.translate(c.width, 0); ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0, c.width, c.height)

    try { ws.send(JSON.stringify({frame: c.toDataURL('image/jpeg', 0.5)})) }
    catch {}
  }, CAPTURE_INTERVAL_MS)
  return () => clearInterval(id)
}, [ws])
```

**Why 15 fps?**  The human hand can't realistically move faster than
~5 zone transitions per second. Doubling that gives us headroom. Going
higher would saturate the WebSocket and blow through MediaPipe's budget.

**Why `ctx.setTransform(…)` every frame?**  Previously the code did
`translate + scale` once; subsequent frames accumulated the transform
and shifted the image off-screen. Resetting the matrix every tick is
cheap and robust.

**Why `quality = 0.5`?**  A 640×480 JPEG at 0.5 is about 30-50 KB.
MediaPipe still detects the finger reliably; going lower hurts
detection confidence.

## 5.3 Server side — `/ws` frame processing

For the full code see
[`backend/main.py`](../backend/main.py#L227) (or
[chapter 2 §2.9](./02-backend.md#29-websocket-handler-ws)).

Per frame:

1. **Decode** base64 → JPEG bytes → OpenCV `BGR` → `RGB` ndarray.
2. **Detect** — `HandLandmarker.detect()` returns up to `num_hands = 1`
   sets of 21 landmarks. We take landmark **#8** (index finger tip)
   because:
   - Pointing with the index finger is the most natural "click" gesture.
   - Landmark 8 is stable across hand poses (palms, fists, half-closed
     hands).
3. **Zone lookup** — scale normalized `(tip.x, tip.y)` to pixel coords,
   iterate `ZONE_RECTS`:
   ```python
   ZONE_RECTS = {
     "LEFT":  (0.00, 0.25, 0.30, 0.75),
     "RIGHT": (0.70, 0.25, 1.00, 0.75),
     "UP":    (0.35, 0.00, 0.65, 0.25),
     "DOWN":  (0.35, 0.75, 0.65, 1.00),
   }
   ```
4. **Debounce** — require the same `raw_zone` for
   `ZONE_CONFIRM_FRAMES = 2` consecutive frames before setting
   `confirmed_zone`. `raw_zone = None` unconfirms immediately, which
   gives the client a fast "finger left" signal so the edge trigger
   can re-arm.

Cost of debouncing: `2 × 66 ms = 132 ms` extra latency. Below the ~200
ms human reaction threshold, so it feels instantaneous.

## 5.4 Edge-triggered state machine in `GamePage.jsx`

This is the part the user specifically asked for (and fixed): gestures
must behave like a **keyboard**, not a continuous joystick.

```js
// GamePage.jsx
const COMMAND_THROTTLE_MS = 90

const prevZoneRef      = useRef(null)
const lastEdgeTimeRef  = useRef(0)

socket.onmessage = (evt) => {
  if (gameOverRef.current || pausedRef.current) {
    tetrisRef.current?.setSoftDropping(false)
    return
  }
  const {zone: z, button: b} = JSON.parse(evt.data)
  const zone = (z !== undefined ? z : b) || null
  setActiveZone(zone)

  const prev   = prevZoneRef.current
  const tetris = tetrisRef.current

  // --- Held-key semantics for DOWN ------------------------------
  if (zone === 'DOWN' && prev !== 'DOWN')      tetris.setSoftDropping(true)
  else if (zone !== 'DOWN' && prev === 'DOWN') tetris.setSoftDropping(false)

  // --- Edge-trigger for LEFT / RIGHT / UP -----------------------
  if (zone && zone !== prev && zone !== 'DOWN') {
    const now = Date.now()
    if (now - lastEdgeTimeRef.current >= COMMAND_THROTTLE_MS) {
      lastEdgeTimeRef.current = now
      if      (zone === 'LEFT')  tetris.moveLeft()
      else if (zone === 'RIGHT') tetris.moveRight()
      else if (zone === 'UP')    tetris.rotate()
    }
  }

  prevZoneRef.current = zone
}
```

Rules this enforces:

| Situation | Desired behaviour | How we achieve it |
|-----------|-------------------|-------------------|
| Finger hovering in `LEFT` for 2 seconds | Exactly **one** move-left | The edge trigger fires when `prev !== 'LEFT'`; subsequent frames have `prev === 'LEFT'` and do nothing. |
| Finger enters `LEFT`, leaves, re-enters | **Two** move-lefts (one per entry) | Each re-entry is a fresh edge. |
| Finger moves from `LEFT` straight to `RIGHT` without leaving the zone-space (e.g. sliding across mid-zone) | One move-left, one move-right | The intermediate `null` unconfirms, so we see `LEFT → null → RIGHT`. |
| Finger enters `DOWN` and stays | Soft-drop continuously, until finger leaves | The held-key semantics above. |
| Pause button pressed while hand is in `DOWN` | Soft-drop must release **immediately** and not resume on unpause | See §5.5 below. |

### Why the 90 ms throttle too?

It's a **belt-and-suspenders** safety. Even with the server-side
debounce, network hiccups could deliver two rapid `null → LEFT → null
→ LEFT` transitions that represent a single physical entry. 90 ms is
faster than any real human can re-enter, but still long enough to reject
flicker.

## 5.5 Pause / game-over safety

Three places release the held soft-drop so it can't leak across states:

1. In `onmessage`, before doing anything, check `pausedRef`/`gameOverRef`
   and early-return.
2. Dedicated effect:
   ```js
   useEffect(() => {
     if (paused || gameOver) tetrisRef.current?.setSoftDropping(false)
   }, [paused, gameOver])
   ```
3. `Tetris.setSoftDropping(active)` itself guards:
   ```js
   if (active && (gameOver || gameOverExternal)) return
   ```

All three are necessary because any one of them alone misses an edge
case (e.g. the WebSocket message arrives *before* the React effect
runs after pause).

## 5.6 Camera teardown

```js
return () => {
  streamRef.current?.getTracks().forEach(t => t.stop())
  streamRef.current = null
}
```

Without this, the browser keeps the camera active after navigating
away from `/game`, and on many laptops the webcam indicator LED stays
on — a privacy smell. Always stop tracks.

## 5.7 Degradation matrix — what happens when something fails?

| Failure | Symptom | How the app copes |
|---------|---------|-------------------|
| Backend not reachable | 🔴 WS badge | `setTimeout(connect, 2000)` reconnect loop; keyboard/touch still work |
| Backend has no MediaPipe | WS replies `{error: …}` and closes | Same as above — keyboard/touch still work |
| User denies camera | `cameraError` state set | Red banner shows; WS stays open but receives nothing (server just times out on frames) |
| Hand leaves the webcam frame | `raw_zone = None` | After 1 frame `confirmed_zone` is `null`, edges re-arm |
| Finger wags wildly between zones | Server-side 2-frame debounce absorbs it | Only stable zones are reported |
| WebSocket closes during active soft-drop | We latch off | `onclose` calls `setSoftDropping(false)` |

---

Next: [**Chapter 6 — Sound system**](./06-sound-system.md).
