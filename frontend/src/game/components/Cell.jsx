import React from 'react'
import { StyledCell } from './styles/StyledCell'
import { TETROMINOS } from '../tetrominos'

const Cell = ({ type, isGhost }) => (
  <StyledCell type={type} color={TETROMINOS[type].color} $isGhost={isGhost} />
)

export default React.memo(Cell)
