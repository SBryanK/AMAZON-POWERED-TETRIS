import React from 'react'
import { StyledStage } from './styles/StyledStage'
import Cell from './Cell'

const Stage = ({ stage, player, ghostY }) => {
  // Build a display stage that includes the ghost piece
  const displayStage = stage.map((row, y) =>
    row.map((cell, x) => {
      // Check if this cell should show the ghost piece
      if (player && ghostY !== undefined && cell[0] === 0 && cell[1] === 'clear') {
        const relY = y - ghostY
        const relX = x - player.pos.x
        if (
          relY >= 0 && relY < player.tetromino.length &&
          relX >= 0 && relX < player.tetromino[0].length &&
          player.tetromino[relY][relX] !== 0 &&
          // Don't draw ghost where the actual piece is
          (y < player.pos.y || y >= player.pos.y + player.tetromino.length ||
           x < player.pos.x || x >= player.pos.x + player.tetromino[0].length ||
           player.tetromino[y - player.pos.y][x - player.pos.x] === 0)
        ) {
          return [player.tetromino[relY][relX], 'ghost']
        }
      }
      return cell
    })
  )

  return (
    <StyledStage width={displayStage[0].length} height={displayStage.length}>
      {displayStage.map((row, y) =>
        row.map((cell, x) => (
          <Cell key={`${x}-${y}`} type={cell[0]} isGhost={cell[1] === 'ghost'} />
        ))
      )}
    </StyledStage>
  )
}

export default Stage
