import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import InstructionModal from '../components/InstructionModal'
import config from '../config'
import './HomePage.css'

const GAME_MODES = [
  { id: 'timed', label: '⏱ Time Attack', desc: '180 seconds — highest score wins' },
  { id: 'endless', label: '♾️ Endless', desc: 'Classic Tetris — play until you top out' },
  { id: 'sprint', label: '🏃 Sprint', desc: 'Clear 40 lines as fast as possible' },
]

const HomePage = () => {
  const [playerName, setPlayerName] = useState('')
  const [scores, setScores] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [hasLoadedScores, setHasLoadedScores] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [selectedMode, setSelectedMode] = useState('timed')
  const navigate = useNavigate()
  const inputRef = useRef(null)

  useEffect(() => {
    fetchScores()
    if (inputRef.current) inputRef.current.focus()
  }, [])

  const fetchScores = async () => {
    try {
      const res = await axios.get(config.scoreboardEndpoint)
      if (res.data.topScores) setScores(res.data.topScores)
      setHasLoadedScores(true)
    } catch (err) {
      console.error('Error fetch scoreboard:', err)
      setHasLoadedScores(true)
    }
  }

  const startGame = () => {
    const nm = playerName.trim()
    if (!nm || nm.toLowerCase() === 'anonymous') {
      setErrorMsg('Name cannot be empty or "anonymous"!')
      return
    }
    localStorage.setItem('playerName', nm)
    navigate(`/game?mode=${selectedMode}`)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') startGame()
  }

  return (
    <div className="home-container">
      <div className="header-title">
        <h1 className="main-title">THIS IS APT!</h1>
        <h2 className="subtitle">AMAZON POWERED TETRIS</h2>
      </div>

      <div className="form-box">
        <h3 className="enter-name-title">Enter Your Name</h3>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type your name..."
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={20}
        />
        {errorMsg && <div className="error-msg">{errorMsg}</div>}

        {/* Game Mode Selector */}
        <div className="mode-selector">
          {GAME_MODES.map(mode => (
            <button
              key={mode.id}
              className={`mode-btn ${selectedMode === mode.id ? 'active' : ''}`}
              onClick={() => setSelectedMode(mode.id)}
              title={mode.desc}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="mode-desc">{GAME_MODES.find(m => m.id === selectedMode)?.desc}</p>

        <button className="start-btn" onClick={startGame}>Start Game</button>

        <div className="scoreboard-box">
          <h4 className="scoreboard-title">🏆 Leaderboard</h4>
          {(!scores.length && hasLoadedScores) ? (
            <div className="no-score">No scores yet!</div>
          ) : (
            <table className="score-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((item, i) => (
                  <tr key={i} className={i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}>
                    <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                    <td>{item.name}</td>
                    <td>{item.score.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="help-icon" onClick={() => setShowModal(true)}>?</div>
      {showModal && <InstructionModal onClose={() => setShowModal(false)} />}
    </div>
  )
}

export default HomePage
