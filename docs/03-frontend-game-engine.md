
# Chapter 3 — Frontend game engine

The engine lives entirely in [`frontend/src/game/`](../frontend/src/game).
It's a classic React-hooks Tetris (originally derived from the popular
"useTetris" codebase) but with custom additions for hold piece, ghost
piece, NES scoring, and sound hooks.

```
game/
├── Tetris.jsx              ← Orchestrator (state machine + sounds)
├── SoundManager.js         ← Audio engine (chapter 6)
├── gameHelpers.js          ← STAGE_WIDTH/HEIGHT, createStage, checkCollision
├── tetrominos.js           ← Piece shapes and colours
├── hooks/
│   ├── usePlayer.js        ← Current falling piece (pos, rotation, collision flag)
│   ├── useStage.js         ← 20×10 board, sweeps full rows
│   ├── useGameStatus.js    ← Score, rows cleared, level (NES table)
│   └── useInterval.js      ← Declarative setInterval hook
└── components/
    ├── Stage.jsx           ← Renders grid + ghost piece
    ├── Cell.jsx            ← Single 1-cell block
    ├── styles/
    │   ├── StyledStage.js       ← CSS grid, responsive cell size
    │   ├── StyledCell.js        ← Colour + border per cell type
    │   └── StyledTetris.js      ← Panel wrapper
    └── …legacy Display / NextPieceDisplay / StartButton (unused now)
```

## 3.1 Constants

```js
// gameHelpers.js
export const STAGE_WIDTH  = 10
export const STAGE_HEIGHT = 20
```

Classic Tetris dimensions. The board is always 10 wide × 20 tall.

## 3.2 `tetrominos.js` — piece definitions

```js
export const TETROMINOS = {
  0: { shape: [[0]], color: '0, 0, 0' },
  I: { shape: [[0,'I',0,0],[0,'I',0,0],[0,'I',0,0],[0,'I',0,0]], color: '80, 227, 230' },
  J: { shape: [[0,'J',0],[0,'J',0],['J','J',0]],                color: '36, 95, 223'  },
  L: { shape: [[0,'L',0],[0,'L',0],[0,'L','L']],                color: '223, 173, 36' },
  O: { shape: [['O','O'],['O','O']],                            color: '223, 217, 36' },
  S: { shape: [[0,'S','S'],['S','S',0],[0,0,0]],                color: '48, 211, 56'  },
  T: { shape: [[0,0,0],['T','T','T'],[0,'T',0]],                color: '132, 61, 198' },
  Z: { shape: [['Z','Z',0],[0,'Z','Z'],[0,0,0]],                color: '227, 78, 78'  },
}

export const randomTetromino = () => {
  const tetrominos = 'IJLOSTZ'
  return TETROMINOS[tetrominos[Math.floor(Math.random() * tetrominos.length)]]
}
```

- The `0` piece is a "null" piece representing empty cells.
- **Colour format is `'r, g, b'`** (no `rgb()` prefix) so the styled-cell
  can compose `rgb(${color})` / `rgba(${color}, 0.4)` freely.
- `randomTetromino()` uses *uniform random*, **not the 7-bag** that
  modern Tetris guidelines specify. Future improvement: implement a
  7-bag to reduce long droughts of the I-piece.

## 3.3 `gameHelpers.js` — grid & collision

### 3.3.1 `createStage()`

```js
export const createStage = () =>
  Array.from(Array(STAGE_HEIGHT), () => Array(STAGE_WIDTH).fill([0, 'clear']))
```

Returns a 20×10 matrix. Each cell is a tuple:
`[typeTag, state]` where state is `'clear'` (empty / transient) or
`'merged'` (permanently part of the stack).

### 3.3.2 `checkCollision(player, stage, {x: moveX, y: moveY})`

```js
for (let y = 0; y < player.tetromino.length; y += 1) {
  for (let x = 0; x < player.tetromino[y].length; x += 1) {
    if (player.tetromino[y][x] !== 0) {
      if (
        !stage[y + player.pos.y + moveY] ||                       // out of bottom
        !stage[y + player.pos.y + moveY][x + player.pos.x + moveX] || // out left/right
        stage[y + player.pos.y + moveY][x + player.pos.x + moveX][1] !== 'clear'
      ) return true
    }
  }
  return false
}
```

For every *filled* cell of the tetromino, check the target cell on the
stage is both **in-bounds** and `'clear'` (not already merged).

## 3.4 `usePlayer()` — current piece

Shape:
```js
player = {
  pos:       { x, y },              // top-left of the tetromino on the stage
  tetromino: 2D array,
  collided:  boolean,
}
```

**Key operations:**

| Function | Purpose |
|----------|---------|
| `setPlayer(...)` | Direct setter — used by `Tetris.jsx` when spawning / holding |
| `updatePlayerPos({x, y, collided})` | Delta move; `x/y` are added to current pos |
| `resetPlayer()` | Reset to top-center with a random tetromino (unused now — spawning is managed by `Tetris.jsx` to avoid the dual-spawn race condition) |
| `playerRotate(stage, dir)` | Rotate with wall-kick |

