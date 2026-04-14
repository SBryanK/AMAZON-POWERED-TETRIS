import sys
import os
import types
import importlib.util
import pathlib
import tempfile

# Stub heavy modules before importing main
for mod in ['cv2', 'numpy', 'mediapipe']:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
sys.modules['mediapipe'].solutions = types.SimpleNamespace(
    hands=types.SimpleNamespace(Hands=lambda *args, **kwargs: None)
)

# Use a temp DB for tests
_test_db = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
os.environ['DB_PATH'] = _test_db.name
_test_db.close()

main_path = pathlib.Path(__file__).resolve().parents[1] / 'main.py'
spec = importlib.util.spec_from_file_location('backend.main', main_path)
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)

import pytest


class _FakeClient:
    host = "127.0.0.1"

class _FakeRequest:
    client = _FakeClient()

def _fake_request():
    return _FakeRequest()


def setup_function():
    """Reset the DB before each test."""
    main._init_db()
    with main._get_db() as conn:
        conn.execute("DELETE FROM scores")


def test_scoreboard_insert_and_retrieve():
    """Scores should be persisted and returned in descending order."""
    for i in range(5):
        main.post_scoreboard(main.ScoreItem(name=f"player{i}", score=i * 100), request=_fake_request())

    result = main.get_scoreboard()
    scores = [entry['score'] for entry in result['topScores']]
    assert scores == [400, 300, 200, 100, 0]


def test_scoreboard_top_10_limit():
    """Only top 10 should be returned even if more exist."""
    for i in range(15):
        main.post_scoreboard(main.ScoreItem(name=f"player{i}", score=i), request=_fake_request())

    result = main.get_scoreboard()
    assert len(result['topScores']) == 10
    assert result['topScores'][0]['score'] == 14


def test_name_validation_empty():
    with pytest.raises(Exception):
        main.ScoreItem(name="", score=100)


def test_name_validation_anonymous():
    with pytest.raises(Exception):
        main.ScoreItem(name="anonymous", score=100)


def test_name_validation_too_long():
    with pytest.raises(Exception):
        main.ScoreItem(name="a" * 25, score=100)


def test_name_validation_special_chars():
    with pytest.raises(Exception):
        main.ScoreItem(name="<script>alert(1)</script>", score=100)


def test_score_validation_negative():
    with pytest.raises(Exception):
        main.ScoreItem(name="player", score=-1)


def test_score_validation_too_high():
    with pytest.raises(Exception):
        main.ScoreItem(name="player", score=999999)


def test_valid_name_with_spaces():
    item = main.ScoreItem(name="John Doe-Jr_2", score=500)
    assert item.name == "John Doe-Jr_2"
    assert item.score == 500


def test_rate_limiting():
    """After RATE_LIMIT_MAX requests, further requests should be rejected."""
    main._rate_store.clear()
    for i in range(main.RATE_LIMIT_MAX):
        main.post_scoreboard(main.ScoreItem(name="ratelimit", score=i), request=_fake_request())

    with pytest.raises(Exception):
        main.post_scoreboard(main.ScoreItem(name="ratelimit", score=999), request=_fake_request())


def teardown_module():
    """Clean up temp DB."""
    try:
        os.unlink(_test_db.name)
    except OSError:
        pass
