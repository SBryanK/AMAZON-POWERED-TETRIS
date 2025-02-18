import React from 'react'
import { StyledStage } from './styles/StyledStage'
import Cell from './Cell'

const Stage = ({ stage }) => (
  <StyledStage width={stage[0].length} height={stage.length}>
    {stage.map((row, y) =>
      row.map((cell, x) => (
        <Cell key={`${x}-${y}`} type={cell[0]} />
      ))
    )}
  </StyledStage>
)

export default Stage
