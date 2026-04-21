########################################
# main.py — Amazon Powered Tetris Backend v2
########################################
import os
import re
import time
import sqlite3
import uvicorn
import base64
import json
from collections import defaultdict
from contextlib import asynccontextmanager, contextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

# ---------------------------------------------------------------------------
# Lazy imports for heavy CV dependencies.
# Supports both new MediaPipe Tasks API (>=0.10.14) and legacy solutions API.
# ---------------------------------------------------------------------------
CV_AVAILABLE = False
MP_API = None  # 'tasks' or 'legacy'

try:
    import cv2
    import numpy as np
    import mediapipe as mp

    # Try new Tasks API first (mediapipe >= 0.10.14)
    if hasattr(mp, 'tasks') and hasattr(mp.tasks, 'vision'):
        MP_API = 'tasks'
        CV_AVAILABLE = True
        print("[INFO] Using MediaPipe Tasks API (new)")
    # Fall back to legacy solutions API
    elif hasattr(mp, 'solutions'):
        MP_API = 'legacy'
        CV_AVAILABLE = True
        print("[INFO] Using MediaPipe Solutions API (legacy)")
    else:
        print("[WARN] MediaPipe installed but no usable API found.")
except (ImportError, Exception) as e:
    print(f"[WARN] CV libraries not available: {e}. Hand gesture WebSocket disabled.")

# Path to the hand landmarker model (for Tasks API)
MODEL_PATH = os.environ.get(
    "HAND_MODEL_PATH",
    str(Path(__file__).parent / "hand_landmarker.task")
)

from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app):
    """Modern lifespan event handler."""
    _init_db()
    yield


app = FastAPI(title="Amazon Powered Tetris API", version="2.0.0", lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# SQLite persistence
# ---------------------------------------------------------------------------
DB_PATH = os.environ.get("DB_PATH", "scores.db")


def _init_db():
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                score INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC)")


@contextmanager
def _get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 30
_rate_store: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    recent = [t for t in _rate_store.get(client_ip, []) if now - t < RATE_LIMIT_WINDOW]
    if len(recent) >= RATE_LIMIT_MAX:
        _rate_store[client_ip] = recent
        return False
    recent.append(now)
    _rate_store[client_ip] = recent
    # Periodically purge stale buckets to prevent unbounded growth.
    if len(_rate_store) > 1024:
        for ip in list(_rate_store.keys()):
            if not _rate_store[ip] or now - _rate_store[ip][-1] > RATE_LIMIT_WINDOW:
                _rate_store.pop(ip, None)
    return True


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
MAX_ALLOWED_SCORE = 99999
MAX_NAME_LENGTH = 20
NAME_PATTERN = re.compile(r'^[a-zA-Z0-9_\- ]+$')


class ScoreItem(BaseModel):
    name: str
    score: int

    @field_validator('name')
    @classmethod
    def validate_name(cls, v):
        v = v.strip()
        if not v or v.lower() == 'anonymous':
            raise ValueError('Name cannot be empty or "anonymous"')
        if len(v) > MAX_NAME_LENGTH:
            raise ValueError(f'Name must be {MAX_NAME_LENGTH} characters or fewer')
        if not NAME_PATTERN.match(v):
            raise ValueError('Name may only contain letters, numbers, spaces, hyphens, and underscores')
        return v

    @field_validator('score')
    @classmethod
    def validate_score(cls, v):
        if v < 0:
            raise ValueError('Score cannot be negative')
        if v > MAX_ALLOWED_SCORE:
            raise ValueError(f'Score cannot exceed {MAX_ALLOWED_SCORE}')
        return v


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return {"message": "Tetris CV Backend is running!"}


@app.get("/health")
def health_check():
    return {"status": "healthy", "cv_available": CV_AVAILABLE, "mp_api": MP_API}


@app.get("/scoreboard")
def get_scoreboard():
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT name, score FROM scores ORDER BY score DESC LIMIT 10"
        ).fetchall()
    return {"topScores": [{"name": r["name"], "score": r["score"]} for r in rows]}


