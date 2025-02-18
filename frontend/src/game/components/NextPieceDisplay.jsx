import React from 'react'
import styled from 'styled-components'
import Cell from '../game/components/Cell.jsx'

const StyledNextContainer = styled.div`
  display: grid;
  grid-template-rows: repeat(4, 20px);
  grid-template-columns: repeat(4, 20px);
  gap: 3px;
  background: #222;
  padding: 10px;
  border: 2px solid #333;
  border-radius: 8px;
  margin-bottom: 15px;
`

/**
 * shape: e.g. [
 *   [0,'T',0],
 *   [ etc... ]
 * ]
 * We want to place it in a 4x4 grid so it looks centered.
 */
const NextPieceDisplay = ({ shape }) => {
  if (!shape) return null

  // shape might be 4x4, or 3x3, or 2x2
  // let's create a 4x4 buffer
  const previewGrid = Array.from({ length: 4 }, () => Array(4).fill(0))

  // find bounding box of shape
  let top = shape.length
  let bottom = 0
  let left = shape[0].length
  let right = 0

  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (shape[r][c] !== 0) {
        if (r < top) top = r
        if (r > bottom) bottom = r
        if (c < left) left = c
        if (c > right) right = c
      }
    }
  }
  const shapeHeight = bottom - top + 1
  const shapeWidth = right - left + 1

  // We'll center it in the 4x4
  const offsetRow = Math.floor((4 - shapeHeight) / 2)
  const offsetCol = Math.floor((4 - shapeWidth) / 2)

  // place shape into previewGrid
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (shape[r][c] !== 0) {
        previewGrid[r - top + offsetRow][c - left + offsetCol] = shape[r][c]
      }
    }
  }

  return (
    <StyledNextContainer>
      {previewGrid.map((row, y) =>
        row.map((cell, x) => (
          <Cell key={`${y}-${x}`} type={cell} />
        ))
      )}
    </StyledNextContainer>
  )
}

export default NextPieceDisplay
