import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import InstructionModal from '../components/InstructionModal'
import './HomePage.css'

const HomePage=()=>{
  const [playerName, setPlayerName] = useState('')
  const [scores, setScores] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [hasLoadedScores, setHasLoadedScores] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()
  const inputRef = useRef(null)

  useEffect(()=>{
    fetchScores()
    if(inputRef.current){
      inputRef.current.focus()
    }
  },[])

  const fetchScores=async()=>{
    try{
      const res = await axios.get('http://localhost:8000/scoreboard')
      if(res.data.topScores){
        setScores(res.data.topScores)
      }
      setHasLoadedScores(true)
    }catch(err){
      console.error('Error fetch scoreboard:', err)
      setHasLoadedScores(true)
    }
  }

  const startGame=()=>{
    // disallow "anonymous"
    const nm = playerName.trim()
    if(!nm || nm.toLowerCase()===''){
      setErrorMsg('Name cannot be empty or "anonymous"!')
      return
    }
    localStorage.setItem('playerName', nm)
    navigate('/game')
  }

  const handleKeyDown=(e)=>{
    if(e.key==='Enter'){
      startGame()
    }
  }

  return(
    <div className="home-container">
      <div className="header-title">
        <h1 className="main-title">THIS IS APT!</h1>
        <h2 className="subtitle">AMAZON POWERED TETRIS</h2>
      </div>

      <div className="form-box">
        <h3 className="enter-name-title">Enter Your Name</h3>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type your name..."
          value={playerName}
          onChange={(e)=>setPlayerName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {errorMsg && <div className="error-msg">{errorMsg}</div>}

        <button onClick={startGame}>Start Game</button>

        <div className="scoreboard-box">
          {(!scores.length && hasLoadedScores) ? (
            <div className="no-score">No scores yet!</div>
          ) : (
            <table className="score-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((item, i)=>(
                  <tr key={i}>
                    <td>{i+1}</td>
                    <td>{item.name}</td>
                    <td>{item.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="help-icon" onClick={()=>setShowModal(true)}>?</div>
      {showModal && <InstructionModal onClose={()=>setShowModal(false)}/>}
    </div>
  )
}

export default HomePage
