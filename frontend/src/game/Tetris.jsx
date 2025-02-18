import React, { useState, useImperativeHandle, forwardRef, useEffect } from 'react'
import { createStage, checkCollision } from './gameHelpers'
import { randomTetromino } from './tetrominos'
import { usePlayer } from './hooks/usePlayer'
import { useStage } from './hooks/useStage'
import { useGameStatus } from './hooks/useGameStatus'
import { useInterval } from './hooks/useInterval'
import Stage from './components/Stage'
import { StyledTetrisWrapper, StyledTetris } from './components/styles/StyledTetris'

const NORMAL_DROP = 700
const SOFT_DROP = 400

const Tetris = forwardRef(({
  onScoreUpdate,
  onGameOver,
  onNextShapeUpdate,
  gameOverExternal,
  externalTimeLeft
}, ref) => {
  const [dropTime, setDropTime] = useState(null)
  const [softDropping, setSoftDropping] = useState(false)
  const [gameOver, setGameOver] = useState(false)

  // Next shape is what will spawn next
  const [nextShape, setNextShape] = useState(randomTetromino().shape)

  const [player, updatePlayerPos, resetPlayer, playerRotate, setPlayer] = usePlayer()
  const [stage, setStage, rowsCleared] = useStage(player, resetPlayer)
  const [score, setScore, rows, setRows, level, setLevel] = useGameStatus(rowsCleared)

  useImperativeHandle(ref, () => ({
    startGame() {
      setStage(createStage())
      setSoftDropping(false)
      setDropTime(NORMAL_DROP)
      setScore(0)
      setRows(0)
      setLevel(0)
      setGameOver(false)
      // Initialize next shape
      const initShape = randomTetromino().shape
      setNextShape(initShape)
      if (onNextShapeUpdate) onNextShapeUpdate(initShape)

      // Spawn the first piece
      spawnPiece(initShape)
    },
    moveLeft: () => move({ keyCode: 37 }),
    moveRight: () => move({ keyCode: 39 }),
    rotate: () => move({ keyCode: 38 }),
    setSoftDropping: (active) => setSoftDropping(active)
  }))

  function spawnPiece(shape) {
    setPlayer({
      pos: { x: 3, y: 0 },
      tetromino: shape,
      collided: false
    })
  }

  useEffect(() => {
    if (player.collided) {
      if (player.pos.y < 1) {
        // If the tetromino collides immediately at the top, it means game over.
        setGameOver(true);
        setDropTime(null);
        onGameOver && onGameOver();
      } else {
        // Spawn the next tetromino onto the board
        spawnPiece(nextShape);
        
        // Immediately generate a new random tetromino for the "next" display.
        const newNextShape = randomTetromino().shape;
        setNextShape(newNextShape);
        
        // Notify the parent component so that the UI (e.g., top bar) shows the new next tetromino.
        if (onNextShapeUpdate) {
          onNextShapeUpdate(newNextShape);
        }
      }
    }
  }, [player.collided]);

  const drop = () => {
    // level logic
    if (rows > (level + 1) * 10) {
      setLevel(prev => prev + 1)
      setDropTime(softDropping ? SOFT_DROP / (level + 1) : NORMAL_DROP / (level + 1))
    }
    if (!checkCollision(player, stage, { x: 0, y: 1 })) {
      updatePlayerPos({ x: 0, y: 1, collided: false })
    } else {
      if (player.pos.y < 1) {
        // game over
        setGameOver(true)
        setDropTime(null)
        if (onGameOver) onGameOver()
      } else {
        updatePlayerPos({ x: 0, y: 0, collided: true })
      }
    }
  }

  // Interval
  useInterval(() => {
    if (!gameOver && !gameOverExternal) {
      drop()
    }
  }, dropTime)

  useEffect(() => {
    if (!gameOver && !gameOverExternal) {
      setDropTime(softDropping ? SOFT_DROP : NORMAL_DROP)
    }
  }, [softDropping, gameOver, gameOverExternal])

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
      // rotate
      playerRotate(stage, 1)
    } else if (keyCode === 40) {
      setSoftDropping(true)
    }
  }
  const keyUp = ({ keyCode }) => {
    if (keyCode === 40) {
      setSoftDropping(false)
    }
  }

  useEffect(() => {
    if (onScoreUpdate) onScoreUpdate(score)
  }, [score, onScoreUpdate])

  return (
    <StyledTetrisWrapper
      role="button"
      tabIndex="0"
      onKeyDown={move}
      onKeyUp={keyUp}
    >
      <StyledTetris>
        <Stage stage={stage} />
      </StyledTetris>
    </StyledTetrisWrapper>
  )
})

export default Tetris
