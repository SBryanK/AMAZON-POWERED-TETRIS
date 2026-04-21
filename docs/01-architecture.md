
# Chapter 1 — Architecture Overview

## 1.1 The 30-second pitch

APT is a **browser-based Tetris** you control with your **hand** (via
webcam) or with a keyboard/touchscreen if you prefer. The game logic and
rendering run 100 % in the browser (React); a Python backend is only
needed for two things:

1. **Hand detection** — the browser streams JPEG frames over WebSocket;
   the backend runs MediaPipe on each frame and tells the browser which
   "control zone" the player's index finger is inside (`LEFT` / `RIGHT` /
   `UP` / `DOWN` / `null`).
2. **High-score persistence** — a tiny REST API (`GET /scoreboard`,
   `POST /scoreboard`) backed by SQLite.

Everything else — the Tetris engine, scoring, sound, ghost piece, hold
piece, animations — lives in the frontend.

## 1.2 High-level diagram

```
 ┌───────────────────────── Browser (React) ──────────────────────────┐
 │                                                                    │
 │   ┌────────────┐     keydown / pointer                             │
 │   │  Keyboard  │────────────────┐                                  │
 │   │ / Touch    │                │                                  │
 │   └────────────┘                ▼                                  │
 │                         ┌───────────────┐                          │
 │                         │  GamePage.jsx │                          │
 │   ┌──────────────────┐  │  (controller) │   ref                    │
 │   │ HandControl-     │  │               │◄────┐                    │
 │   │ Overlay.jsx      │  └───────┬───────┘     │                    │
 │   │  • <video> cam   │          │             │                    │
 │   │  • offscreen     │          │ tetrisRef   │                    │
 │   │    <canvas>      │          ▼             │                    │
 │   │  • 15 fps JPEG   │   ┌─────────────┐    ┌─┴────────┐           │
 │   │    encoder       │   │ Tetris.jsx  │    │ Sound-   │           │
 │   └────────┬─────────┘   │ (engine)    │◄──►│ Manager  │           │
 │            │             │ hooks: use- │    │ (Web     │           │
 │            │             │ Player,     │    │ Audio)   │           │
 │            │ WebSocket   │ useStage,   │    └──────────┘           │
 │            │ "frame"     │ useGame-    │                           │
 │            │             │ Status,     │                           │
 │            │             │ useInterval │                           │
 │            │             └─────────────┘                           │
 │            │                    ▲                                  │
 │            │             score  │ ws.onmessage                     │
 │            │             update │ ({zone})                         │
 └────────────┼────────────────────┼──────────────────────────────────┘
              │                    │
              │ base64 JPEG        │ JSON {zone, button}
              ▼                    │
 ┌──────────────────────── FastAPI (:8000) ────────────────────────────┐
 │                                                                    │
 │   /ws  ─────────▶  MediaPipe HandLandmarker ─▶ _detect_zone()      │
 │                    (Tasks API or legacy)      ZONE_RECTS           │
 │                                    │                               │
 │                                    ▼                               │
 │                        debounce (2 consecutive frames)             │
 │                                    │                               │
 │   GET /scoreboard   ◄──┐           ▼                               │
 │   POST /scoreboard  ─┐ │     send_json({zone,button})              │
 │                      │ │                                           │
 │   GET /health        │ │                                           │
 │                      ▼ │                                           │
 │                ┌─────────────┐                                     │
 │                │  SQLite     │  scores.db                          │
 │                │  scores     │  (mounted volume in Docker)         │
 │                │  table      │                                     │
 │                └─────────────┘                                     │
 └────────────────────────────────────────────────────────────────────┘
```

## 1.3 Request / event flows

### 1.3.1 Starting a game
1. User lands on `HomePage`, types a name, selects a mode → navigates to
   `/game?mode=timed|endless|sprint`.
2. `GamePage` mounts, calls `tetrisRef.current.startGame()`.
3. `Tetris` resets stage, spawns the first tetromino, schedules the drop
   interval, and tells `SoundManager` to start the music loop.
