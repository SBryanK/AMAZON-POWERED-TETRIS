
# Chapter 6 — Sound System (`SoundManager.js`)

Everything you hear — background music, move SFX, line-clear jingle,
game-over riff — is **procedurally synthesized** in the browser using
the **Web Audio API**. There are *no* audio files shipped with the app.

File: [`frontend/src/game/SoundManager.js`](../frontend/src/game/SoundManager.js)

## 6.1 Audio graph

```
 ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌────────────┐
 │Oscillator│──▶│   Gain   │──▶│            │──▶│            │
 │  (tone)  │   │(envelope)│   │            │   │            │
 └──────────┘   └──────────┘   │ masterGain │──▶│destination │
 ┌──────────┐   ┌──────────┐   │(mute ramp) │   │ (speakers) │
 │Oscillator│──▶│   Gain   │──▶│            │   │            │
 │ (melody) │   │(envelope)│   │            │   │            │
 └──────────┘   └──────────┘   └────────────┘   └────────────┘
```

- Every individual tone has its own `OscillatorNode` + `GainNode` for
  envelope shaping (attack + exponential decay).
- All envelope gains route into **one** shared `masterGain`, which
  routes into the `destination`.
- Muting is implemented by ramping `masterGain.gain` to 0 over 10 ms
  (a linear ramp so the transition is smooth, no pop/click).

## 6.2 State machine

```js
class SoundManager {
  ctx: AudioContext | null       // lazily created on first sound
  masterGain: GainNode | null    // lazily created with the context
  enabled: boolean               // mute state (true = audible)
  volume: number                 // 0-1
  _activeSources: Set<Oscillator>// every live oscillator (for mute cancel)
  _musicTimer: setTimeout handle // the loop scheduler
  musicPlaying: boolean          // a loop is scheduled
  _wantsMusic: boolean           // game wants music (may or may not be enabled)
}
```

**Why separate `musicPlaying` from `_wantsMusic`?**

`_wantsMusic` tracks "the game has called `startMusic()` and not yet
called `stopMusic()`". `musicPlaying` tracks "there's actually an active
loop scheduling notes". When the user mutes, `musicPlaying` goes false
(we cancel scheduled notes) but `_wantsMusic` stays true — so when they
unmute, we know to restart the loop.

Without this distinction (the original code only had `musicPlaying`),
muting once silenced the music permanently for the rest of the game.

## 6.3 Lazy AudioContext

```js
_ensureContext() {
  if (!this.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return false
    this.ctx = new AC()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.enabled ? 1 : 0
    this.masterGain.connect(this.ctx.destination)
  }
  if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
  return true
}
```

- Browsers block audio until a user gesture (click, keypress); creating
  the context immediately can result in a suspended context that never
  resumes. So we create it lazily on the first call to `_playTone` /
  `_playNotes` / `startMusic`, which are all triggered by user actions.
- `ctx.resume()` is a no-op if the context is already running; calling
  it every time is harmless and heals any suspended state.

## 6.4 Oscillator tracking

```js
_track(osc) {
  this._activeSources.add(osc)
  osc.onended = () => this._activeSources.delete(osc)
}

_stopAllSources() {
  const sources = Array.from(this._activeSources)
  this._activeSources.clear()
  for (const osc of sources) {
    try { osc.stop() }      catch {}
    try { osc.disconnect()} catch {}
  }
}
```

Without `_stopAllSources`, muting wouldn't silence a long phrase (e.g.
the 8-note Korobeiniki theme) that was *already scheduled* to play —
Web Audio schedules on its own clock and ignores `this.enabled`. By
tracking every live oscillator we can actively stop them.

## 6.5 Sound-effect API

| Method | Freq/duration profile | Triggered by |
|--------|----------------------|--------------|
| `move()` | 200 Hz square, 50 ms | left/right movement |
| `rotate()` | 400 Hz square, 80 ms | rotation |
| `softDrop()` | 150 Hz triangle, 40 ms | *(unused — might add later)* |
| `hardDrop()` | 300→150→80 Hz sawtooth | space / instant drop |
| `lineClear(n)` | 2-note for 1, 3-note for 2-3, 4-note for Tetris | line clears |
| `hold()` | 350 → 500 Hz triangle | C / hold |
| `levelUp()` | 440/554/659/880 Hz arpeggio | level increment |
| `gameOver()` | 440/415/392/370 Hz sawtooth descent | topping out |

