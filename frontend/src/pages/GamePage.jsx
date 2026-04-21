import React, { useEffect, useState, useRef, useCallback } from 'react'
import axios from 'axios'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Tetris from '../game/Tetris'
import HandControlOverlay from '../components/HandControlOverlay'
import NextPieceView from '../components/NextPieceView'
import config from '../config'
import soundManager from '../game/SoundManager'
import './GamePage.css'

const COMMAND_THROTTLE_MS = 90 // only used as a safety floor between edge re-triggers
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
  // Currently-touched control zone (reported by the backend). Passed to the
  // overlay so the corresponding box lights up while the user is in it.
  const [activeZone, setActiveZone] = useState(null)

  const tetrisRef = useRef(null)
  const navigate = useNavigate()

  // Edge-trigger state machine for hand-gesture input.
  // `prevZoneRef` holds the last zone we observed from the backend so we can
  // detect null->ZONE and ZONE->OTHER transitions. For discrete actions
  // (LEFT/RIGHT/UP) a move fires ONLY on the entering edge; the user must
  // leave the box and come back to re-fire. DOWN is held-key semantics:
  // soft-drop starts when the zone becomes DOWN and ends the moment it is
  // no longer DOWN.
  const prevZoneRef = useRef(null)
  const lastEdgeTimeRef = useRef(0)
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
      setActiveZone(null)
      // Ensure we don't leave soft-drop latched on if the connection dies
      // while the hand happened to be over the DOWN box.
      tetrisRef.current?.setSoftDropping(false)
      prevZoneRef.current = null
      if (!gameOverRef.current) {
        setTimeout(() => connectWebSocket(), WS_RECONNECT_DELAY)
      }
    }
    socket.onerror = () => { socket.close() }
    socket.onmessage = (evt) => {
      if (gameOverRef.current || pausedRef.current) {
        tetrisRef.current?.setSoftDropping(false)
        return
      }
      let data
      try { data = JSON.parse(evt.data) } catch (err) {
        console.error('WS parse error:', err)
        return
      }
      // Backend sends both `zone` (new) and `button` (legacy alias). Accept
      // either so this code keeps working if the backend is ever rolled back.
      const zone = (data.zone !== undefined ? data.zone : data.button) || null
      setActiveZone(zone)

      const prev = prevZoneRef.current
      const tetris = tetrisRef.current
      if (!tetris) { prevZoneRef.current = zone; return }

      // --- Held-key semantics for DOWN (soft-drop) ---------------------
      // Continuous while the hand is inside the DOWN box; released the
      // instant it leaves. This mirrors pressing & holding the keyboard
      // Down arrow.
      if (zone === 'DOWN' && prev !== 'DOWN') {
        tetris.setSoftDropping(true)
      } else if (zone !== 'DOWN' && prev === 'DOWN') {
        tetris.setSoftDropping(false)
      }

      // --- Edge-trigger semantics for LEFT / RIGHT / UP ----------------
      // Fire EXACTLY ONCE when the zone transitions from anything-else to
      // the target zone. To fire again, the user must leave the box
      // (zone becomes null or a different zone) and re-enter.
      if (zone && zone !== prev && zone !== 'DOWN') {
        const now = Date.now()
        // Safety floor: never fire two discrete moves closer than ~90ms,
        // which is faster than any real human re-entry but prevents a
        // pathological flicker from producing a double-tap.
        if (now - lastEdgeTimeRef.current >= COMMAND_THROTTLE_MS) {
          lastEdgeTimeRef.current = now
          switch (zone) {
            case 'LEFT':  tetris.moveLeft();  break
            case 'RIGHT': tetris.moveRight(); break
            case 'UP':    tetris.rotate();    break
            default: break
          }
        }
      }

      prevZoneRef.current = zone
    }
    setWs(socket)
    return socket
  }, [])

  useEffect(() => {
    const socket = connectWebSocket()
    return () => {
      // Best-effort cleanup: stop any active soft-drop before tearing down
      // the socket so a piece doesn't keep auto-dropping through the next
      // render.
      tetrisRef.current?.setSoftDropping(false)
      prevZoneRef.current = null
      socket.close()
    }
  }, [connectWebSocket])

  // If the game is paused or ends while the hand is still hovering DOWN,
  // explicitly release soft-drop so it doesn't resume on unpause.
  useEffect(() => {
    if (paused || gameOver) {
      tetrisRef.current?.setSoftDropping(false)
    }
  }, [paused, gameOver])

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
          <button
            className={`sound-btn ${soundEnabled ? '' : 'muted'}`}
            onClick={toggleSound}
            title={soundEnabled ? 'Mute sound (M)' : 'Unmute sound (M)'}
            aria-pressed={!soundEnabled}
          >
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
          <HandControlOverlay ws={ws} activeZone={activeZone} />
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
