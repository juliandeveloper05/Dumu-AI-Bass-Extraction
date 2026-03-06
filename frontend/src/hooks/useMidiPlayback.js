// frontend/src/hooks/useMidiPlayback.js
/**
 * Tone.js MIDI playback hook.
 * Handles transport controls, note scheduling, and synth configuration.
 * Tone.start() is gated behind user gesture to comply with browser autoplay policy.
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import useAppStore from '../stores/appStore'
import { parseMidiBase64 } from '../utils/midiParser'

// Lazy-load Tone.js to reduce initial bundle size
let Tone = null
async function getTone() {
  if (!Tone) {
    Tone = await import('tone')
  }
  return Tone
}

// Bass synth preset
const BASS_SYNTH_OPTIONS = {
  oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
  envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.8 },
  filter: { type: 'lowpass', frequency: 800, rolloff: -24 },
  filterEnvelope: {
    attack: 0.06,
    decay: 0.2,
    sustain: 0.5,
    release: 2,
    baseFrequency: 200,
    octaves: 2.6,
  },
}

/**
 * @returns {{ play, pause, stop, setLoop, isPlaying, currentTime, duration, notes, isReady, initPlayback }}
 */
export function useMidiPlayback() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [notes, setNotes] = useState([])
  const [loop, setLoopState] = useState(false)

  const synthRef = useRef(null)
  const scheduledEventsRef = useRef([])
  const animFrameRef = useRef(null)
  const toneRef = useRef(null)
  const startedRef = useRef(false)

  // Store subscription for MIDI data changes
  const midiB64 = useAppStore((s) => s.midiB64)
  const bpm = useAppStore((s) => s.bpm)

  // Parse MIDI when it changes
  useEffect(() => {
    if (!midiB64) {
      setNotes([])
      setDuration(0)
      return
    }
    try {
      const parsed = parseMidiBase64(midiB64)
      setNotes(parsed.notes)
      setDuration(parsed.duration)
    } catch (err) {
      console.error('[useMidiPlayback] MIDI parse error:', err)
    }
  }, [midiB64])

  /**
   * Initialize Tone.js — MUST be called from a click handler (autoplay policy).
   */
  const initPlayback = useCallback(async () => {
    if (startedRef.current) return

    const T = await getTone()
    toneRef.current = T

    await T.start()
    startedRef.current = true

    // Create bass synth
    synthRef.current = new T.MonoSynth(BASS_SYNTH_OPTIONS).toDestination()

    setIsReady(true)
    console.log('[useMidiPlayback] Tone.js initialized')
  }, [])

  /**
   * Schedule all MIDI notes on the Tone.js transport.
   */
  function _scheduleNotes(T) {
    // Clear previous events
    _clearScheduled(T)

    if (!synthRef.current || notes.length === 0) return

    const transport = T.getTransport()

    // Set BPM if available
    if (bpm) {
      transport.bpm.value = bpm
    }

    notes.forEach((note) => {
      const eventId = transport.schedule((time) => {
        if (synthRef.current) {
          synthRef.current.triggerAttackRelease(
            note.name,
            note.duration,
            time,
            note.velocity
          )
        }
      }, note.time)
      scheduledEventsRef.current.push(eventId)
    })

    // Schedule transport stop at end of MIDI
    const stopId = transport.schedule(() => {
      if (!loop) {
        _stopPlayback(T)
      }
    }, duration + 0.1)
    scheduledEventsRef.current.push(stopId)
  }

  function _clearScheduled(T) {
    const transport = T.getTransport()
    scheduledEventsRef.current.forEach((id) => {
      try { transport.clear(id) } catch {}
    })
    scheduledEventsRef.current = []
  }

  function _startPositionTracking(T) {
    function tick() {
      const transport = T.getTransport()
      const pos = transport.seconds
      setCurrentTime(pos)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
  }

  function _stopPositionTracking() {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }

  function _stopPlayback(T) {
    const transport = T.getTransport()
    transport.stop()
    setIsPlaying(false)
    _stopPositionTracking()
    setCurrentTime(0)
    useAppStore.getState().setMidiPlaybackActive(false)
  }

  const play = useCallback(async () => {
    if (!startedRef.current) {
      await initPlayback()
    }
    const T = toneRef.current
    if (!T || notes.length === 0) return

    const transport = T.getTransport()

    _scheduleNotes(T)

    if (loop) {
      transport.loop = true
      transport.loopStart = 0
      transport.loopEnd = duration
    } else {
      transport.loop = false
    }

    transport.start()
    setIsPlaying(true)
    _startPositionTracking(T)
    useAppStore.getState().setMidiPlaybackActive(true)
  }, [notes, duration, loop, bpm, initPlayback])

  const pause = useCallback(() => {
    const T = toneRef.current
    if (!T) return
    const transport = T.getTransport()
    transport.pause()
    setIsPlaying(false)
    _stopPositionTracking()
  }, [])

  const stop = useCallback(() => {
    const T = toneRef.current
    if (!T) return
    _clearScheduled(T)
    _stopPlayback(T)
  }, [])

  const setLoop = useCallback((enabled) => {
    setLoopState(enabled)
    const T = toneRef.current
    if (T) {
      const transport = T.getTransport()
      transport.loop = enabled
      if (enabled) {
        transport.loopStart = 0
        transport.loopEnd = duration
      }
    }
  }, [duration])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      _stopPositionTracking()
      const T = toneRef.current
      if (T) {
        _clearScheduled(T)
        try { T.getTransport().stop() } catch {}
      }
      if (synthRef.current) {
        try { synthRef.current.dispose() } catch {}
      }
    }
  }, [])

  return {
    play,
    pause,
    stop,
    setLoop,
    isPlaying,
    isReady,
    currentTime,
    duration,
    notes,
    loop,
    initPlayback,
  }
}
