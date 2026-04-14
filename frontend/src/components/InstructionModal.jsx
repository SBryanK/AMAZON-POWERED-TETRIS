import React from 'react'
import './InstructionModal.css'

const InstructionModal = ({ onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2>How to Play APT</h2>

        <p className="instructions-text">
          <strong>🎮 Game Modes:</strong>
          <br/>- Time Attack: 180s, highest score wins
          <br/>- Endless: Classic Tetris, play until you top out
          <br/>- Sprint: Clear 40 lines as fast as possible
        </p>

        <p className="instructions-text">
          <strong>⌨️ Keyboard Controls:</strong>
          <br/>- ← → Arrows = move left/right
          <br/>- ↑ Arrow = rotate
          <br/>- ↓ Arrow = soft drop
          <br/>- Space = hard drop (instant)
          <br/>- C = hold piece
          <br/>- P = pause / resume
          <br/>- M = mute / unmute sound
        </p>

        <p className="instructions-text">
          <strong>📱 Touch Controls:</strong>
          <br/>- Swipe left/right = move
          <br/>- Swipe up = rotate
          <br/>- Swipe down = soft drop
          <br/>- Tap = hard drop
        </p>

        <p className="instructions-text">
          <strong>🖐 Hand Gesture Controls:</strong>
          <br/>Point your index finger into the zones on the camera feed.
        </p>

        <p className="instructions-text">
          <strong>📊 Scoring (NES Tetris):</strong>
          <br/>- 1 line = 40 × level
          <br/>- 2 lines = 100 × level
          <br/>- 3 lines = 300 × level
          <br/>- 4 lines (Tetris!) = 1200 × level
          <br/>Speed increases every 10 lines!
        </p>

        <p className="instructions-text">
          <strong>💡 Tips:</strong>
          <br/>- 👻 Ghost piece shows where your piece will land
          <br/>- 📦 Hold (C) lets you save a piece for later
          <br/>- 🎵 Background music plays the Tetris theme
        </p>

        <button className="close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

export default InstructionModal