**Wall-kick algorithm** (simplified from SRS):

```js
const playerRotate = (stage, dir) => {
  const cloned = JSON.parse(JSON.stringify(player))
  cloned.tetromino = rotate(cloned.tetromino, dir)
  const pos = cloned.pos.x
  let offset = 1
  while (checkCollision(cloned, stage, {x: 0, y: 0})) {
    cloned.pos.x += offset
    offset = -(offset + (offset > 0 ? 1 : -1))      // 1, -2, 3, -4 …
    if (offset > cloned.tetromino[0].length) {       // give up
      rotate(cloned.tetromino, -dir)
      cloned.pos.x = pos
      return
    }
  }
  setPlayer(cloned)
}
```

It tries progressively wider horizontal offsets (1, -2, 3, -4…) until
the rotated piece fits or we exceed the piece's width, in which case
the rotation is cancelled. This handles rotating next to walls or other
pieces without clipping into them.

## 3.5 `useStage(player, resetPlayer)` — board state

The stage effect runs **every time `player` changes** (i.e. every tick):

1. **Flush transient cells** — reset any `'clear'` cell back to `[0, 'clear']`.
2. **Draw the current piece** onto the clone. The piece's cells are
   tagged either `'clear'` (mid-flight) or `'merged'` (just landed).
3. **If `player.collided`** — sweep full rows:
   ```js
   newStage.reduce((acc, row) => {
     if (row.findIndex(cell => cell[0] === 0) === -1) {
       // full row
       setRowsCleared(prev => prev + 1)
       acc.unshift(Array(newStage[0].length).fill([0, 'clear']))
     } else {
       acc.push(row)
     }
     return acc
   }, [])
   ```
   A full row is pushed to the *top* of the accumulator, so everything
   above it slides down naturally.

The hook returns `[stage, setStage, rowsCleared]`. `rowsCleared` is
watched by `useGameStatus` and by the sound code in `Tetris.jsx`.

### Why doesn't `useStage` call `resetPlayer()` itself?

Originally the hook handled spawning, but we wanted a **queue**
(`nextShape`) so the UI can display the next piece. `Tetris.jsx` now
manages spawning explicitly via `spawnPiece(nextShape)` to avoid the
dual-spawn race where both hooks raced to reset the player.

## 3.6 `useGameStatus(rowsCleared)` — NES scoring & level

```js
const LINE_POINTS = [0, 40, 100, 300, 1200]

useEffect(() => {
  if (rowsCleared > 0) {
    const points = LINE_POINTS[Math.min(rowsCleared, 4)] || LINE_POINTS[4]
    setScore(prev => prev + points * (level + 1))
    setRows(prev => prev + rowsCleared)
  }
}, [rowsCleared])
```

- Points **multiply with level**: at level 5 a single line is 40 × 6 =
  240 points, a Tetris (4 lines) is 1200 × 6 = **7200 points**. Big
  rewards for clearing quickly encourage multi-line plays.
- Level is incremented in `Tetris.jsx` once every 10 lines:
  ```js
  if (rows > (level + 1) * 10) setLevel(prev => prev + 1)
  ```

## 3.7 `useInterval(callback, delay)` — Dan Abramov's hook

Lets us `setInterval` declaratively while keeping the latest callback
closure via a ref, so the interval picks up state changes every tick:

```js
useEffect(() => { savedCallback.current = callback }, [callback])
useEffect(() => {
  if (delay !== null) {
    const id = setInterval(() => savedCallback.current(), delay)
    return () => clearInterval(id)
  }
}, [delay])
```

Setting `delay = null` **pauses** the interval, which is how we pause
the game.

## 3.8 `Tetris.jsx` — the orchestrator

### 3.8.1 Tunables

```js
const NORMAL_DROP       = 850   // ms/row at level 0
const SOFT_DROP_FACTOR  = 0.3   // 30 % of normal drop time while holding ↓
const MIN_DROP_TIME     = 100   // never faster than 100 ms/row
const SPEED_INCREMENT   = 50    // shave 50 ms/row per level
```

Effective drop speed:
`max(NORMAL_DROP - level*SPEED_INCREMENT, MIN_DROP_TIME)`, multiplied
by `SOFT_DROP_FACTOR` while soft-dropping.

### 3.8.2 Imperative handle (the public API of the component)

```js
useImperativeHandle(ref, () => ({
  startGame()          { /* reset + seed music */ },
  moveLeft()           { move({keyCode: 37});  soundManager.move()   },
  moveRight()          { move({keyCode: 39});  soundManager.move()   },
  rotate()             { move({keyCode: 38});  soundManager.rotate() },
  setSoftDropping(a)   { /* guarded to not latch while paused */ },
  hardDrop()           { performHardDrop() },
  holdPiece()          { performHold() },
  getStats()           { return {...statsRef.current} },
}))
```

This is how `GamePage` (and the gesture pipeline, keyboard, touch)
invoke game actions without having to re-implement them.

### 3.8.3 Hold piece

