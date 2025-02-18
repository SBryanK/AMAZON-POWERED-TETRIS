import React from 'react'
import styled from 'styled-components'
import Cell from '../game/components/Cell'

const StyledPreview = styled.div`
  display: grid;
  grid-template-rows: repeat(4, 15px);
  grid-template-columns: repeat(4, 15px);
  gap: 3px;
  background: #000;
  border: 2px solid #ccc;
  border-radius: 5px;
  padding: 2px;
`

const NextPieceView = ({ shape }) => {
  if (!shape) return null
  // Center the shape in a 4x4 grid.
  const preview = Array.from({ length: 4 }, () => Array(4).fill(0))
  let top = shape.length, left = shape[0].length, bottom = 0, right = 0
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
  const h = bottom - top + 1
  const w = right - left + 1
  const offsetR = Math.floor((4 - h) / 2)
  const offsetC = Math.floor((4 - w) / 2)
  for (let r = top; r <= bottom; r++) {
    for (let c = left; c <= right; c++) {
      if (shape[r][c] !== 0) {
        preview[r - top + offsetR][c - left + offsetC] = shape[r][c]
      }
    }
  }
  return (
    <StyledPreview>
      {preview.map((row, y) =>
        row.map((val, x) => <Cell key={`${y}-${x}`} type={val} />)
      )}
    </StyledPreview>
  )
}

export default NextPieceView
