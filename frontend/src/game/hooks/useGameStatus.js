import { useState, useEffect, useCallback } from 'react'

// NES Tetris scoring: rewards multi-line clears exponentially
// 1 line = 40, 2 lines = 100, 3 lines = 300, 4 lines (Tetris!) = 1200
const LINE_POINTS = [0, 40, 100, 300, 1200]

export const useGameStatus = (rowsCleared) => {
  const [score, setScore] = useState(0)
  const [rows, setRows] = useState(0)
  const [level, setLevel] = useState(0)

  const calcScore = useCallback(() => {
    if (rowsCleared > 0) {
      const points = LINE_POINTS[Math.min(rowsCleared, 4)] || LINE_POINTS[4]
      setScore((prev) => prev + points * (level + 1))
      setRows((prev) => prev + rowsCleared)
    }
  }, [rowsCleared, level])

  useEffect(() => {
    calcScore()
  }, [calcScore, rowsCleared])

  return [score, setScore, rows, setRows, level, setLevel]
}
