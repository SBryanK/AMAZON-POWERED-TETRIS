
# Chapter 4 — Frontend Pages & UI

The frontend has **only two pages**, wired up in
[`src/App.jsx`](../frontend/src/App.jsx):

```jsx
<Routes>
  <Route path="/"     element={<HomePage />} />
  <Route path="/game" element={<GamePage />} />
</Routes>
```

## 4.1 `HomePage` — name entry, mode selection, leaderboard

File: [`frontend/src/pages/HomePage.jsx`](../frontend/src/pages/HomePage.jsx)

Responsibilities:

1. **Name input**  (`<input maxLength={20}>`)
   - Trims whitespace, rejects empty / `"anonymous"` (matches backend
     validation).
   - Stored in `localStorage.playerName` so the game page can read it
     when posting the score.
2. **Mode selector** — three buttons backed by a constant:
   ```js
   const GAME_MODES = [
     {id: 'timed',   label: '⏱ Time Attack', desc: '180 seconds — highest score wins'},
     {id: 'endless', label: '♾️ Endless',    desc: 'Classic Tetris — play until you top out'},
     {id: 'sprint',  label: '🏃 Sprint',     desc: 'Clear 40 lines as fast as possible'},
   ]
   ```
   Navigation fires `navigate(/game?mode=${id})` — the mode is just a
   query-string param.
3. **Leaderboard** — `axios.get(config.scoreboardEndpoint)` on mount,
   shows the top 10 with gold/silver/bronze medals.
4. **Instruction modal** — `?` icon opens a `InstructionModal` component
   (not critical; explains controls).

## 4.2 `GamePage` — the game controller

File: [`frontend/src/pages/GamePage.jsx`](../frontend/src/pages/GamePage.jsx)
(~384 lines — the largest component, but each responsibility is
isolated.)

### 4.2.1 Layout (JSX structure)

```jsx
<div className="game-container">
  <div className="tetris-panel">
    <Tetris ref={tetrisRef} … />
    <div className="panel-buttons">
      <button className="pause-btn">⏸/▶</button>
      <button className="sound-btn">🔊/🔇</button>
    </div>
  </div>

  <div className="right-container">
    <div className="top-bar">           {/* mode, score, hold, next, time, lines, WS status */}
    </div>
    <div className="camera-panel">
      <HandControlOverlay ws={ws} activeZone={activeZone} />
    </div>
  </div>

  {paused    && <div className="pause-overlay">…</div>}
  {gameOver  && <div className="game-over-overlay">…</div>}
  {showStats && <div className="game-over-overlay">…stats…</div>}
</div>
```

### 4.2.2 State

| State | Purpose |
|-------|---------|
| `timeLeft`, `elapsed` | Countdown (timed mode) / stopwatch (other modes) |
| `score`, `stats` | Updated via callbacks from `<Tetris>` |
| `gameOver` | Terminal state, freezes the engine |
| `paused` | Soft stop; music halts, drop interval pauses |
| `soundEnabled` | Mirrors `soundManager.enabled` for button UI |
| `ws`, `wsConnected` | The WebSocket instance + badge state |
| `nextShape`, `holdShape` | Previews drawn in `NextPieceView` |
| `activeZone` | Currently-touched gesture box (drives the overlay highlight) |
| `lineClearFlash`, `showStats` | Purely cosmetic |

`useRef` is used for values that don't need to trigger re-renders:
`tetrisRef`, `gameOverRef`, `pausedRef`, `prevZoneRef`,
`lastEdgeTimeRef`, `touchStartRef`.

### 4.2.3 Timer effect

```js
useEffect(() => {
  if (gameOver || paused) return
  const timer = setInterval(() => {
    setElapsed(e => e + 1)
    if (gameMode === 'timed') {
      setTimeLeft(t => {
        if (t <= 1) { setGameOver(true); return 0 }
        return t - 1
      })
    }
  }, 1000)
  return () => clearInterval(timer)
}, [gameOver, paused, gameMode])
```

- Re-created whenever pause/game-over/mode changes, which inherently
  stops the timer during pause.
- In `timed` mode, hitting zero flips `gameOver = true`.

### 4.2.4 Sprint mode end condition

```js
useEffect(() => {
  if (gameMode === 'sprint' && stats.linesCleared >= 40 && !gameOver) {
    setGameOver(true)
  }
}, [stats.linesCleared, gameMode, gameOver])
```

### 4.2.5 Keyboard handler

```js
useEffect(() => {
  const handleKeyDown = (e) => {
    if ((e.key === 'p' || e.key === 'P') && !gameOver) {
      setPaused(p => !p); return
    }
    if (gameOver || paused || !tetrisRef.current) return
    switch (e.key) {
      case 'ArrowLeft':  tetrisRef.current.moveLeft();             break
      case 'ArrowRight': tetrisRef.current.moveRight();            break
      case 'ArrowUp':    tetrisRef.current.rotate();               break
      case 'ArrowDown':  tetrisRef.current.setSoftDropping(true);  break
      case ' ':          tetrisRef.current.hardDrop();             break
      case 'c': case 'C': tetrisRef.current.holdPiece();           break
      case 'm': case 'M': toggleSound();                           break
    }
  }
  const handleKeyUp = (e) => {
    if (e.key === 'ArrowDown') tetrisRef.current?.setSoftDropping(false)
  }
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('keyup',   handleKeyUp)
  return () => {
    document.removeEventListener('keydown', handleKeyDown)
    document.removeEventListener('keyup',   handleKeyUp)
  }
}, [gameOver, paused])
```

### 4.2.6 Touch handler (mobile)

```js
// tap  = hard drop
// swipe horizontal  = move
// swipe up          = rotate
// swipe down        = soft drop
```
Thresholds: ≥30 px for direction, <10 px + <200 ms for a tap.

