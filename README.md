# 🎮 APT — Amazon Powered Tetris

A computer-vision-controlled Tetris game where you play using **hand gestures** detected via your webcam. Built with React, FastAPI, MediaPipe, and deployable on AWS ECS/Fargate.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  React App   │  │  Webcam Feed │  │ SoundManager │  │
│  │  (Tetris     │  │  (captures   │  │ (Web Audio   │  │
│  │   Engine)    │  │   frames)    │  │  API synth)  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                 │ base64 JPEG frames          │
│         │ REST            │ WebSocket                   │
└─────────┼─────────────────┼─────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│                  FastAPI Backend (:8000)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ REST API     │  │ WebSocket    │  │ SQLite       │  │
│  │ /scoreboard  │  │ /ws          │  │ scores.db    │  │
│  │ /health      │  │ MediaPipe    │  │              │  │
│  └──────────────┘  │ Hand Detect  │  └──────────────┘  │
│                    └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

## Features

| Feature | Description |
|---------|-------------|
| 🖐 Hand Gesture Control | Move, rotate, and drop pieces using your index finger in webcam zones |
| ⌨️ Keyboard Controls | Arrow keys, Space (hard drop), C (hold), P (pause), M (mute) |
| 📱 Touch Controls | Swipe gestures for mobile play |
| 🎵 Sound & Music | Procedurally synthesized Tetris theme + sound effects via Web Audio API |
| 📦 Hold Piece | Press C to save a piece for later |
| 👻 Ghost Piece | Translucent preview showing where your piece will land |
| 🎮 3 Game Modes | Time Attack (180s), Endless (classic), Sprint (40 lines) |
| 📊 NES Scoring | 1→40, 2→100, 3→300, 4→1200 points × level multiplier |
| 🏆 Persistent Leaderboard | SQLite-backed top 10 scoreboard |
| 🔒 Input Validation | Name sanitization, score ceiling, rate limiting (30 req/min/IP) |
| 🐳 Docker Ready | docker-compose with health checks and persistent volumes |
| ☁️ AWS Deployable | CloudFormation template for ECS Fargate deployment |

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- (Optional) `opencv-python`, `numpy`, `mediapipe` for hand detection

### 1. Backend
```bash
cd backend
pip install -r requirements.txt

# Optional: install CV dependencies for hand detection
pip install opencv-python numpy mediapipe

# Optional: download hand landmarker model (only needed for mediapipe >= 0.10.14)
curl -sL -o hand_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"

python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Frontend
```bash
cd frontend
npm install
npx vite --host
```

### 3. Open in Browser
Navigate to `http://localhost:3000`, enter your name, select a game mode, and play!

## Docker Deployment

```bash
docker-compose up --build
```
- Frontend: http://localhost:8080
- Backend: http://localhost:8000
- Scores persist in a Docker named volume (`tetris-data`)

## AWS Deployment

A CloudFormation template is provided at `aws/cf/tetris.yaml`. It provisions:
- VPC with 2 public subnets across AZs
- ECS Cluster with Fargate launch type
- Application Load Balancer (ALB)
- Task Definition with backend + frontend containers
- Security groups and routing

### Deploy Steps
```bash
# 1. Build and push Docker images to ECR
aws ecr create-repository --repository-name tetris-backend
aws ecr create-repository --repository-name tetris-frontend

# 2. Tag and push
docker build -t tetris-backend -f backend/Dockerfile.backend ./backend
docker tag tetris-backend:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest

docker build -t tetris-frontend -f frontend/Dockerfile.frontend ./frontend
docker tag tetris-frontend:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest

# 3. Deploy CloudFormation stack
aws cloudformation create-stack \
  --stack-name tetris \
  --template-body file://aws/cf/tetris.yaml \
  --parameters \
    ParameterKey=TetrisBackendImage,ParameterValue=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-backend:latest \
    ParameterKey=TetrisFrontendImage,ParameterValue=<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/tetris-frontend:latest \
  --capabilities CAPABILITY_IAM
```

## Environment Variables

### Backend
| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000,http://localhost:8080` | Comma-separated allowed origins |
| `DB_PATH` | `scores.db` | Path to SQLite database file |
| `HAND_MODEL_PATH` | `./hand_landmarker.task` | Path to MediaPipe hand model |

### Frontend
| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:8000` | Backend REST API URL |
| `VITE_WS_URL` | `ws://localhost:8000` | Backend WebSocket URL |

## Project Structure

```
AMAZON-POWERED-TETRIS/
├── backend/
│   ├── main.py                 # FastAPI server (REST + WebSocket + hand detection)
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile.backend      # Docker image for backend
│   └── tests/
│       └── test_scoreboard.py  # 10 unit tests (validation, persistence, rate limiting)
├── frontend/
│   ├── src/
│   │   ├── config.js           # Centralized API/WS URL configuration
│   │   ├── game/
│   │   │   ├── Tetris.jsx      # Core game engine (hold, ghost, hard drop, sound)
│   │   │   ├── SoundManager.js # Web Audio API synthesized sounds + music
│   │   │   ├── gameHelpers.js  # Stage creation, collision detection
│   │   │   ├── tetrominos.js   # Piece definitions and colors
│   │   │   ├── hooks/          # usePlayer, useStage, useGameStatus, useInterval
│   │   │   └── components/     # Stage, Cell, styled-components
│   │   ├── pages/
│   │   │   ├── HomePage.jsx    # Name entry, mode selection, leaderboard
│   │   │   └── GamePage.jsx    # Game layout, controls, stats, overlays
│   │   └── components/
│   │       ├── HandControlOverlay.jsx  # Webcam feed + zone overlay
│   │       ├── NextPieceView.jsx       # Next/Hold piece preview
│   │       └── InstructionModal.jsx    # How-to-play modal
│   ├── .env.example            # Environment variable template
│   ├── Dockerfile.frontend     # Docker image for frontend
│   └── package.json
├── aws/cf/tetris.yaml          # CloudFormation template (ECS Fargate)
├── docker-compose.yml          # Local Docker deployment
├── .gitignore
└── README.md
```

## Controls

| Input | Action |
|-------|--------|
| ← → Arrow Keys | Move left/right |
| ↑ Arrow | Rotate |
| ↓ Arrow | Soft drop |
| Space | Hard drop (instant) |
| C | Hold piece |
| P | Pause / Resume |
| M | Mute / Unmute |
| 🖐 Hand LEFT zone | Move left |
| 🖐 Hand RIGHT zone | Move right |
| 🖐 Hand UP zone | Rotate |
| 🖐 Hand DOWN zone | Soft drop |
| 📱 Swipe L/R | Move (mobile) |
| 📱 Swipe Up | Rotate (mobile) |
| 📱 Swipe Down | Soft drop (mobile) |
| 📱 Tap | Hard drop (mobile) |

## Testing

```bash
cd backend
python -m pytest tests/test_scoreboard.py -v
```

## License

MIT
