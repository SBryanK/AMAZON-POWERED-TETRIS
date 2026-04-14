import React, { useEffect, useState, useRef, useCallback } from 'react'
import axios from 'axios'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Tetris from '../game/Tetris'
import HandControlOverlay from '../components/HandControlOverlay'
import NextPieceView from '../components/NextPieceView'
import config from '../config'
import soundManager from '../game/SoundManager'
import './GamePage.css'

const COMMAND_THROTTLE_MS = 600
const WS_RECONNECT_DELAY = 2000

const GamePage = () => {
  const [searchParams] = useSearchParams()
  const gameMode = searchParams.get('mode') || 'timed' // 'timed' | 'endless' | 'sprint'
  const TOTAL_TIME = gameMode === 'timed' ? 180 : null
  const SPRINT_TARGET = 40

  const [timeLeft, setTimeLeft] = useState(TOTAL_TIME)
  const [elapsed, setElapsed] = useState(0)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [ws, setWs] = useState(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [nextShape, setNextShape] = useState(null)
  const [holdShape, setHoldShape] = useState(null)
  const [paused, setPaused] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [stats, setStats] = useState({ piecesPlaced: 0, tetrisCount: 0, linesCleared: 0 })
  const [lineClearFlash, setLineClearFlash] = useState(false)
  const [showStats, setShowStats] = useState(false)

  const tetrisRef = useRef(null)
  const navigate = useNavigate()

  const lastCommandRef = useRef(null)
  const lastTimeRef = useRef(0)
  const gameOverRef = useRef(false)
  const pausedRef = useRef(false)

  useEffect(() => { gameOverRef.current = gameOver }, [gameOver])
  useEffect(() => { pausedRef.current = paused }, [paused])

  // Timer — only for timed mode
  useEffect(() => {
    if (gameOver || paused) return
    const timer = setInterval(() => {
      setElapsed(e => e + 1)
      if (gameMode === 'timed') {
        setTimeLeft(t => {
          if (t <= 1) { setGameOver(true); return 0 }
          return t - 1
        })
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [gameOver, paused, gameMode])

  // Sprint mode: check if target lines reached
  useEffect(() => {
    if (gameMode === 'sprint' && stats.linesCleared >= SPRINT_TARGET && !gameOver) {
      setGameOver(true)
    }
  }, [stats.linesCleared, gameMode, gameOver])

  // Line clear flash animation
  useEffect(() => {
    if (stats.linesCleared > 0 && !lineClearFlash) {
      setLineClearFlash(true)
      const timer = setTimeout(() => setLineClearFlash(false), 300)
      return () => clearTimeout(timer)
    }
  }, [stats.linesCleared])

  // WebSocket
  const connectWebSocket = useCallback(() => {
    const socket = new WebSocket(config.websocketEndpoint)
    socket.onopen = () => { setWsConnected(true) }
    socket.onclose = () => {
      setWsConnected(false)
      if (!gameOverRef.current) {
        setTimeout(() => connectWebSocket(), WS_RECONNECT_DELAY)
      }
    }
    socket.onerror = () => { socket.close() }
    socket.onmessage = (evt) => {
      if (gameOverRef.current || pausedRef.current) return
      const now = Date.now()
      try {
        const data = JSON.parse(evt.data)
        if (!data.button || !tetrisRef.current) {
          tetrisRef.current?.setSoftDropping(false)
          return
        }
        if (data.button === lastCommandRef.current && (now - lastTimeRef.current) < COMMAND_THROTTLE_MS) return
        lastCommandRef.current = data.button
        lastTimeRef.current = now
        switch (data.button) {
          case 'LEFT': tetrisRef.current.moveLeft(); break
          case 'RIGHT': tetrisRef.current.moveRight(); break
          case 'UP': tetrisRef.current.rotate(); break
          case 'DOWN': tetrisRef.current.setSoftDropping(true); break
          default: break
        }
      } catch (err) { console.error('WS parse error:', err) }
    }
    setWs(socket)
    return socket
  }, [])

  useEffect(() => {
    const socket = connectWebSocket()
    return () => socket.close()
  }, [connectWebSocket])

  // Global keyboard controls
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Allow pause toggle even when paused
      if ((e.key === 'p' || e.key === 'P') && !gameOver) {
        e.preventDefault()
        setPaused(prev => !prev)
        return
      }
      if (gameOver || paused || !tetrisRef.current) return
      switch (e.key) {
        case 'ArrowLeft': e.preventDefault(); tetrisRef.current.moveLeft(); break
        case 'ArrowRight': e.preventDefault(); tetrisRef.current.moveRight(); break
        case 'ArrowUp': e.preventDefault(); tetrisRef.current.rotate(); break
        case 'ArrowDown': e.preventDefault(); tetrisRef.current.setSoftDropping(true); break
        case ' ': e.preventDefault(); tetrisRef.current.hardDrop(); break
        case 'c': case 'C': e.preventDefault(); tetrisRef.current.holdPiece(); break
        case 'm': case 'M': e.preventDefault(); toggleSound(); break
        default: break
      }
    }
    const handleKeyUp = (e) => {
      if (e.key === 'ArrowDown' && tetrisRef.current) tetrisRef.current.setSoftDropping(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keyup', handleKeyUp)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keyup', handleKeyUp)
    }
  }, [gameOver, paused])

  // Touch controls
  const touchStartRef = useRef(null)
  useEffect(() => {
    const handleTouchStart = (e) => {
      if (gameOver || paused || !tetrisRef.current) return
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() }
    }
    const handleTouchEnd = (e) => {
      if (!touchStartRef.current || gameOver || paused || !tetrisRef.current) return
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x
      const dy = e.changedTouches[0].clientY - touchStartRef.current.y
      const dt = Date.now() - touchStartRef.current.time
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (absDx < 10 && absDy < 10 && dt < 200) {
        // Tap = hard drop
        tetrisRef.current.hardDrop()
      } else if (absDx > absDy) {
        if (dx > 30) tetrisRef.current.moveRight()
        else if (dx < -30) tetrisRef.current.moveLeft()
      } else {
        if (dy > 30) tetrisRef.current.setSoftDropping(true)
        else if (dy < -30) tetrisRef.current.rotate()
      }
      touchStartRef.current = null
    }
    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    document.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [gameOver, paused])

  // Post scoreboard on game over
  useEffect(() => {
    if (gameOver) {
      soundManager.stopMusic()
      const nm = localStorage.getItem('playerName') || 'Anonymous'
      axios.post(config.scoreboardEndpoint, { name: nm, score }).catch(() => {})
    }
  }, [gameOver, score])

  const handleScoreUpdate = (val) => setScore(val)
  const handleGameOver = () => setGameOver(true)
  const handleNextShape = (shape) => setNextShape(shape)
  const handleHoldShape = (shape) => setHoldShape(shape)
  const handleStatsUpdate = (s) => setStats(s)

  // Auto-start
  useEffect(() => {
    if (tetrisRef.current) {
      tetrisRef.current.startGame()
      setScore(0)
      setElapsed(0)
      if (TOTAL_TIME) setTimeLeft(TOTAL_TIME)
    }
  }, [])

  const goHome = () => { soundManager.stopMusic(); navigate('/') }
  const playAgain = () => {
    setGameOver(false)
    setShowStats(false)
    setStats({ piecesPlaced: 0, tetrisCount: 0, linesCleared: 0 })
    setHoldShape(null)
    setElapsed(0)
    if (TOTAL_TIME) setTimeLeft(TOTAL_TIME)
    if (tetrisRef.current) {
      tetrisRef.current.startGame()
      setScore(0)
    }
  }
  const togglePause = () => setPaused(prev => !prev)
  const toggleSound = () => {
    const enabled = soundManager.toggle()
    setSoundEnabled(enabled)
  }

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const modeLabel = gameMode === 'endless' ? 'Endless' : gameMode === 'sprint' ? `Sprint (${SPRINT_TARGET}L)` : 'Time Attack'

  return (
    <div className={`game-container ${lineClearFlash ? 'line-flash' : ''}`}>
      <div className="tetris-panel">
        <Tetris
          ref={tetrisRef}
          onScoreUpdate={handleScoreUpdate}
          onGameOver={handleGameOver}
          onNextShapeUpdate={handleNextShape}
          onHoldShapeUpdate={handleHoldShape}
          onStatsUpdate={handleStatsUpdate}
          gameOverExternal={gameOver || paused}
          externalTimeLeft={timeLeft}
        />
        <div className="panel-buttons">
          <button className="pause-btn" onClick={togglePause}>
            {paused ? '▶' : '⏸'}
          </button>
          <button className="sound-btn" onClick={toggleSound}>
            {soundEnabled ? '🔊' : '🔇'}
          </button>
        </div>
      </div>

      <div className="right-container">
        <div className="top-bar">
          <div className="top-item mode-item">{modeLabel}</div>
          <div className="top-item score-item">Score: {score}</div>
          <div className="top-item hold-item">
            <span className="label-text">Hold</span>
            {holdShape ? <NextPieceView shape={holdShape} /> : <span className="empty-box">—</span>}
          </div>
          <div className="top-item next-item">
            <span className="label-text">Next</span>
            {nextShape ? <NextPieceView shape={nextShape} /> : <span className="empty-box">—</span>}
          </div>
          <div className="top-item time-item">
            {gameMode === 'timed' ? `⏱ ${formatTime(timeLeft || 0)}` : `⏱ ${formatTime(elapsed)}`}
          </div>
          <div className="top-item lines-item">Lines: {stats.linesCleared}</div>
          <div className={`top-item ws-status ${wsConnected ? 'connected' : 'disconnected'}`}>
            {wsConnected ? '🟢' : '🔴'}
          </div>
        </div>
        <div className="camera-panel">
          <HandControlOverlay ws={ws} />
        </div>
      </div>

      {paused && !gameOver && (
        <div className="pause-overlay">
          <h1>PAUSED</h1>
          <p>Press P or click ▶ to resume</p>
        </div>
      )}

      {gameOver && !showStats && (
        <div className="game-over-overlay">
          <h1>GAME OVER</h1>
          <p className="final-score">Score: {score}</p>
          <div className="game-over-buttons">
            <button onClick={() => setShowStats(true)}>📊 Stats</button>
            <button onClick={playAgain}>🔄 Play Again</button>
            <button onClick={goHome}>🏠 Home</button>
          </div>
        </div>
      )}

      {showStats && (
        <div className="game-over-overlay">
          <h1>GAME STATS</h1>
          <div className="stats-grid">
            <div className="stat-item"><span className="stat-label">Score</span><span className="stat-value">{score}</span></div>
            <div className="stat-item"><span className="stat-label">Lines</span><span className="stat-value">{stats.linesCleared}</span></div>
            <div className="stat-item"><span className="stat-label">Pieces</span><span className="stat-value">{stats.piecesPlaced}</span></div>
            <div className="stat-item"><span className="stat-label">Tetrises</span><span className="stat-value">{stats.tetrisCount}</span></div>
            <div className="stat-item"><span className="stat-label">Time</span><span className="stat-value">{formatTime(elapsed)}</span></div>
          </div>
          <div className="game-over-buttons">
            <button onClick={playAgain}>🔄 Play Again</button>
            <button onClick={goHome}>🏠 Home</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GamePage
