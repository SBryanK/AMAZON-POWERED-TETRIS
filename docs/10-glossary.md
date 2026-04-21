
# Chapter 10 — Glossary

Concise definitions for every non-obvious term used in this codebase
and its documentation.

## Tetris terms

**Tetromino**
The four-cell shape that falls. There are 7 standard tetrominoes:
`I`, `J`, `L`, `O`, `S`, `T`, `Z`. Defined in
[`tetrominos.js`](../frontend/src/game/tetrominos.js).

**Stage / playfield / board**
The grid the pieces fall onto. Standard size 10 columns × 20 rows
(defined as `STAGE_WIDTH` / `STAGE_HEIGHT` in
[`gameHelpers.js`](../frontend/src/game/gameHelpers.js)).

**Soft drop**
The piece descends faster than the normal gravity speed while you
hold the ↓ key (or keep your hand in the `DOWN` zone). Controlled by
`SOFT_DROP_FACTOR = 0.3` in `Tetris.jsx`.

**Hard drop**
Instantly teleports the piece to its landing position and locks it
in. Triggered by Space on keyboard or a tap on touch. Always plays the
`hardDrop()` SFX.

**Ghost piece**
The translucent silhouette showing exactly where the current piece
will land. Computed by `getGhostY()` in `Tetris.jsx` every render.

**Hold / hold slot**
The C key (or the `holdPiece()` imperative handle) swaps the current
piece with whatever is in the hold slot, or stores the current piece
if the slot is empty. You can only use it **once per piece** — the
`canHold` flag re-enables on the next piece's landing.

**NES scoring**
Points per line-clear table from the original Nintendo Tetris:
- 1 line  → 40
- 2 lines → 100
- 3 lines → 300
- 4 lines (*Tetris*) → 1200

All multiplied by `(level + 1)`. Defined in `useGameStatus.js`.

**Level**
A difficulty counter that rises every 10 cleared lines. Higher level =
faster drops (`NORMAL_DROP - level * SPEED_INCREMENT`) = more points
per line-clear.

**Topping out**
Game-over condition — a new piece spawns at row `y < 1`, meaning the
stack has reached the top. Detected in the `player.collided` effect in
`Tetris.jsx`.

**Wall-kick**
When rotating a piece next to a wall would clip it into the wall, try
shifting it horizontally by 1, -2, 3, -4 … until it fits or we give up.
Implemented in `playerRotate()` in `usePlayer.js`.

## Gesture control terms

**Zone**
One of 4 rectangular regions on the webcam frame — `LEFT`, `RIGHT`,
`UP`, `DOWN` — plus the implicit 5th state `null` (finger not in any
zone). Coordinates in `ZONE_RECTS` as fractions of image width/height.

**Raw zone**
What MediaPipe says the finger is in *this exact frame*.

**Confirmed zone**
A raw zone that has been seen for `ZONE_CONFIRM_FRAMES = 2`
consecutive frames. Only confirmed zones are reported to the frontend.

**Edge trigger / edge-triggered action**
An action that fires exactly once on a state transition (the "edge"),
not continuously while the state persists. LEFT, RIGHT, UP moves are
edge-triggered on zone entry.

**Held-key semantics**
The opposite: keeps doing something while the state persists. DOWN
uses held-key semantics because soft-drop is inherently continuous.

**Landmark #8**
MediaPipe's hand landmark numbered 8 corresponds to the **tip of the
index finger**. There are 21 landmarks per hand; the index fingertip
is the most stable reference point for pointing gestures.

**Debounce**
Rejecting rapid state changes to prevent flicker. Two debounces exist:
- **Server-side** (2-frame confirmation) absorbs single-frame false
  positives.
- **Client-side** (`COMMAND_THROTTLE_MS = 90`) is a belt-and-suspenders
  safety against network-introduced flicker.

## Web Audio terms

**AudioContext**
The root node of the Web Audio graph. Browsers require a user gesture
(click/keypress) before it plays; we create it lazily.

