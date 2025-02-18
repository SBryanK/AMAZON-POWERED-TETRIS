import { useState, useEffect, useCallback } from 'react'

export const useGameStatus = (rowsCleared) => {
  const [score, setScore] = useState(0)
  const [rows, setRows] = useState(0)
  const [level, setLevel] = useState(0)

  const calcScore = useCallback(() => {
    // Each row = +100 points
    if (rowsCleared > 0) {
      setScore((prev) => prev + rowsCleared * 100)
      setRows((prev) => prev + rowsCleared)
    }
  }, [rowsCleared])

  useEffect(() => {
    calcScore()
  }, [calcScore, rowsCleared])

  return [score, setScore, rows, setRows, level, setLevel]
}
