import styled from 'styled-components'

export const StyledCell = styled.div`
  width: auto;
  background: ${props =>
    props.$isGhost
      ? `rgba(${props.color}, 0.15)`
      : `rgba(${props.color}, 0.8)`
  };
  border: ${props => {
    if (props.type === 0) return '0px solid'
    if (props.$isGhost) return `2px dashed rgba(${props.color}, 0.4)`
    return '4px solid'
  }};
  border-bottom-color: ${props => props.$isGhost ? 'transparent' : `rgba(${props.color}, 0.1)`};
  border-right-color: ${props => props.$isGhost ? 'transparent' : `rgba(${props.color}, 1)`};
  border-top-color: ${props => props.$isGhost ? 'transparent' : `rgba(${props.color}, 1)`};
  border-left-color: ${props => props.$isGhost ? 'transparent' : `rgba(${props.color}, 0.3)`};
`
