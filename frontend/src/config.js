// Frontend configuration — all environment-dependent values in one place.
// In production, set VITE_API_URL and VITE_WS_URL via environment variables.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_URL  = import.meta.env.VITE_WS_URL  || 'ws://localhost:8000'

export const config = {
  apiUrl: API_URL,
  wsUrl: WS_URL,
  scoreboardEndpoint: `${API_URL}/scoreboard`,
  websocketEndpoint: `${WS_URL}/ws`,
}

export default config
