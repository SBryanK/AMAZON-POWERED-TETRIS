// Sound Manager — lightweight audio engine using Web Audio API.
// All sounds are synthesized procedurally (no external files needed).
//
// Design notes for the mute/unmute fix:
//   1. Every single oscillator in the app is routed through ONE shared
//      master-gain node. To mute, we ramp the master gain to 0; to unmute,
//      we ramp it back to 1. This makes the mute button take effect on
//      the next audio-frame (~10ms), not "after the currently scheduled
//      phrase finishes" (which could be >10s).
//   2. We track every oscillator currently scheduled for the music loop so
//      that a mute can actively cancel/stop them. Without this, the Web
//      Audio engine would happily keep playing notes whose start time has
//      already passed, because Web Audio schedules on its own clock that
//      ignores `this.enabled`.
//   3. `toggle()` now does the right thing in BOTH directions: if the user
//      mutes we stop all sources; if the user unmutes DURING an active
//      game we automatically restart the music loop from the top.

class SoundManager {
  constructor() {
    this.ctx = null
    this.masterGain = null
    this.enabled = true
    this.volume = 0.3
    // Set of oscillators currently alive (both SFX and music) so we can
    // hard-stop them on mute without waiting for their scheduled end time.
    this._activeSources = new Set()
    this._musicTimer = null
    // True only between `startMusic()` and `stopMusic()`. Independent of
    // `enabled` — we track "the game wants music" separately from "audio is
    // allowed to play right now" so toggling sound back on can resume.
    this.musicPlaying = false
    // Snapshot of whether music was running when the game was paused /
    // muted, so we can decide whether to resume it on un-pause / un-mute.
    this._wantsMusic = false
  }

  _ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return false
      this.ctx = new AC()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.enabled ? 1 : 0
      this.masterGain.connect(this.ctx.destination)
    }
    // Browsers suspend AudioContexts until a user gesture. Attempting to
    // resume is safe even if the context is already running.
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return true
  }

  // Internal helper: register a scheduled oscillator so we can cancel it
  // on mute. Auto-unregisters itself on the oscillator's onended event.
  _track(osc) {
    this._activeSources.add(osc)
    osc.onended = () => {
      this._activeSources.delete(osc)
    }
  }

  _stopAllSources() {
    // Iterate over a snapshot — stopping an oscillator synchronously fires
    // its onended handler which mutates the Set.
    const sources = Array.from(this._activeSources)
    this._activeSources.clear()
    for (const osc of sources) {
      try { osc.stop() } catch { /* already stopped / ended */ }
      try { osc.disconnect() } catch { /* already disconnected */ }
    }
  }

  _playTone(freq, duration, type = 'square', vol = null) {
    if (!this.enabled) return
    if (!this._ensureContext()) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime)
    gain.gain.setValueAtTime((vol ?? this.volume) * 0.5, this.ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(this.masterGain)
    osc.start()
    osc.stop(this.ctx.currentTime + duration)
    this._track(osc)
  }

  _playNotes(notes, type = 'square') {
    if (!this.enabled) return
    if (!this._ensureContext()) return
    let t = this.ctx.currentTime
    notes.forEach(([freq, dur]) => {
      if (freq === 0) { t += dur; return }
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, t)
      gain.gain.setValueAtTime(this.volume * 0.4, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.connect(gain)
      gain.connect(this.masterGain)
      osc.start(t)
      osc.stop(t + dur)
      this._track(osc)
      t += dur
    })
  }

  move()      { this._playTone(200, 0.05, 'square', 0.1) }
  rotate()    { this._playTone(400, 0.08, 'square', 0.15) }
  softDrop()  { this._playTone(150, 0.04, 'triangle', 0.1) }

  hardDrop() {
    this._playNotes([[300, 0.04], [150, 0.06], [80, 0.1]], 'sawtooth')
  }

  lineClear(count) {
    if (count >= 4) {
      this._playNotes([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]], 'square')
    } else if (count >= 2) {
      this._playNotes([[440, 0.08], [554, 0.08], [659, 0.15]], 'square')
    } else {
      this._playNotes([[330, 0.08], [440, 0.12]], 'square')
    }
  }

  hold()    { this._playNotes([[350, 0.06], [500, 0.06]], 'triangle') }
  levelUp() { this._playNotes([[440, 0.1], [554, 0.1], [659, 0.1], [880, 0.2]], 'square') }
  gameOver(){ this._playNotes([[440, 0.2], [415, 0.2], [392, 0.2], [370, 0.4]], 'sawtooth') }

  // Simplified Korobeiniki-inspired loop.
  startMusic() {
    this._wantsMusic = true
    if (this.musicPlaying) return
    if (!this.enabled) return        // user is muted — we'll auto-start on unmute
    if (!this._ensureContext()) return
    this.musicPlaying = true

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
      // Stop if mute was toggled or the game stopped the music.
      if (!this.musicPlaying || !this.enabled || !this.ctx) return
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
        gain.connect(this.masterGain)
        osc.start(t)
        osc.stop(t + dur)
        this._track(osc)
        t += dur
      })
      // Schedule the next pass. Using setTimeout on wall-clock time is good
      // enough here — the audio itself is scheduled on Web Audio's own
      // clock so small setTimeout jitter doesn't affect note timing.
      this._musicTimer = setTimeout(playLoop, totalDuration * 1000)
    }
    playLoop()
  }

  stopMusic() {
    this._wantsMusic = false
    this.musicPlaying = false
    if (this._musicTimer) {
      clearTimeout(this._musicTimer)
      this._musicTimer = null
    }
    // Kill any scheduled music notes immediately.
    this._stopAllSources()
  }

  // Toggle mute. Returns the new `enabled` state.
  // - Muting: ramp master gain to 0 instantly AND cancel any scheduled
  //   oscillators so a long phrase (e.g. the game-over fanfare) doesn't
  //   keep ringing after the button is pressed.
  // - Unmuting: ramp gain back up and, if a game is in progress, resume
  //   the background music loop.
  toggle() {
    this.enabled = !this.enabled
    if (!this._ensureContext()) return this.enabled
    const now = this.ctx.currentTime
    // Cancel any in-flight ramps, then ramp to the target value over 10ms
    // to avoid the audible click that a setValueAtTime-only change produces.
    this.masterGain.gain.cancelScheduledValues(now)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now)
    this.masterGain.gain.linearRampToValueAtTime(this.enabled ? 1 : 0, now + 0.01)

    if (!this.enabled) {
      // Stop everything immediately. `_wantsMusic` stays true so the next
      // toggle can restore music, but `musicPlaying` becomes false so the
      // loop won't schedule new notes.
      this.musicPlaying = false
      if (this._musicTimer) {
        clearTimeout(this._musicTimer)
        this._musicTimer = null
      }
      this._stopAllSources()
    } else if (this._wantsMusic && !this.musicPlaying) {
      // Unmuting during an active game — resume the loop.
      this.startMusic()
    }
    return this.enabled
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v))
  }

  isEnabled() {
    return this.enabled
  }
}

// Singleton
const soundManager = new SoundManager()
export default soundManager
