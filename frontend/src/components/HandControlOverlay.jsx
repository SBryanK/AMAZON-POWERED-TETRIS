import React, { useRef, useEffect } from 'react'
import './HandControlOverlay.css'

const HandControlOverlay = ({ ws }) => {
  const videoRef = useRef(null)
  const canvasRef = useRef(document.createElement('canvas'))

  useEffect(()=>{
    navigator.mediaDevices.getUserMedia({ video:true })
      .then(stream=>{
        if(videoRef.current){
          videoRef.current.srcObject=stream
          videoRef.current.play()
        }
      }).catch(err=>console.error('Camera error:',err))
  },[])

  useEffect(()=>{
    if(!ws) return
    const interval=setInterval(()=>{
      if(ws.readyState!==WebSocket.OPEN) return
      const video=videoRef.current
      if(!video||!video.videoWidth||!video.videoHeight) return

      const canvas=canvasRef.current
      canvas.width=video.videoWidth
      canvas.height=video.videoHeight
      const ctx=canvas.getContext('2d')
      // flip horizontally
      ctx.translate(canvas.width,0)
      ctx.scale(-1,1)
      ctx.drawImage(video,0,0,canvas.width,canvas.height)
      const dataUrl=canvas.toDataURL('image/jpeg',0.5)
      ws.send(JSON.stringify({frame:dataUrl}))
    },80) // capture every 60ms => ~16.6fps

    return ()=>clearInterval(interval)
  },[ws])

  return(
    <div className="overlay-container">
      <video ref={videoRef} className="camera-video" muted/>
      {/* big green boxes */}
      <div className="overlay-button top-button">UP</div>
      <div className="overlay-button left-button">LEFT</div>
      <div className="overlay-button right-button">RIGHT</div>
      <div className="overlay-button bottom-button">DOWN</div>
    </div>
  )
}

export default HandControlOverlay
