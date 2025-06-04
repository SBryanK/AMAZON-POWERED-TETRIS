########################################
# main.py
########################################
import uvicorn
import base64
import json
import cv2
import numpy as np

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import heapq

import mediapipe as mp
mp_hands = mp.solutions.hands

# CORS
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory scoreboard up to top 10
# Each entry is (score, name); we maintain a min-heap so the
# smallest score is at the root.  When more than 10 scores are stored
# we replace the smallest, ensuring we keep only the top scores.

scoreboard_heap = []

class ScoreItem(BaseModel):
    name: str
    score: int

@app.get("/")
def root():
    return {"message": "Tetris CV Backend is running!"}


@app.get("/scoreboard")
def get_scoreboard():

    # return top 10 scores in descending order

    sorted_scores = sorted(scoreboard_heap, key=lambda x: x[0], reverse=True)
    top_scores = [{"name": name, "score": score} for score, name in sorted_scores]

    return {"topScores": top_scores}

@app.post("/scoreboard")
def post_scoreboard(item: ScoreItem):


    # Push score/name pair and keep only the top 10
    heapq.heappush(scoreboard_heap, (item.score, item.name))
    if len(scoreboard_heap) > 10:
        # Remove the lowest score so only the highest remain
        heapq.heappop(scoreboard_heap)

    return JSONResponse({"message": "Score saved"})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    We detect the index fingertip (#8).
    If that point is inside a zone => LEFT, RIGHT, UP, DOWN.
    The front end will implement a throttle / logic to reduce oversensitivity.
    """
    await websocket.accept()

    hands_detector = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    )

    def in_zone(px, py, zone):
        return (px >= zone["x1"] and px <= zone["x2"] and
                py >= zone["y1"] and py <= zone["y2"])

    try:
        while True:
            data = await websocket.receive_text()
            parsed = json.loads(data)
            if "frame" not in parsed:
                await websocket.send_json({"button": None})
                continue

            # decode the image
            frame_str = parsed["frame"].split(",")[1]
            frame_bytes = base64.b64decode(frame_str)
            np_arr = np.frombuffer(frame_bytes, dtype=np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if img is None:
                await websocket.send_json({"button": None})
                continue

            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = hands_detector.process(rgb)

            button = None
            if results.multi_hand_landmarks:
                h, w, _ = img.shape
                # index finger tip
                tip = results.multi_hand_landmarks[0].landmark[8]
                px = int(tip.x * w)
                py = int(tip.y * h)

                # bigger zones, but we want to DECREASE sensitivity => shrink or poll less
                left_zone = {
                    "x1": 0,
                    "y1": int(h*0.2),
                    "x2": int(w*0.45),
                    "y2": int(h*0.8)
                }
                right_zone = {
                    "x1": int(w*0.55),
                    "y1": int(h*0.2),
                    "x2": w,
                    "y2": int(h*0.8)
                }
                up_zone = {
                    "x1": int(w*0.32),
                    "y1": 0,
                    "x2": int(w*0.68),
                    "y2": int(h*0.25)
                }
                down_zone = {
                    "x1": int(w*0.32),
                    "y1": int(h*0.75),
                    "x2": int(w*0.68),
                    "y2": h
                }

                if in_zone(px, py, left_zone):
                    button = "LEFT"
                elif in_zone(px, py, right_zone):
                    button = "RIGHT"
                elif in_zone(px, py, up_zone):
                    button = "UP"
                elif in_zone(px, py, down_zone):
                    button = "DOWN"

            await websocket.send_json({"button": button})

    except WebSocketDisconnect:
        print("WebSocket disconnected.")
    finally:
        hands_detector.close()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
