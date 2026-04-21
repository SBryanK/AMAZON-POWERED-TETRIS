
# Chapter 2 — Backend internals (`backend/main.py`)

The backend is **one file**: [`backend/main.py`](../backend/main.py)
(~370 lines). This chapter dissects it section by section.

## 2.1 File layout at a glance

```
main.py
├── imports + lazy CV detection (lines 1-48)
├── FastAPI app + CORS (lines 52-76)
├── SQLite helpers  _init_db, _get_db (lines 81-107)
├── Rate limiter   _check_rate_limit (lines 110-129)
├── Pydantic model ScoreItem (lines 133-163)
├── REST routes    / /health /scoreboard (lines 167-189)
├── Zone geometry  ZONE_RECTS + _detect_zone (lines 193-223)
└── WebSocket      /ws handler (lines 227-361)
```

## 2.2 Lazy MediaPipe loading

```python
CV_AVAILABLE = False
MP_API = None   # 'tasks' or 'legacy'
try:
    import cv2, numpy as np, mediapipe as mp
    if hasattr(mp, 'tasks') and hasattr(mp.tasks, 'vision'):
        MP_API = 'tasks'
        CV_AVAILABLE = True
    elif hasattr(mp, 'solutions'):
        MP_API = 'legacy'
        CV_AVAILABLE = True
except (ImportError, Exception):
    ...
```

**Why lazy-import inside a try/except?** Two reasons:

1. **Developer UX.** You can run the scoreboard / tests without
   installing MediaPipe at all. When CV isn't available, `/ws` still
   accepts the connection but returns
   `{error: "CV libraries not installed"}` and closes — so the
   frontend sees the `🔴` status badge and falls back to keyboard input.
2. **MediaPipe API split.** MediaPipe deprecated its old
   `mp.solutions.hands` API in favour of the new
   `mp.tasks.vision.HandLandmarker`. Users who have either version
   should work. We pick the new one when present because it uses a
   pre-compiled `.task` model file (shipped as `hand_landmarker.task`,
   7.5 MB) and is faster.

## 2.3 FastAPI app + CORS

```python
@asynccontextmanager
async def lifespan(app):
    _init_db()
    yield

app = FastAPI(title="Amazon Powered Tetris API", version="2.0.0",
              lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:8080"
).split(",")

app.add_middleware(CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"])
```

- The `lifespan` replaces the old `@app.on_event("startup")` pattern
  (deprecated in FastAPI ≥0.100). We initialize the SQLite schema once
  on startup.
- `CORS_ORIGINS` is env-driven so production deployments (behind an
  ALB / EdgeOne domain) can lock down origins.

## 2.4 SQLite persistence

```python
DB_PATH = os.environ.get("DB_PATH", "scores.db")

def _init_db():
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scores (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                score       INTEGER NOT NULL,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC)"
        )

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
```

**Design notes**

- `DB_PATH` is env-overridable — in Docker we point it at `/data/scores.db`
  which is a mounted volume, so scores survive container restarts.
- The `idx_scores_score` index makes `SELECT ... ORDER BY score DESC
  LIMIT 10` O(log n) even if the table grows large.
- `_get_db` is a context manager that guarantees commit-on-success /
  rollback-on-error / always-close. This is the "safe SQLite" pattern.
- `timeout=10` lets concurrent writers wait up to 10 seconds for the
  file lock instead of erroring out.

## 2.5 Rate limiting

```python
RATE_LIMIT_WINDOW = 60        # seconds
RATE_LIMIT_MAX    = 30        # requests per window per IP
_rate_store: dict[str, list[float]] = defaultdict(list)

def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    recent = [t for t in _rate_store.get(client_ip, [])
              if now - t < RATE_LIMIT_WINDOW]
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
```

**Why sliding window in-memory?**

- 30 posts/min is plenty for a leaderboard; the cost of pulling Redis
  into the stack for this would be disproportionate.
- The **purge** inside the same function prevents `_rate_store` from
  leaking memory forever (one of the bugs we fixed — see
  [chapter 9](./09-bugfix-history.md)).
- If you ever deploy multiple backend replicas, move this to Redis. A
  single-replica setup (as in our ECS task) works perfectly with the
  in-process store.

## 2.6 Input validation — `ScoreItem`

```python
MAX_ALLOWED_SCORE = 99999
MAX_NAME_LENGTH   = 20
NAME_PATTERN      = re.compile(r'^[a-zA-Z0-9_\- ]+$')

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
```

- Uses **pydantic v2's** `@field_validator` (the project originally had
  pydantic v1's `@validator` which broke on Python 3.14 — see
  [chapter 9 §1](./09-bugfix-history.md)).
- `NAME_PATTERN` is an allowlist, not a blocklist — this blocks HTML
  injection (`<script>…`) automatically.
- `MAX_ALLOWED_SCORE = 99999` is an anti-cheat ceiling. A real Tetris
  game can technically exceed this (the theoretical max is ~1.2 M),
  but we prefer a hard cap to catch obvious tampering.

## 2.7 REST routes

| Verb | Path | Purpose |
|------|------|---------|
| `GET` | `/` | Liveness check, returns `{"message": "Tetris CV Backend is running!"}` |
| `GET` | `/health` | Container health-check used by Docker and load balancer; returns `{status, cv_available, mp_api}` |
| `GET` | `/scoreboard` | Top 10 scores ordered descending |
| `POST` | `/scoreboard` | Save a score after validation + rate-limit |

```python
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
```

## 2.8 Zone geometry — the *contract* between backend & frontend