```js
function performHold() {
  if (gameOver || gameOverExternal || !canHold) return
  soundManager.hold()
  const current = player.tetromino
  if (holdShape) {
    spawnPiece(holdShape)
  } else {
    spawnPiece(nextShape)
    const newNext = randomTetromino().shape
    setNextShape(newNext)
    onNextShapeUpdate?.(newNext)
  }
  setHoldShape(current)
  onHoldShapeUpdate?.(current)
  setCanHold(false)         // re-enabled when the next piece lands
}
```

- **`canHold` gate** prevents infinite hold-swap abuse. You can only
  hold once per piece.
- If the hold slot is empty, the hold takes the *next* piece out of the
  queue and you get a fresh one.

### 3.8.4 Hard drop

```js
function performHardDrop() {
  if (gameOver || gameOverExternal) return
  soundManager.hardDrop()
  let d = 0
  while (!checkCollision(player, stage, {x: 0, y: d + 1})) d += 1
  updatePlayerPos({x: 0, y: d, collided: true})
}
```

Walks straight down until the next step would collide, then lands the
piece. The `collided: true` triggers the `useStage` sweep and the
next-piece spawn in `useEffect(() => ..., [player.collided])`.

### 3.8.5 Ghost piece

```js
const getGhostY = () => {
  let ghostY = 0
  const maxDrop = 25
  while (ghostY < maxDrop && !checkCollision(player, stage, {x: 0, y: ghostY + 1})) {
    ghostY += 1
  }
  return player.pos.y + ghostY
}
```

A pure function re-computed each render. `Stage.jsx` uses `ghostY` to
draw a translucent copy of the piece at the landing position (see
`StyledCell.js`: ghost cells get an `opacity: 0.3`-ish treatment).

### 3.8.6 Piece-lands lifecycle

```js
useEffect(() => {
  if (player.collided) {
    if (player.pos.y < 1) {                // Topped out
      setGameOver(true)
      setDropTime(null)
      soundManager.stopMusic()
      soundManager.gameOver()
      onGameOver?.()
    } else {
      statsRef.current.piecesPlaced += 1
      setCanHold(true)                      // Re-enable hold
      spawnPiece(nextShape)
      const newNext = randomTetromino().shape
      setNextShape(newNext)
      onNextShapeUpdate?.(newNext)
      onStatsUpdate?.({...statsRef.current})
    }
  }
}, [player.collided])
```

This is the central "transition" effect. Key side-effects:

- **Game-over detection** — if the new piece spawned at `y < 1` it
  means the board is topped out.
- **Stats update** — piecesPlaced counter is exposed to `GamePage` via
  the `onStatsUpdate` callback and later shown in the stats overlay.
- **`canHold = true`** — a fresh piece resets the hold flag.

### 3.8.7 Sound hooks

```js
// line clear SFX + stats
useEffect(() => {
  if (rowsCleared > 0 && rowsCleared !== prevRowsClearedRef.current) {
    soundManager.lineClear(rowsCleared)
    statsRef.current.linesCleared += rowsCleared
    if (rowsCleared >= 4) statsRef.current.tetrisCount += 1
    onStatsUpdate?.({...statsRef.current})
  }
  prevRowsClearedRef.current = rowsCleared
}, [rowsCleared])

// level-up jingle
useEffect(() => {
  if (level > prevLevelRef.current) soundManager.levelUp()
  prevLevelRef.current = level
}, [level])
```

The `prev…Ref` dance is because `rowsCleared` can stay at e.g. `3` for
a few renders — we only want to play the SFX on the *transition*.

### 3.8.8 Pause/resume music

```js
useEffect(() => {
  if (gameOverExternal && !gameOver) soundManager.stopMusic()
  else if (!gameOverExternal && !gameOver && dropTime) soundManager.startMusic()
}, [gameOverExternal])
```

`gameOverExternal` is the union of "paused by user" | "game ended by
timer" — in both cases music stops; resumption only happens on genuine
unpause.

## 3.9 Rendering — `Stage.jsx` + `StyledStage.js`

```js
<StyledStage width={stage[0].length} height={stage.length}>
  {displayStage.map((row, y) =>
    row.map((cell, x) => (
      <Cell key={`${x}-${y}`} type={cell[0]} isGhost={cell[1] === 'ghost'} />
    ))
  )}
</StyledStage>
```

`StyledStage` uses CSS Grid with a carefully-sized `--cell-size` custom
property:

```js
--cell-size: min(4vh, calc(25vw / ${props => props.width}));

grid-template-rows:    repeat(${props => props.height}, var(--cell-size));
grid-template-columns: repeat(${props => props.width},  var(--cell-size));
width: max-content;      // never grow beyond the columns
max-width: 100%;
```

**Why this formula?** It's the fix for the layout-overlap bug
documented in [chapter 9 §3](./09-bugfix-history.md). In one sentence:
prior versions sized cells by *width*, which meant 20 rows vertically
exceeded the available panel height on normal aspect ratios and landed
on top of the pause/sound buttons. The new formula caps the cell size
at 4 vh so the 20 rows always fit vertically, and uses `width:
max-content` so the stage never horizontally bleeds past its column count.

---

Next: [**Chapter 4 — Pages & UI**](./04-frontend-pages-and-ui.md).
