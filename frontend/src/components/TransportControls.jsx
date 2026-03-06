// frontend/src/components/TransportControls.jsx
/**
 * Playback transport controls for MIDI preview.
 * Play, Pause, Stop, Loop toggle, BPM display.
 * First click initializes Tone.js (browser autoplay policy).
 */
import React from 'react'
import { Play, Pause, Square, Repeat, Music2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useMidiPlayback } from '../hooks/useMidiPlayback'
import { formatTime } from '../utils/audioUtils'

export default React.memo(function TransportControls() {
  const {
    play, pause, stop, setLoop,
    isPlaying, isReady, currentTime, duration, notes, loop, initPlayback,
  } = useMidiPlayback()

  const hasNotes = notes.length > 0

  if (!hasNotes) return null

  const handlePlayPause = async () => {
    if (!isReady) {
      await initPlayback()
    }
    if (isPlaying) {
      pause()
    } else {
      play()
    }
  }

  return (
    <motion.div
      className="glass-panel p-3 flex items-center gap-3"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Play/Pause */}
      <button
        onClick={handlePlayPause}
        className="w-10 h-10 rounded-xl flex items-center justify-center
          bg-[rgba(0,240,255,0.15)] hover:bg-[rgba(0,240,255,0.25)]
          text-[var(--accent-cyan)] transition-all
          shadow-[0_0_12px_rgba(0,240,255,0.1)]
          hover:shadow-[0_0_20px_rgba(0,240,255,0.2)]"
        aria-label={isPlaying ? 'Pause MIDI playback' : 'Play MIDI preview'}
      >
        {isPlaying ? (
          <Pause className="w-5 h-5" />
        ) : (
          <Play className="w-5 h-5 ml-0.5" />
        )}
      </button>

      {/* Stop */}
      <button
        onClick={stop}
        className="w-8 h-8 rounded-lg flex items-center justify-center
          text-[var(--text-muted)] hover:text-[var(--text-primary)]
          hover:bg-[rgba(255,255,255,0.05)] transition-all"
        aria-label="Stop playback"
      >
        <Square className="w-4 h-4" />
      </button>

      {/* Loop */}
      <button
        onClick={() => setLoop(!loop)}
        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all
          ${loop
            ? 'text-[var(--accent-cyan)] bg-[rgba(0,240,255,0.1)]'
            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.05)]'
          }`}
        aria-label={loop ? 'Disable loop' : 'Enable loop'}
      >
        <Repeat className="w-4 h-4" />
      </button>

      {/* Separator */}
      <div className="w-px h-6 bg-[var(--glass-border)]" />

      {/* Time display */}
      <div className="flex items-center gap-1.5 font-mono text-xs">
        <span className="text-[var(--accent-cyan)]">{formatTime(currentTime)}</span>
        <span className="text-[var(--text-muted)]">/</span>
        <span className="text-[var(--text-muted)]">{formatTime(duration)}</span>
      </div>

      {/* Note count */}
      <div className="flex items-center gap-1 ml-auto">
        <Music2 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
        <span className="text-xs font-mono text-[var(--text-muted)]">{notes.length} notes</span>
      </div>
    </motion.div>
  )
})