```python
ZONE_RECTS = {
    # name: (x1_frac, y1_frac, x2_frac, y2_frac)  — image-normalized
    "LEFT":  (0.00, 0.25, 0.30, 0.75),
    "RIGHT": (0.70, 0.25, 1.00, 0.75),
    "UP":    (0.35, 0.00, 0.65, 0.25),
    "DOWN":  (0.35, 0.75, 0.65, 1.00),
}

ZONE_CONFIRM_FRAMES = 2

def _detect_zone(px, py, w, h):
    for name, (x1f, y1f, x2f, y2f) in ZONE_RECTS.items():
        if (x1f * w) <= px <= (x2f * w) and (y1f * h) <= py <= (y2f * h):
            return name
    return None
```

- Coordinates are **fractions of the image**, not pixels — the camera
  may be 640×480 or 1280×720, we stay resolution-independent.
- These four rectangles MUST match the ones drawn in
  [`HandControlOverlay.css`](../frontend/src/components/HandControlOverlay.css).
  The CSS uses the same percentages so what the user sees *is* what the
  backend checks.
- **Layout:**
  ```
   ┌───────────────────────────────────────┐
   │            UP (35–65%, 0–25%)         │
   │       ┌─────────────────────────┐     │
   │ LEFT  │                         │ RIGHT
   │(0–30, │        centre           │(70–100,
   │ 25–75)│      (no zone)          │25–75)
   │       │                         │     │
   │       └─────────────────────────┘     │
   │          DOWN (35–65%, 75–100%)       │
   └───────────────────────────────────────┘
  ```
- `ZONE_CONFIRM_FRAMES = 2`: a zone must appear in two consecutive
  frames before the backend reports it. This absorbs single-frame
  false positives without adding perceptible latency
  (2 frames × 66 ms = ~132 ms, well under the human reaction threshold).

## 2.9 WebSocket handler `/ws`

### 2.9.1 Accept + detector setup

```python
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    if not CV_AVAILABLE:
        await websocket.send_json({"zone": None, "button": None,
                                   "error": "CV libraries not installed"})
        await websocket.close()
        return

    pending_zone:  str | None = None
    pending_count: int        = 0
    confirmed_zone: str | None = None

    detector = None
    try:
        if MP_API == 'tasks':
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
            detector = mp.solutions.hands.Hands(
                static_image_mode=False, max_num_hands=1,
                min_detection_confidence=0.5, min_tracking_confidence=0.5)
    except Exception as e:
        await websocket.send_json({"zone": None, "button": None,
                                   "error": f"Failed to init hand detector: {e}"})
        await websocket.close()
        return
```

### 2.9.2 The receive-loop

```python
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

            # Strip optional data-URL prefix  "data:image/jpeg;base64,..."
            frame_field = parsed["frame"]
            frame_str = frame_field.split(",", 1)[1] if "," in frame_field else frame_field
            try:
                frame_bytes = base64.b64decode(frame_str, validate=False)
            except (ValueError, TypeError):
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            np_arr = np.frombuffer(frame_bytes, dtype=np.uint8)
            img    = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if img is None:
                await websocket.send_json({"zone": confirmed_zone, "button": confirmed_zone})
                continue

            h, w, _ = img.shape
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            raw_zone: str | None = None
            if MP_API == 'tasks':
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result   = detector.detect(mp_image)
                if result.hand_landmarks:
                    tip = result.hand_landmarks[0][8]   # index-finger tip
                    px, py = int(tip.x * w), int(tip.y * h)
                    raw_zone = _detect_zone(px, py, w, h)
            else:
                results = detector.process(rgb)
                if results.multi_hand_landmarks:
                    tip = results.multi_hand_landmarks[0].landmark[8]
                    px, py = int(tip.x * w), int(tip.y * h)
                    raw_zone = _detect_zone(px, py, w, h)

            # Debounce ------------------------------------------------
            if raw_zone == pending_zone:
                pending_count += 1
            else:
                pending_zone  = raw_zone
                pending_count = 1

            if raw_zone is None:
                confirmed_zone = None
            elif pending_count >= ZONE_CONFIRM_FRAMES:
                confirmed_zone = raw_zone

            await websocket.send_json({"zone": confirmed_zone,
                                       "button": confirmed_zone})
    except WebSocketDisconnect:
        print("WebSocket disconnected.")
    finally:
        if detector:
            try: detector.close()
            except Exception: pass
```

**Defensive-coding highlights:**

- Every error path still sends a valid JSON reply so the frontend never
  sees a mystery "no-op" — it always gets the *last known confirmed
  zone* back, which keeps the UI consistent.
- `detector.close()` in `finally` releases the underlying TF-Lite model,
  preventing memory leaks when clients reconnect rapidly.
- The response carries both `zone` (new, authoritative) and `button`
  (legacy alias) so an older frontend build still works.

## 2.10 Startup script

```python
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

In production we invoke uvicorn externally (see
[Dockerfile.backend](../backend/Dockerfile.backend)) so we don't get
reload watchers in a container. `reload=True` is dev-only convenience.

## 2.11 Dependencies (`requirements.txt`)

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.9.0
opencv-python>=4.10.0
mediapipe>=0.10.21
pytest>=8.0.0
httpx>=0.27.0
```

- Everything is `>=` rather than `==` because we explicitly need
  **pydantic v2** on newer Pythons (see [chapter 9 §1](./09-bugfix-history.md)).
- `httpx` is only for the test suite (FastAPI `TestClient` builds on it).

---

Next: [**Chapter 3 — Frontend game engine**](./03-frontend-game-engine.md).