### Example — `_playTone`

```js
_playTone(freq, duration, type = 'square', vol = null) {
  if (!this.enabled) return
  if (!this._ensureContext()) return
  const osc  = this.ctx.createOscillator()
  const gain = this.ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
  gain.gain.setValueAtTime((vol ?? this.volume) * 0.5, this.ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration)
  osc.connect(gain); gain.connect(this.masterGain)
  osc.start(); osc.stop(this.ctx.currentTime + duration)
  this._track(osc)
}
```

The `exponentialRampToValueAtTime(0.001, ...)` is the envelope — a
quick percussive decay. Web Audio won't ramp to exactly 0 (exponential
ramps require positive target), hence 0.001.

## 6.6 Background music — `startMusic()`

The melody is a simplified Korobeiniki (famous "Tetris Theme") phrase
of 40 notes totalling ~16 s. Each call to `playLoop`:

```js
const playLoop = () => {
  if (!this.musicPlaying || !this.enabled || !this.ctx) return
  let t = this.ctx.currentTime
  melody.forEach(([freq, dur]) => {
    if (freq === 0) { t += dur; return }    // rest
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(this.volume * 0.15, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9)
    osc.connect(gain); gain.connect(this.masterGain)
    osc.start(t); osc.stop(t + dur)
    this._track(osc)
    t += dur
  })
  this._musicTimer = setTimeout(playLoop, totalDuration * 1000)
}
```

- All 40 notes are scheduled upfront on Web Audio's rock-solid clock;
  the setTimeout only re-invokes `playLoop` to schedule the *next* pass.
  This means note timing is unaffected by setTimeout jitter.
- Music volume is `0.15 × this.volume` — deliberately quieter than SFX
  so the beeps and line-clears stay prominent.

## 6.7 `toggle()` — the fixed mute/unmute

```js
toggle() {
  this.enabled = !this.enabled
  if (!this._ensureContext()) return this.enabled
  const now = this.ctx.currentTime
  this.masterGain.gain.cancelScheduledValues(now)
  this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
  this.masterGain.gain.linearRampToValueAtTime(this.enabled ? 1 : 0, now + 0.01)

  if (!this.enabled) {
    this.musicPlaying = false
    if (this._musicTimer) { clearTimeout(this._musicTimer); this._musicTimer = null }
    this._stopAllSources()
  } else if (this._wantsMusic && !this.musicPlaying) {
    this.startMusic()
  }
  return this.enabled
}
```

Three crucial actions:

1. **Gain ramp** — fade the master gain from its *current* value to
   0/1 over 10 ms, avoiding the audible click that a `setValueAtTime`
   jump would produce. `cancelScheduledValues` prevents a collision if
   you toggle twice in rapid succession.
2. **Hard stop** (when muting) — kills all scheduled notes via
   `_stopAllSources`. This is what makes mute actually *immediate*
   even mid-phrase.
3. **Auto-resume** (when unmuting) — if the game is still active
   (`_wantsMusic`) we restart the melody loop from the top. Without
   this, muting once killed the music for the rest of the session.

## 6.8 Lifecycle integration with `Tetris.jsx`

| Game event | `SoundManager` call |
|------------|---------------------|
| `startGame()` | `startMusic()` |
| Level up | `levelUp()` |
| Line cleared | `lineClear(n)` |
| Piece lands | *(no SFX; too busy)* |
| Piece rotates | `rotate()` |
| Piece moves L/R | `move()` |
| Hard drop | `hardDrop()` |
| Hold piece | `hold()` |
| Game over | `stopMusic()` + `gameOver()` |
| Paused | `stopMusic()` (via `GamePage` effect) |
| Unpaused | `startMusic()` (via `Tetris` effect) |

## 6.9 Future improvements (out of scope)

- **Volume slider** — currently hard-coded; a slider could call
  `soundManager.setVolume(v)`.
- **Stereo panning** — movement left/right could pan the `move()` SFX.
- **Sample-based music** — swap the procedural melody for a short OGG
  loop if you don't care about zero-byte assets.

---

Next: [**Chapter 7 — Deployment**](./07-deployment.md).
