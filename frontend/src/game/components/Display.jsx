import React from 'react'
import styled from 'styled-components'

const StyledDisplay = styled.div`
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 15px;
  border: 4px solid #333;
  min-height: 30px;
  width: 100%;
  border-radius: 20px;
  background: #000;
  color: #fff;
  font-family: 'FreakOfNature', sans-serif;
  font-size: ${props => (props.bigger ? '1.5rem' : '1rem')};
  font-weight: ${props => (props.bold ? 'bold' : 'normal')};
`

const Display = ({ text, bigger, bold }) => (
  <StyledDisplay bigger={bigger} bold={bold}>{text}</StyledDisplay>
)

export default Display
