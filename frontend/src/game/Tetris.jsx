import React, { useState, useImperativeHandle, forwardRef, useEffect, useRef } from 'react'
import { createStage, checkCollision } from './gameHelpers'
import { randomTetromino, TETROMINOS } from './tetrominos'
import { usePlayer } from './hooks/usePlayer'
import { useStage } from './hooks/useStage'
import { useGameStatus } from './hooks/useGameStatus'
import { useInterval } from './hooks/useInterval'
import Stage from './components/Stage'
import { StyledTetrisWrapper, StyledTetris } from './components/styles/StyledTetris'
import soundManager from './SoundManager'

const NORMAL_DROP = 850
const SOFT_DROP_FACTOR = 0.3
const MIN_DROP_TIME = 100
const SPEED_INCREMENT = 50

const Tetris = forwardRef(({
  onScoreUpdate,
  onGameOver,
  onNextShapeUpdate,
  onHoldShapeUpdate,
  onStatsUpdate,
  gameOverExternal,
  externalTimeLeft
}, ref) => {
  const [dropTime, setDropTime] = useState(null)
  const [softDropping, setSoftDropping] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [nextShape, setNextShape] = useState(randomTetromino().shape)

  // Hold piece state
  const [holdShape, setHoldShape] = useState(null)
  const [canHold, setCanHold] = useState(true)

  // Game stats
  const statsRef = useRef({ piecesPlaced: 0, tetrisCount: 0, linesCleared: 0 })

  const [player, updatePlayerPos, resetPlayer, playerRotate, setPlayer] = usePlayer()
  const [stage, setStage, rowsCleared] = useStage(player, resetPlayer)
  const [score, setScore, rows, setRows, level, setLevel] = useGameStatus(rowsCleared)

  const prevLevelRef = useRef(0)
  const prevRowsClearedRef = useRef(0)

  // Ghost piece Y position
  const getGhostY = () => {
    if (!player.tetromino || (player.tetromino.length === 1 && player.tetromino[0].length === 1)) {
      return player.pos.y
    }
    let ghostY = 0
    const maxDrop = 25
    while (ghostY < maxDrop && !checkCollision(player, stage, { x: 0, y: ghostY + 1 })) {
      ghostY += 1
    }
    return player.pos.y + ghostY
  }

  const getDropSpeed = (isSoft) => {
    const baseSpeed = Math.max(NORMAL_DROP - level * SPEED_INCREMENT, MIN_DROP_TIME)
    return isSoft ? Math.max(baseSpeed * SOFT_DROP_FACTOR, MIN_DROP_TIME) : baseSpeed
  }

  function spawnPiece(shape) {
    setPlayer({
      pos: { x: 3, y: 0 },
      tetromino: shape,
      collided: false
    })
  }

  // Hold piece: swap current piece with held piece
  function performHold() {
    if (gameOver || gameOverExternal || !canHold) return
    soundManager.hold()
    const currentTetromino = player.tetromino

    if (holdShape) {
      // Swap with held piece
      spawnPiece(holdShape)
    } else {
      // No held piece yet — spawn next piece
      spawnPiece(nextShape)
      const newNext = randomTetromino().shape
      setNextShape(newNext)
      if (onNextShapeUpdate) onNextShapeUpdate(newNext)
    }
    setHoldShape(currentTetromino)
    if (onHoldShapeUpdate) onHoldShapeUpdate(currentTetromino)
    setCanHold(false) // Can't hold again until next piece lands
  }

  function performHardDrop() {
    if (gameOver || gameOverExternal) return
    soundManager.hardDrop()
    let dropDistance = 0
    while (!checkCollision(player, stage, { x: 0, y: dropDistance + 1 })) {
      dropDistance += 1
    }
    updatePlayerPos({ x: 0, y: dropDistance, collided: true })
  }

  useImperativeHandle(ref, () => ({
    startGame() {
      setStage(createStage())
      setSoftDropping(false)
      setDropTime(NORMAL_DROP)
      setScore(0)
      setRows(0)
      setLevel(0)
      setGameOver(false)
      setHoldShape(null)
      setCanHold(true)
      statsRef.current = { piecesPlaced: 0, tetrisCount: 0, linesCleared: 0 }
      if (onHoldShapeUpdate) onHoldShapeUpdate(null)
      const initShape = randomTetromino().shape
      setNextShape(initShape)
      if (onNextShapeUpdate) onNextShapeUpdate(initShape)
      spawnPiece(initShape)
      soundManager.startMusic()
    },
    moveLeft() {
      move({ keyCode: 37 })
      soundManager.move()
    },
    moveRight() {
      move({ keyCode: 39 })
      soundManager.move()
    },
    rotate() {
      move({ keyCode: 38 })
      soundManager.rotate()
    },
    setSoftDropping: (active) => {
      // Never let an external caller (WebSocket or keyboard) latch soft-drop
      // ON while the game is paused or finished — if we did, the piece would
      // immediately start dropping the instant the game resumed.
      if (active && (gameOver || gameOverExternal)) return
      setSoftDropping(!!active)
    },
    hardDrop: () => performHardDrop(),
    holdPiece: () => performHold(),
    getStats: () => ({ ...statsRef.current }),
  }))

  // Handle collision — spawn next piece
  useEffect(() => {
    if (player.collided) {
      if (player.pos.y < 1) {
        setGameOver(true)
        setDropTime(null)
        soundManager.stopMusic()
        soundManager.gameOver()
        onGameOver && onGameOver()
      } else {
        statsRef.current.piecesPlaced += 1
        setCanHold(true) // Re-enable hold for the new piece
        spawnPiece(nextShape)
        const newNextShape = randomTetromino().shape
        setNextShape(newNextShape)
        if (onNextShapeUpdate) onNextShapeUpdate(newNextShape)
        if (onStatsUpdate) onStatsUpdate({ ...statsRef.current })
      }
    }
  }, [player.collided])

  // Track line clears for sound effects and stats
  useEffect(() => {
    if (rowsCleared > 0 && rowsCleared !== prevRowsClearedRef.current) {
      soundManager.lineClear(rowsCleared)
      statsRef.current.linesCleared += rowsCleared
      if (rowsCleared >= 4) statsRef.current.tetrisCount += 1
      if (onStatsUpdate) onStatsUpdate({ ...statsRef.current })
    }
    prevRowsClearedRef.current = rowsCleared
  }, [rowsCleared])

  // Level up sound
  useEffect(() => {
    if (level > prevLevelRef.current) {
      soundManager.levelUp()
    }
    prevLevelRef.current = level
  }, [level])

  const drop = () => {
    if (rows > (level + 1) * 10) {
      setLevel(prev => prev + 1)
    }
    if (!checkCollision(player, stage, { x: 0, y: 1 })) {
      updatePlayerPos({ x: 0, y: 1, collided: false })
    } else {
      if (player.pos.y < 1) {
        setGameOver(true)
        setDropTime(null)
        soundManager.stopMusic()
        soundManager.gameOver()
        if (onGameOver) onGameOver()
      } else {
        updatePlayerPos({ x: 0, y: 0, collided: true })
      }
    }
  }

  useInterval(() => {
    if (!gameOver && !gameOverExternal) {
      drop()
    }
  }, dropTime)

  useEffect(() => {
    if (!gameOver && !gameOverExternal) {
      setDropTime(getDropSpeed(softDropping))
    }
  }, [softDropping, gameOver, gameOverExternal, level])

  // Pause/resume music when game is paused externally
  useEffect(() => {
    if (gameOverExternal && !gameOver) {
      soundManager.stopMusic()
    } else if (!gameOverExternal && !gameOver && dropTime) {
      soundManager.startMusic()
    }
  }, [gameOverExternal])

  const move = ({ keyCode }) => {
    if (gameOver || gameOverExternal) return
    if (keyCode === 37) {
      if (!checkCollision(player, stage, { x: -1, y: 0 })) {
        updatePlayerPos({ x: -1, y: 0, collided: false })
      }
    } else if (keyCode === 39) {
      if (!checkCollision(player, stage, { x: 1, y: 0 })) {
        updatePlayerPos({ x: 1, y: 0, collided: false })
      }
    } else if (keyCode === 38) {
      playerRotate(stage, 1)
    } else if (keyCode === 40) {
      setSoftDropping(true)
    }
  }

  const keyUp = ({ keyCode }) => {
    if (keyCode === 40) setSoftDropping(false)
  }

  useEffect(() => {
    if (onScoreUpdate) onScoreUpdate(score)
  }, [score, onScoreUpdate])

  const ghostY = getGhostY()

  return (
    <StyledTetrisWrapper role="button" tabIndex="0" onKeyDown={move} onKeyUp={keyUp}>
      <StyledTetris>
        <Stage stage={stage} player={player} ghostY={ghostY} />
      </StyledTetris>
    </StyledTetrisWrapper>
  )
})

export default Tetris
