
# Chapter 8 — Testing

The project ships with **10 backend unit tests** that run in <1 second.
There is no automated frontend test suite at present — this chapter
also explains the manual smoke-testing checklist and suggestions for
adding Vitest/Playwright.

## 8.1 Running the tests

```bash
cd backend
./venv/bin/python -m pytest tests/ -q
```

Expected:

```
..........                                                       [100%]
10 passed in 0.42s
```

## 8.2 Test layout

File: [`backend/tests/test_scoreboard.py`](../backend/tests/test_scoreboard.py)

### 8.2.1 Stubbing heavy imports

```python
for mod in ['cv2', 'numpy', 'mediapipe']:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

sys.modules['mediapipe'].solutions = types.SimpleNamespace(
    hands=types.SimpleNamespace(Hands=lambda *args, **kwargs: None)
)
```

The scoreboard tests don't care about MediaPipe. Stubbing these
modules before importing `main.py` means CI can skip installing
OpenCV/TFLite entirely if all it wants to test is the REST layer.

### 8.2.2 Temp DB per test module

```python
_test_db = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
os.environ['DB_PATH'] = _test_db.name
```

Each test-run gets a fresh SQLite file, cleaned up in `teardown_module`.

### 8.2.3 Fake `Request` object

```python
class _FakeClient:  host = "127.0.0.1"
class _FakeRequest: client = _FakeClient()
```

Lets us invoke `post_scoreboard(item, request=_FakeRequest())` directly
without spinning up the Starlette test client — faster and more
focused.

## 8.3 Current test cases

| # | Test | Asserts |
|---|------|---------|
| 1 | `test_scoreboard_insert_and_retrieve` | 5 scores inserted come back in descending order |
| 2 | `test_scoreboard_top_10_limit` | Inserting 15 scores returns exactly 10, top one is the max |
| 3 | `test_name_validation_empty` | Empty name raises |
| 4 | `test_name_validation_anonymous` | `"anonymous"` name raises |
| 5 | `test_name_validation_too_long` | Name > 20 chars raises |
| 6 | `test_name_validation_special_chars` | `<script>alert(1)</script>` raises (anti-XSS) |
| 7 | `test_score_validation_negative` | `-1` score raises |
| 8 | `test_score_validation_too_high` | `999999` > `MAX_ALLOWED_SCORE` raises |
| 9 | `test_valid_name_with_spaces` | `"John Doe-Jr_2"` passes both validators |
| 10 | `test_rate_limiting` | The 31st request within 60s raises HTTP 429 |

## 8.4 What's not tested yet

### Backend

| Area | Why it's not tested | Suggested approach |
|------|---------------------|-------------------|
| `/ws` WebSocket handler | Requires real MediaPipe to exercise; would fail in CI without the model file | Use FastAPI's `TestClient.websocket_connect` to at least validate the error path (`{error: "CV libraries not installed"}`) |
| `_detect_zone` | Pure function, easy to add | 8 cases covering each corner + all 4 zones + `None` |
| `ZONE_CONFIRM_FRAMES` debounce | State-machine | A small harness that feeds a sequence of `raw_zone`s and asserts `confirmed_zone` transitions |

### Frontend

Nothing is automated. Suggested stack:

- **Vitest** for pure utilities (`tetrominos.js`, `gameHelpers.js`,
  `useGameStatus` scoring).
- **React Testing Library** for component behaviour
  (`HandControlOverlay` camera permission, `GamePage` keyboard inputs).
- **Playwright** for E2E: mock the WebSocket with a deterministic
  script of zones and assert the piece ends up in the right column.

## 8.5 Manual smoke-testing checklist

After any change, walk through this in a real browser:

### Gameplay
- [ ] Keyboard: Left, Right, Up, Down, Space, C, P, M all work
- [ ] Hold can be used exactly once per piece
- [ ] Ghost piece preview is correctly aligned
- [ ] NES scoring: a Tetris on level 0 gives 1200 points
- [ ] Level increments every 10 lines
- [ ] Sprint mode ends exactly at 40 lines
- [ ] Timed mode ends exactly at 0:00
- [ ] Pause overlay shows; unpause resumes
- [ ] Game-over shows final score + stats

### Gesture control
- [ ] Webcam permission prompt shown on first load
- [ ] Four control boxes visible in the overlay
- [ ] Hand in `LEFT` moves the piece exactly **once**
- [ ] Hand in `DOWN` starts soft-drop; leaves → stops
- [ ] Pausing while hand in `DOWN` does **not** auto-resume the drop
- [ ] Active box glows (`.active` CSS class)
- [ ] WebSocket green/red indicator reflects reality

### Audio
- [ ] Sound starts with game
- [ ] Mute → music stops within 10 ms (no tail)
- [ ] Mute → line-clear SFX is silent
- [ ] Unmute → music resumes from the top
- [ ] Mute button turns red; `aria-pressed` flips
- [ ] `M` key toggles the same state

### Persistence
- [ ] Submitted score shows up on HomePage after navigation
- [ ] `docker compose down && up` preserves scores
- [ ] 31st rapid POST gets HTTP 429

### Mobile
- [ ] Tap = hard drop
- [ ] Horizontal swipe = move
- [ ] Upward swipe = rotate
- [ ] Downward swipe = soft drop

## 8.6 CI suggestion

A minimal GitHub Actions workflow:

```yaml
name: CI
on: [push, pull_request]
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: {python-version: '3.12'}
      - run: pip install -r backend/requirements.txt
      - run: cd backend && python -m pytest tests/ -v

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version: 20}
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run build
```

The `npm run build` catches syntax errors, dead imports, unresolved
JSX — it's effectively "typecheck + bundling" coverage even without a
Vitest suite.

---

Next: [**Chapter 9 — Bugfix history**](./09-bugfix-history.md).