4. In parallel, `HandControlOverlay` requests camera access, opens a
   `WebSocket` to `/ws`, and starts pushing ~15 JPEG frames/sec.

### 1.3.2 Each gesture frame
1. `HandControlOverlay` captures a horizontally-mirrored JPEG from the
   hidden `<canvas>`.
2. Frame is sent as `{frame: "<base64>"}` over the WebSocket.
3. Backend decodes, runs MediaPipe, picks index-finger tip (landmark
   **#8**), tests it against four rectangles defined in `ZONE_RECTS`.
4. Backend requires the same zone to be detected for `ZONE_CONFIRM_FRAMES
   = 2` consecutive frames before reporting it (debounce against
   flicker). Leaving the zone unconfirms instantly.
5. Backend responds with `{zone: "LEFT"|"RIGHT"|"UP"|"DOWN"|null,
   button: <same>}`.
6. `GamePage` edge-triggers: entering `LEFT/RIGHT/UP` fires the move
   **once**; entering `DOWN` starts soft-drop; leaving `DOWN` stops it.

### 1.3.3 Saving a score
1. On game-over, `GamePage` calls `axios.post('/scoreboard', {name, score})`.
2. Backend validates via pydantic `ScoreItem`, rate-limits by client IP
   (30 req/min), and inserts into SQLite.

## 1.4 Why this architecture?

| Constraint | Decision |
|------------|----------|
| "Tetris must feel like keyboard Tetris." | All input is edge-triggered on the React side, *not* continuously streamed. The backend is purely a zone classifier. |
| "Webcam + ML is expensive to ship to every browser." | Run MediaPipe server-side; only ~15 fps of JPEG crosses the wire. |
| "Must work without any ML install." | Backend gracefully degrades: when `cv2 / mediapipe` can't be imported, `/ws` returns an error and only the keyboard/touch path works. |
| "Scores must survive container restarts." | SQLite file is mounted on a named Docker volume (`tetris-data`). |
| "Must deploy on AWS." | Two-container ECS Fargate task behind an ALB — see [chapter 7](./07-deployment.md). |

## 1.5 Technology stack cheat-sheet

| Layer | Tech | Version | Why |
|-------|------|---------|-----|
| Build tool | Vite | ^6.1 | Fast HMR, native ES-module dev server |
| UI | React | ^19 | Hooks, suspense, modern ecosystem |
| Routing | react-router-dom | ^6.9 | `/` and `/game` routes |
| Styling | styled-components | ^5.3 | Co-locate styles with components, prop-driven cell sizing |
| HTTP | axios | ^1.3 | Simple REST client |
| API | FastAPI | >=0.115 | Async, pydantic v2 validation, WebSocket built-in |
| ASGI server | uvicorn[standard] | >=0.32 | Production-grade, auto-reload in dev |
| Validation | pydantic | >=2.9 | `@field_validator` replaces the old `@validator` |
| CV | mediapipe | >=0.10.21 | Pre-trained hand landmarker, Tasks API |
| CV | opencv-python | >=4.10 | JPEG decode, colour conversion |
| DB | sqlite3 (stdlib) | bundled | Zero-deps, single-file persistence |
| Tests | pytest | >=8 | Standard Python testing |
| Container | Docker + docker-compose | v4 schema | Reproducible local stack |
| Cloud | AWS ECS Fargate + ALB | — | Serverless containers |

## 1.6 What each top-level folder contains

```
AMAZON-POWERED-TETRIS/
├── backend/            ← FastAPI app, MediaPipe, SQLite, pytest suite
├── frontend/           ← React SPA (Vite build)
├── aws/cf/             ← CloudFormation template for ECS deployment
├── docker-compose.yml  ← Local two-container dev stack
├── .gitignore
├── README.md           ← Short user-facing readme
├── docs/               ← You are here
└── note.txt            ← Scratch notes (non-authoritative)
```

---

Next: [**Chapter 2 — Backend internals**](./02-backend.md).
