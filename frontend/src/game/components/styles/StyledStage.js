import styled from 'styled-components'

/*
 * The playfield is sized by viewport HEIGHT, not width, so that:
 *   - 20 rows always fit inside the panel no matter how wide the screen is,
 *   - the cells stay square,
 *   - and there is room below the board for the pause / sound buttons
 *     without them overlapping the stage.
 *
 * We reserve ~20vh of vertical space for the top title bar + bottom button
 * row + internal padding, so each cell is `(100vh - 20vh) / 20 rows` ≈ 4vh.
 * A max-width cap prevents the board from growing absurdly wide on tall,
 * narrow displays (portrait phones / kiosks).
 */
export const StyledStage = styled.div`
  --cell-size: min(4vh, calc(25vw / ${props => props.width}));

  display: grid;
  grid-template-rows: repeat(${props => props.height}, var(--cell-size));
  grid-template-columns: repeat(${props => props.width}, var(--cell-size));
  grid-gap: 1px;
  border: 2px solid #333;
  background: #111;
  /* Width auto-shrinks to fit the columns, which prevents the board from
     stretching beyond the panel and overlapping the pause/sound buttons. */
  width: max-content;
  max-width: 100%;
  box-sizing: content-box;
`
