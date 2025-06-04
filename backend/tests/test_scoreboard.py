import sys
import types
from pathlib import Path

# Provide dummy modules for optional heavy dependencies
for mod in ['cv2', 'tensorflow', 'numpy']:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

# Minimal fake mediapipe structure to satisfy imports
if 'mediapipe' not in sys.modules:
    mp = types.ModuleType('mediapipe')
    solutions = types.SimpleNamespace(hands=types.SimpleNamespace())
    mp.solutions = solutions
    sys.modules['mediapipe'] = mp
    sys.modules['mediapipe.solutions'] = solutions

# Add backend directory to path and import the FastAPI app
BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import main
from fastapi.testclient import TestClient

client = TestClient(main.app)


def test_scoreboard_limit_and_sorting():
    # reset scoreboard between tests
    main.scoreboard_heap.clear()

    scores = [
        ("p1", 5),
        ("p2", 15),
        ("p3", 25),
        ("p4", 10),
        ("p5", 30),
        ("p6", 20),
        ("p7", 8),
        ("p8", 40),
        ("p9", 35),
        ("p10", 50),
        ("p11", 45),
        ("p12", 60),
        ("p13", 1),
        ("p14", 55),
        ("p15", 12),
    ]

    for name, score in scores:
        resp = client.post("/scoreboard", json={"name": name, "score": score})
        assert resp.status_code == 200

    resp = client.get("/scoreboard")
    assert resp.status_code == 200
    data = resp.json()

    top_scores = data.get("topScores")
    assert len(top_scores) <= 10

    # ensure sorting by score descending
    scores_only = [item["score"] for item in top_scores]
    assert scores_only == sorted(scores_only, reverse=True)

    expected = sorted(scores, key=lambda x: x[1], reverse=True)[:10]
    returned = [(item["name"], item["score"]) for item in top_scores]
    assert returned == expected