**OscillatorNode**
A primitive that produces a periodic waveform at a given frequency
(`square`, `sawtooth`, `triangle`, `sine`). We synthesize every sound
from these.

**GainNode**
A volume multiplier. Used two ways: per-oscillator for envelope shaping
(attack + decay) and as a single `masterGain` shared by everything.

**Master gain / master gain node**
The single `GainNode` all sounds route through on their way to the
speakers. Setting its gain to 0 silences everything instantly; setting
it back to 1 restores playback. This is how mute/unmute works.

**Envelope**
How a tone's volume changes over its duration. We use an "attack-
decay" shape: set the gain to peak at note-start, then exponentially
ramp to near-zero over the note's duration. The `exponentialRampToValueAtTime`
call in `_playTone` is what does this.

**Scheduling / AudioContext clock**
Web Audio has its own sample-accurate clock (`ctx.currentTime`).
`osc.start(t)` and `osc.stop(t)` accept times on this clock. Unlike
setTimeout jitter, scheduled audio is precise to the sample.

## Backend / infra terms

**Lifespan event**
The modern FastAPI startup/shutdown hook. Replaces the deprecated
`@app.on_event("startup")`.

**Pydantic v2**
The current major version of pydantic, used for request-body validation.
Breaks some v1 patterns (e.g. `@validator` → `@field_validator`).

**ASGI server**
Async equivalent of WSGI. Uvicorn is the ASGI server we run FastAPI on.

**Sliding-window rate limiter**
A rate-limiter that keeps a list of recent timestamps and counts how
many are within the last N seconds. Our `_check_rate_limit` uses this
pattern, in-memory, keyed by client IP.

**CORS (Cross-Origin Resource Sharing)**
Browser security mechanism; the backend must explicitly list which
origins are allowed to call it. Configured via `CORS_ORIGINS` env
variable.

**WebSocket**
Persistent bidirectional TCP connection over HTTP(S). We use it for the
gesture pipeline because sending 15 POST requests/sec would be
prohibitively expensive.

**MediaPipe Tasks API vs Solutions API**
- **Tasks** (new, ≥0.10.14): uses `.task` model files, designed for
  multi-platform / long-term support.
- **Solutions** (legacy): the older `mp.solutions.hands.Hands` class,
  still works but receives no new features.

Our backend supports both; it picks Tasks if available.

**ECS Fargate**
AWS's serverless container runtime. You define a task (set of
containers), and AWS runs it for you without you managing EC2 instances.

**ALB (Application Load Balancer)**
An L7 HTTP(S) load balancer in AWS. Our CloudFormation stack puts one
in front of the Fargate task.

**ECR (Elastic Container Registry)**
AWS's Docker image registry. You push your built images here and
reference them in your task definition.

## React / frontend terms

**`useImperativeHandle`**
A hook that lets a component expose a **method-style API** to its
parent (via `ref`), instead of only props. Used in `Tetris.jsx` so
`GamePage` can call `tetrisRef.current.moveLeft()` etc.

**`useRef` vs `useState`**
- `useRef` — mutable container; changing `.current` does **not**
  re-render.
- `useState` — setting the state value **does** re-render.

We use refs for anything we want to read-across-renders but never
display (timers, previous values, counters).

**StrictMode**
React's dev-only double-mount of components to help you catch effects
that misbehave on re-mount. Our codebase is StrictMode-safe (the
canvas-ref bug in [chapter 9 §8](./09-bugfix-history.md) is the only
one we had).

**styled-components**
CSS-in-JS library. Lets us write CSS inside JS with prop-driven
values (e.g. `grid-template-columns: repeat(${props => props.width}, var(--cell-size))`).

**Vite**
Modern build tool; faster than Webpack/Create-React-App in dev. We use
it for both dev-server HMR and production build (`vite build`).

**HMR (Hot Module Replacement)**
When you save a file in dev, only the changed module is re-loaded in
the browser — game state is preserved. A huge productivity win vs. a
full page reload.

---

Back to the [docs index](./README.md).
