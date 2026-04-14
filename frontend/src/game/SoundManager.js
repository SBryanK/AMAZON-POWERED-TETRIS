// Sound Manager — lightweight audio engine using Web Audio API.
// All sounds are synthesized procedurally (no external files needed).

class SoundManager {
  constructor() {
    this.ctx = null
    this.enabled = true
    this.volume = 0.3
    this.musicOsc = null
    this.musicGain = null
    this.musicPlaying = false
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume()
    }
  }

  _playTone(freq, duration, type = 'square', vol = null) {
    if (!this.enabled) return
    this._ensureContext()
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
    gain.gain.setValueAtTime((vol ?? this.volume) * 0.5, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(this.ctx.destination)
    osc.start()
    osc.stop(this.ctx.currentTime + duration)
  }

  _playNotes(notes, type = 'square') {
    if (!this.enabled) return
    this._ensureContext()
    let t = this.ctx.currentTime
    notes.forEach(([freq, dur]) => {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(this.volume * 0.4, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(gain)
      gain.connect(this.ctx.destination)
      osc.start(t)
      osc.stop(t + dur)
      t += dur
    })
  }

  move() {
    this._playTone(200, 0.05, 'square', 0.1)
  }

  rotate() {
    this._playTone(400, 0.08, 'square', 0.15)
  }

  softDrop() {
    this._playTone(150, 0.04, 'triangle', 0.1)
  }

  hardDrop() {
    this._playNotes([
      [300, 0.04],
      [150, 0.06],
      [80, 0.1],
    ], 'sawtooth')
  }

  lineClear(count) {
    if (count >= 4) {
      // Tetris! — triumphant fanfare
      this._playNotes([
        [523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2],
      ], 'square')
    } else if (count >= 2) {
      this._playNotes([
        [440, 0.08], [554, 0.08], [659, 0.15],
      ], 'square')
    } else {
      this._playNotes([
        [330, 0.08], [440, 0.12],
      ], 'square')
    }
  }

  hold() {
    this._playNotes([
      [350, 0.06], [500, 0.06],
    ], 'triangle')
  }

  levelUp() {
    this._playNotes([
      [440, 0.1], [554, 0.1], [659, 0.1], [880, 0.2],
    ], 'square')
  }

  gameOver() {
    this._playNotes([
      [440, 0.2], [415, 0.2], [392, 0.2], [370, 0.4],
    ], 'sawtooth')
  }

  // Simple Korobeiniki-inspired loop using Web Audio
  startMusic() {
    if (!this.enabled || this.musicPlaying) return
    this._ensureContext()
    this.musicPlaying = true

    // Korobeiniki melody (simplified, first phrase)
    const melody = [
      [659, 0.4], [494, 0.2], [523, 0.2], [587, 0.4],
      [523, 0.2], [494, 0.2], [440, 0.4], [440, 0.2],
      [523, 0.2], [659, 0.4], [587, 0.2], [523, 0.2],
      [494, 0.6], [523, 0.2], [587, 0.4], [659, 0.4],
      [523, 0.4], [440, 0.4], [440, 0.4], [0, 0.2],
      [587, 0.4], [587, 0.2], [698, 0.2], [880, 0.4],
      [784, 0.2], [698, 0.2], [659, 0.6], [523, 0.2],
      [659, 0.4], [587, 0.2], [523, 0.2], [494, 0.4],
      [494, 0.2], [523, 0.2], [587, 0.4], [659, 0.4],
      [523, 0.4], [440, 0.4], [440, 0.4], [0, 0.4],
    ]

    const totalDuration = melody.reduce((sum, [, d]) => sum + d, 0)

    const playLoop = () => {
      if (!this.musicPlaying || !this.enabled) return
      let t = this.ctx.currentTime
      melody.forEach(([freq, dur]) => {
        if (freq === 0) { t += dur; return }
        const osc = this.ctx.createOscillator()
        const gain = this.ctx.createGain()
        osc.type = 'square'
        osc.frequency.setValueAtTime(freq, t)
        gain.gain.setValueAtTime(this.volume * 0.15, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9)
        osc.connect(gain)
        gain.connect(this.ctx.destination)
        osc.start(t)
        osc.stop(t + dur)
        t += dur
      })
      this._musicTimer = setTimeout(playLoop, totalDuration * 1000)
    }
    playLoop()
  }

  stopMusic() {
    this.musicPlaying = false
    if (this._musicTimer) {
      clearTimeout(this._musicTimer)
      this._musicTimer = null
    }
  }

  toggle() {
    this.enabled = !this.enabled
    if (!this.enabled) {
      this.stopMusic()
    }
    return this.enabled
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
  }
}

// Singleton
const soundManager = new SoundManager()
export default soundManager
