import sys
import types
import importlib.util
import pathlib

# Stub heavy modules before importing main
for mod in ['cv2', 'numpy', 'mediapipe']:
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)
# Provide minimal attribute for mediapipe.solutions.hands
sys.modules['mediapipe'].solutions = types.SimpleNamespace(hands=types.SimpleNamespace(Hands=lambda *args, **kwargs: None))

main_path = pathlib.Path(__file__).resolve().parents[1] / 'main.py'
spec = importlib.util.spec_from_file_location('backend.main', main_path)
main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(main)


def setup_function():
    main.scoreboard_heap.clear()


def test_scoreboard_top_10():
    for i in range(15):
        main.post_scoreboard(main.ScoreItem(name=f"player{i}", score=i))

    assert len(main.scoreboard_heap) == 10

    result = main.get_scoreboard()
    scores = [entry['score'] for entry in result['topScores']]

    assert scores == sorted(scores, reverse=True)
    assert scores[0] == 14
    assert scores[-1] == 5
