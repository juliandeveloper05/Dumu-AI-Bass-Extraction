// frontend/src/components/MidiPlayer.jsx
/**
 * MIDI player component combining Tone.js playback with piano roll visualization.
 * Wraps useMidiPlayback hook and PianoRollRenderer canvas.
 */
import React, { useRef, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import useAppStore from '../stores/appStore'
import { useMidiPlayback } from '../hooks/useMidiPlayback'
import { renderPianoRoll } from '../canvas/PianoRollRenderer'
import { setupHiDPI } from '../canvas/WaveformRenderer'

export default React.memo(function MidiPlayer() {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const animFrameRef = useRef(null)

  const midiB64 = useAppStore((s) => s.midiB64)
  const bpm = useAppStore((s) => s.bpm)

  const { currentTime, duration, notes, isPlaying } = useMidiPlayback()

  // Setup canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setupHiDPI(canvas, width, height)
        }
      }
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  // Render piano roll
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || notes.length === 0) return

    // Auto-detect pitch range from notes
    let pitchMin = 127, pitchMax = 0
    for (const note of notes) {
      if (note.midi < pitchMin) pitchMin = note.midi
      if (note.midi > pitchMax) pitchMax = note.midi
    }
    // Add padding
    pitchMin = Math.max(0, pitchMin - 3)
    pitchMax = Math.min(127, pitchMax + 3)

    const dpr = window.devicePixelRatio || 1

    renderPianoRoll(canvas, notes, {
      currentTime,
      duration,
      pitchMin,
      pitchMax,
      zoom: 1,
      followPlayhead: isPlaying,
      devicePixelRatio: dpr,
    })
  }, [notes, currentTime, duration, isPlaying])

  // Animation loop for playback
  useEffect(() => {
    if (isPlaying) {
      function loop() {
        renderFrame()
        animFrameRef.current = requestAnimationFrame(loop)
      }
      animFrameRef.current = requestAnimationFrame(loop)
    } else {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
      renderFrame() // Render static frame
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [isPlaying, renderFrame])

  if (!midiB64 || notes.length === 0) return null

  return (
    <motion.div
      className="glass-panel p-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-primary)] font-heading">
          Piano Roll
        </h3>
        {bpm && (
          <span className="font-mono text-sm text-[var(--accent-lime)]
            shadow-[0_0_8px_rgba(170,255,0,0.3)]">
            {bpm} BPM
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="w-full h-48 rounded-lg overflow-hidden bg-[rgba(0,0,0,0.3)]"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          aria-label="MIDI piano roll visualization"
        />
      </div>
    </motion.div>
  )
})
