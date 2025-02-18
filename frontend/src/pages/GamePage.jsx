import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import Tetris from '../game/Tetris'
import HandControlOverlay from '../components/HandControlOverlay'
import NextPieceView from '../components/NextPieceView'
import './GamePage.css'

const TOTAL_TIME = 180
const COMMAND_THROTTLE_MS = 600  // to slow repeated commands

const GamePage = () => {
  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [ws, setWs] = useState(null)
  const [nextShape, setNextShape] = useState(null)
  const [paused, setPaused] = useState(false)

  const tetrisRef = useRef(null)
  const navigate = useNavigate()

  // Throttling repeated commands
  const [lastCommand, setLastCommand] = useState(null)
  const [lastTime, setLastTime] = useState(0)

  // Timer
  useEffect(() => {
    if (gameOver || paused) return
    if (timeLeft <= 0) {
      setGameOver(true)
      return
    }
    const timer = setInterval(() => setTimeLeft(t => t - 1), 1000)
    return () => clearInterval(timer)
  }, [timeLeft, gameOver, paused])

  // WebSocket for hand detection
  useEffect(() => {
    const socket = new WebSocket('ws://localhost:8000/ws')
    setWs(socket)

    socket.onopen = () => console.log('WebSocket connected')
    socket.onclose = () => console.log('WebSocket disconnected')

    socket.onmessage = (evt) => {
      if (gameOver || paused) return
      const now = Date.now()
      try {
        const data = JSON.parse(evt.data)
        if (!data.button || !tetrisRef.current) {
          // revert "DOWN"
          tetrisRef.current?.setSoftDropping(false)
          return
        }
        // throttle repeated commands
        if (data.button === lastCommand && (now - lastTime) < COMMAND_THROTTLE_MS) {
          return
        }
        setLastCommand(data.button)
        setLastTime(now)

        // Trigger Tetris moves
        switch (data.button) {
          case 'LEFT':
            tetrisRef.current.moveLeft()
            break
          case 'RIGHT':
            tetrisRef.current.moveRight()
            break
          case 'UP':
            tetrisRef.current.rotate()
            break
          case 'DOWN':
            // Soft drop
            tetrisRef.current.setSoftDropping(true)
            break
          default:
            break
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    return () => socket.close()
  }, [gameOver, paused, lastCommand, lastTime])

  // Post scoreboard on game over
  useEffect(() => {
    if (gameOver) {
      const nm = localStorage.getItem('playerName') || 'Anonymous'
      axios.post('http://localhost:8000/scoreboard', { name: nm, score })
        .catch(err => console.error('Score save error:', err))
    }
  }, [gameOver, score])

  // Tetris callbacks
  const handleScoreUpdate = (val) => setScore(val)
  const handleGameOver = () => setGameOver(true)
  const handleNextShape = (shape) => setNextShape(shape)

  // Auto-start
  useEffect(() => {
    if (tetrisRef.current) {
      tetrisRef.current.startGame()
      setScore(0)
      setTimeLeft(TOTAL_TIME)
    }
  }, [])

  const goHome = () => navigate('/')

  // Pause logic
  const togglePause = () => {
    setPaused(prev => !prev)
  }

  return (
    <div className="game-container">
      {/* Left Tetris area (30%) */}
      <div className="tetris-panel">
        <Tetris
          ref={tetrisRef}
          onScoreUpdate={handleScoreUpdate}
          onGameOver={handleGameOver}
          onNextShapeUpdate={handleNextShape}
          gameOverExternal={gameOver || paused}
          externalTimeLeft={timeLeft}
        />
        <button className="pause-btn" onClick={togglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Right side: top bar + camera */}
      <div className="right-container">
        <div className="top-bar">
          <div className="top-item score-item">Score: {score}</div>
          <div className="top-item next-item">
            {nextShape ? <NextPieceView shape={nextShape} /> : 'Next??'}
          </div>
          <div className="top-item time-item">Time: {timeLeft}</div>
        </div>
        <div className="camera-panel">
          <HandControlOverlay ws={ws} />
        </div>
      </div>

      {gameOver && (
        <div className="game-over-overlay">
          <h1>GAME OVER</h1>
          <p>Your Score: {score}</p>
          <button onClick={goHome}>Back to Home</button>
        </div>
      )}
    </div>
  )
}

export default GamePage
