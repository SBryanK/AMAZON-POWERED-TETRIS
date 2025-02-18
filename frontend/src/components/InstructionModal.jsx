import React from 'react'
import './InstructionModal.css'

const InstructionModal = ({ onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h2>How to Play Tetris + CV</h2>
        <p className="instructions-text">
          Use your hand’s index fingertip to move:
          <br/>- LEFT box = move left
          <br/>- RIGHT box = move right
          <br/>- UP box = rotate
          <br/>- DOWN box = faster fall
          <br/>Clear lines for points. Enjoy!
        </p>
        <button className="close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

export default InstructionModal
