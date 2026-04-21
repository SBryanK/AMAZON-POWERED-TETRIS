import React, { useRef, useEffect, useState } from 'react'
import './HandControlOverlay.css'

// Capture roughly 15 fps — fast enough to feel responsive, slow enough not
// to saturate the WebSocket or the Python-side detector.
const CAPTURE_INTERVAL_MS = 66

const HandControlOverlay = ({ ws, activeZone = null }) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraError, setCameraError] = useState(null)

  // Acquire camera once on mount and release it on unmount. Without explicit
  // cleanup the webcam LED stays on when navigating away.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      })
      .catch((err) => {
        console.error('Camera error:', err)
        setCameraError(err.name || 'CameraError')
      })

    return () => {
      cancelled = true
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  // Frame-capture loop. Runs only while the WebSocket is OPEN.
  useEffect(() => {
    if (!ws) return undefined
    // Lazy-create the offscreen canvas once. Using `document` lazily inside
    // the effect avoids SSR pitfalls and the React-StrictMode double-render
    // leak that `useRef(document.createElement('canvas'))` used to cause.
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas')
    }

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return
      const video = videoRef.current
      if (!video || !video.videoWidth || !video.videoHeight) return

      const canvas = canvasRef.current
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight

      const ctx = canvas.getContext('2d')
      // Reset any prior transform so we don't accumulate mirror flips across
      // ticks (calling translate+scale repeatedly on the same context would
      // gradually shift the image off-screen).
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
      try {
        ws.send(JSON.stringify({ frame: dataUrl }))
      } catch {
        /* WS might close mid-tick — ignore */
      }
    }, CAPTURE_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [ws])

  return (
    <div className="overlay-container">
      <video ref={videoRef} className="camera-video" muted playsInline />
      <div className={`overlay-button top-button ${activeZone === 'UP' ? 'active' : ''}`}>UP</div>
      <div className={`overlay-button left-button ${activeZone === 'LEFT' ? 'active' : ''}`}>LEFT</div>
      <div className={`overlay-button right-button ${activeZone === 'RIGHT' ? 'active' : ''}`}>RIGHT</div>
      <div className={`overlay-button bottom-button ${activeZone === 'DOWN' ? 'active' : ''}`}>DOWN</div>
      {cameraError && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '4px 8px',
            background: 'rgba(180, 30, 30, 0.8)',
            color: '#fff',
            fontSize: 12,
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        >
          Camera unavailable: {cameraError}
        </div>
      )}
    </div>
  )
}

export default HandControlOverlay
