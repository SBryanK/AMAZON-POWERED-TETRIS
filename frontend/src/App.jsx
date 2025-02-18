import React from 'react'
import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import GamePage from './pages/GamePage'

const App = () => (
  <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/game" element={<GamePage />} />
  </Routes>
)

export default App