### 4.2.7 WebSocket handler

See [chapter 5 §5.3](./05-hand-gesture-control.md#53-edge-triggered-state-machine-in-gamepagejsx)
for the full edge-triggered state machine. Short summary here:

```js
const prevZoneRef = useRef(null)
socket.onmessage = (evt) => {
  const {zone} = JSON.parse(evt.data)
  setActiveZone(zone)
  const prev = prevZoneRef.current
  // Held-key semantics for DOWN
  if (zone === 'DOWN' && prev !== 'DOWN') tetrisRef.current.setSoftDropping(true)
  else if (zone !== 'DOWN' && prev === 'DOWN') tetrisRef.current.setSoftDropping(false)
  // Edge-trigger for LEFT / RIGHT / UP
  if (zone && zone !== prev && zone !== 'DOWN') {
    if (Date.now() - lastEdgeTimeRef.current >= 90) {
      lastEdgeTimeRef.current = Date.now()
      if      (zone === 'LEFT')  tetrisRef.current.moveLeft()
      else if (zone === 'RIGHT') tetrisRef.current.moveRight()
      else if (zone === 'UP')    tetrisRef.current.rotate()
    }
  }
  prevZoneRef.current = zone
}
```

### 4.2.8 Auto-reconnect

```js
socket.onclose = () => {
  setWsConnected(false)
  setActiveZone(null)
  tetrisRef.current?.setSoftDropping(false)   // release stuck drops
  prevZoneRef.current = null
  if (!gameOverRef.current) setTimeout(connectWebSocket, 2000)
}
```

The 2-second delay stops us from hammering the backend in a tight loop
if the server is down.

### 4.2.9 Post-game flow

```js
useEffect(() => {
  if (gameOver) {
    soundManager.stopMusic()
    const nm = localStorage.getItem('playerName') || 'Anonymous'
    axios.post(config.scoreboardEndpoint, {name: nm, score}).catch(() => {})
  }
}, [gameOver, score])
```

The `.catch(() => {})` is intentional — we don't want to spam the user
if the backend rate-limited them.

### 4.2.10 `playAgain()`

```js
const playAgain = () => {
  setGameOver(false)
  setShowStats(false)
  setStats({piecesPlaced: 0, tetrisCount: 0, linesCleared: 0})
  setHoldShape(null)
  setElapsed(0)
  if (TOTAL_TIME) setTimeLeft(TOTAL_TIME)
  tetrisRef.current.startGame()
  setScore(0)
}
```

This is essentially `startGame()` for the React layer.

## 4.3 `HandControlOverlay`

File:
[`frontend/src/components/HandControlOverlay.jsx`](../frontend/src/components/HandControlOverlay.jsx)

Responsibilities:

1. **Camera acquisition**  `navigator.mediaDevices.getUserMedia()`. The
   stream is kept in a ref and explicitly stopped on unmount (the
   webcam LED staying on was a bug in the original code).
2. **Frame loop** — 15 fps (`CAPTURE_INTERVAL_MS = 66`) offscreen
   canvas:
   ```js
   ctx.setTransform(1, 0, 0, 1, 0, 0)     // reset prior transforms
   ctx.translate(canvas.width, 0)
   ctx.scale(-1, 1)                       // mirror horizontally so it
                                          // feels like a "selfie cam"
   ctx.drawImage(video, 0, 0, …)
   ws.send(JSON.stringify({frame: canvas.toDataURL('image/jpeg', 0.5)}))
   ```
3. **Overlay boxes** — four `<div>`s positioned with CSS percentages
   that **match the backend `ZONE_RECTS` exactly**. Each div gets an
   `.active` class when `activeZone === 'LEFT' | …` to light up, giving
   the player visual feedback.
4. **Error UX** — if `getUserMedia` fails (permission denied, no camera)
   we show a little red banner.

### Why an offscreen canvas, not the `<video>` directly?

`WebSocket.send()` doesn't take media-element references; we need a
JPEG *blob*. The cheapest way to get one is to paint the video frame
into a canvas and call `toDataURL('image/jpeg', 0.5)` (the 0.5 quality
factor halves the payload size with imperceptible loss).

## 4.4 `NextPieceView`

File:
[`frontend/src/components/NextPieceView.jsx`](../frontend/src/components/NextPieceView.jsx)

Tiny component — given a `shape` (2-D array from `TETROMINOS`), render
a 4 × 4-ish mini-grid with the filled cells coloured. Used in the top
bar for both "Hold" and "Next" previews.

## 4.5 `InstructionModal`

Simple modal that explains the controls; opened from the `?` icon on
the home page.

## 4.6 CSS layout decisions worth knowing

### 4.6.1 `.tetris-panel` is `flex-direction: column`, `justify-content: space-between`

This guarantees the `.panel-buttons` row (pause + sound) is always
anchored to the bottom, so the Tetris stage — which shrinks/grows with
viewport height — can never cover it.

### 4.6.2 `.panel-buttons` has `flex-shrink: 0`

The buttons have a reserved height; flex can't steal pixels from them
to give to the stage. This was the root cause of the overlap bug (see
chapter 9).

### 4.6.3 `.sound-btn.muted` + `aria-pressed={!soundEnabled}`

When muted, the button gets a red border so the state is obvious at a
glance, and screen-readers can tell the button is "pressed" (= muted).

### 4.6.4 `.line-flash` animation

When the board clears any number of rows, we briefly add
`lineClearFlash` to `game-container` for 300 ms, and a CSS animation
pulses a subtle brightness over the whole board.

---

Next: [**Chapter 5 — Hand-gesture control pipeline**](./05-hand-gesture-control.md).
