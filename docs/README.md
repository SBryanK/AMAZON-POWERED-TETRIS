
# 📚 APT (Amazon Powered Tetris) — Complete Documentation

Welcome! This folder breaks the project down **file-by-file** and
**feature-by-feature** so you can understand exactly what every piece of
code does, *why* it exists, and how the pieces interact at runtime.

The documentation is split into focused chapters so nothing is too long to
digest in one sitting:

| # | Chapter | What's inside |
|---|---------|---------------|
| 1 | [01-architecture.md](./01-architecture.md) | The big picture: browser ↔ FastAPI ↔ SQLite, every data flow, every component's role |
| 2 | [02-backend.md](./02-backend.md) | `backend/main.py` dissected line-by-line: REST endpoints, WebSocket, MediaPipe, zone detection, rate limiting, DB |
| 3 | [03-frontend-game-engine.md](./03-frontend-game-engine.md) | The Tetris engine itself: `Tetris.jsx`, hooks (`usePlayer`, `useStage`, `useGameStatus`, `useInterval`), collision, scoring, ghost, hold |
| 4 | [04-frontend-pages-and-ui.md](./04-frontend-pages-and-ui.md) | `HomePage`, `GamePage`, `HandControlOverlay`, modals, CSS layout decisions |
| 5 | [05-hand-gesture-control.md](./05-hand-gesture-control.md) | End-to-end gesture pipeline: webcam capture → WS → MediaPipe → zone debounce → edge-triggered React state machine |
| 6 | [06-sound-system.md](./06-sound-system.md) | `SoundManager.js` internals: Web Audio API, master-gain mute, music loop, per-event SFX |
| 7 | [07-deployment.md](./07-deployment.md) | Running locally, Docker Compose, AWS ECS Fargate via CloudFormation |
| 8 | [08-testing.md](./08-testing.md) | Backend `pytest` coverage; how to extend tests; front-end smoke-testing |
| 9 | [09-bugfix-history.md](./09-bugfix-history.md) | Chronological log of every bug we've fixed in this repo and *why* the fix was designed the way it is |
| 10 | [10-glossary.md](./10-glossary.md) | Cheat-sheet of the terms (Tetromino, NES scoring, soft/hard drop, edge-trigger, etc.) |

> **How to read this documentation**
>
> - If you want the *shortest path to "I get it"*, read chapters **1 → 3 →
>   5**.
> - If you want to *modify* the code, read the chapter for the area you're
>   touching first.
> - If you hit a bug, check chapter **9** — you might find it was already
>   fixed, and the reasoning explained.

## Quick links to source

| Layer | File |
|-------|------|
| Backend entrypoint | [`backend/main.py`](../backend/main.py) |
| Backend tests | [`backend/tests/test_scoreboard.py`](../backend/tests/test_scoreboard.py) |
| Game engine | [`frontend/src/game/Tetris.jsx`](../frontend/src/game/Tetris.jsx) |
| Sound engine | [`frontend/src/game/SoundManager.js`](../frontend/src/game/SoundManager.js) |
| Gesture overlay | [`frontend/src/components/HandControlOverlay.jsx`](../frontend/src/components/HandControlOverlay.jsx) |
| Game page | [`frontend/src/pages/GamePage.jsx`](../frontend/src/pages/GamePage.jsx) |
| Home page | [`frontend/src/pages/HomePage.jsx`](../frontend/src/pages/HomePage.jsx) |
| CloudFormation | [`aws/cf/tetris.yaml`](../aws/cf/tetris.yaml) |
| Compose | [`docker-compose.yml`](../docker-compose.yml) |

---

_Last updated: 2026-04-22 · Author: Bryan Kusno (sbryankusno)_