@app.post("/scoreboard")
def post_scoreboard(item: ScoreItem, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    with _get_db() as conn:
        conn.execute("INSERT INTO scores (name, score) VALUES (?, ?)", (item.name, item.score))
    return JSONResponse({"message": "Score saved"})


# ---------------------------------------------------------------------------
# Control-zone geometry (proportional to the captured image).
# These MUST stay in sync with the CSS boxes drawn on the frontend overlay
# (see frontend/src/components/HandControlOverlay.css). Keeping them in a
# single dict avoids drift between what the user sees and what the backend
# detects.
# ---------------------------------------------------------------------------
ZONE_RECTS = {
    # name: (x1_frac, y1_frac, x2_frac, y2_frac)
    "LEFT":  (0.00, 0.25, 0.30, 0.75),
    "RIGHT": (0.70, 0.25, 1.00, 0.75),
    "UP":    (0.35, 0.00, 0.65, 0.25),
    "DOWN":  (0.35, 0.75, 0.65, 1.00),
}

# Minimum consecutive frames a zone must be detected before we report it.
# This debounces false positives from the hand passing through a box.
ZONE_CONFIRM_FRAMES = 2


def _detect_zone(px, py, w, h):
    """Given fingertip pixel coords and image dimensions, return the zone name."""
    for name, (x1f, y1f, x2f, y2f) in ZONE_RECTS.items():
        if (x1f * w) <= px <= (x2f * w) and (y1f * h) <= py <= (y2f * h):
            return name
    return None


# ---------------------------------------------------------------------------
# WebSocket — hand gesture detection (supports both MediaPipe APIs)
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    if not CV_AVAILABLE:
        await websocket.send_json({"zone": None, "button": None, "error": "CV libraries not installed"})
        await websocket.close()
        return

    # Per-connection state for zone debouncing. We keep the raw detected zone
    # (what the fingertip is currently touching) plus a small counter that
    # requires N consecutive frames before we "confirm" the zone. This avoids
    # flicker when the hand briefly passes through a box.
    pending_zone: str | None = None
    pending_count: int = 0
    confirmed_zone: str | None = None

    # Initialize the hand detector based on available API
    detector = None
    try:
        if MP_API == 'tasks':
            # New MediaPipe Tasks API
            if not os.path.exists(MODEL_PATH):
                await websocket.send_json({"zone": None, "button": None, "error": f"Model file not found: {MODEL_PATH}"})
                await websocket.close()
                return

            base_options = mp.tasks.BaseOptions(model_asset_path=MODEL_PATH)
            options = mp.tasks.vision.HandLandmarkerOptions(
                base_options=base_options,
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_hands=1,
                min_hand_detection_confidence=0.5,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            detector = mp.tasks.vision.HandLandmarker.create_from_options(options)
        else:
            # Legacy solutions API
            detector = mp.solutions.hands.Hands(
                static_image_mode=False,
                max_num_hands=1,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
    except Exception as e:
        await websocket.send_json({"zone": None, "button": None, "error": f"Failed to init hand detector: {e}"})
        await websocket.close()
        return

    try:
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
            except json.JSONDecodeError:
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            if "frame" not in parsed or not isinstance(parsed["frame"], str):
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            # Decode the base64 JPEG frame from the browser. The data URL
            # prefix ("data:image/jpeg;base64,...") may or may not be present.
            frame_field = parsed["frame"]
            if "," in frame_field:
                frame_str = frame_field.split(",", 1)[1]
            else:
                frame_str = frame_field
            try:
                frame_bytes = base64.b64decode(frame_str, validate=False)
            except (ValueError, TypeError):
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            np_arr = np.frombuffer(frame_bytes, dtype=np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if img is None:
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            h, w, _ = img.shape
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            raw_zone: str | None = None

            if MP_API == 'tasks':
                # New Tasks API: wrap in mp.Image and detect
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = detector.detect(mp_image)

                if result.hand_landmarks and len(result.hand_landmarks) > 0:
                    # Index finger tip is landmark #8
                    tip = result.hand_landmarks[0][8]
                    px = int(tip.x * w)
                    py = int(tip.y * h)
                    raw_zone = _detect_zone(px, py, w, h)
            else:
                # Legacy solutions API
                results = detector.process(rgb)
                if results.multi_hand_landmarks:
                    tip = results.multi_hand_landmarks[0].landmark[8]
                    px = int(tip.x * w)
                    py = int(tip.y * h)
                    raw_zone = _detect_zone(px, py, w, h)

            # --- Confirmation debounce -------------------------------------
            # A zone must be observed for ZONE_CONFIRM_FRAMES consecutive
            # frames before it's reported. Leaving the zone confirms `None`
            # immediately so the client can re-arm its edge-trigger quickly.
            if raw_zone == pending_zone:
                pending_count += 1
            else:
                pending_zone = raw_zone
                pending_count = 1

            if raw_zone is None:
                confirmed_zone = None
            elif pending_count >= ZONE_CONFIRM_FRAMES:
                confirmed_zone = raw_zone

            # `button` is kept for backward compatibility; `zone` is the
            # authoritative field. Both carry the same value so either works.
            await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})

    except WebSocketDisconnect:
        print("WebSocket disconnected.")
    finally:
        if detector:
            try:
                detector.close()
            except Exception:
                pass


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
