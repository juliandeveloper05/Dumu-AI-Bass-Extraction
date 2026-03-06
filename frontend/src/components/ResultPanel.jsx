// frontend/src/components/ResultPanel.jsx
/**
 * Result card showing BPM, filename, and download actions.
 * Glassmorphism panel with glow effects.
 */
import React from 'react'
import { Download, RotateCcw, Music, FileAudio } from 'lucide-react'
import { motion } from 'framer-motion'
import useAppStore from '../stores/appStore'
import { downloadBase64 } from '../utils/audioUtils'

export default React.memo(function ResultPanel() {
  const stage = useAppStore((s) => s.stage)
  const bpm = useAppStore((s) => s.bpm)
  const midiB64 = useAppStore((s) => s.midiB64)
  const bassAudioB64 = useAppStore((s) => s.bassAudioB64)
  const filename = useAppStore((s) => s.filename)
  const reset = useAppStore((s) => s.reset)

  if (stage !== 'complete') return null

  const baseName = filename?.replace(/\.[^.]+$/, '') || 'bass'

  const handleDownloadMidi = () => {
    if (midiB64) {
      downloadBase64(midiB64, `${baseName}_extracted.mid`, 'audio/midi')
    }
  }

  const handleDownloadBass = () => {
    if (bassAudioB64) {
      downloadBase64(bassAudioB64, `${baseName}_bass.wav`, 'audio/wav')
    }
  }

  return (
    <motion.div
      className="glass-panel p-5"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, type: 'spring' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[rgba(170,255,0,0.1)] flex items-center justify-center">
          <Music className="w-5 h-5 text-[var(--accent-lime)]" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-[var(--text-primary)] font-heading">
            Extraction Complete
          </h3>
          <p className="text-xs text-[var(--text-muted)]">{filename}</p>
        </div>
        {bpm && (
          <div className="ml-auto text-right">
            <span className="text-2xl font-bold font-mono text-[var(--accent-lime)]
              drop-shadow-[0_0_8px_rgba(170,255,0,0.4)]">
              {bpm}
            </span>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">BPM</p>
          </div>
        )}
      </div>

      {/* Download buttons */}
      <div className="flex gap-2">
        {midiB64 && (
          <button
            onClick={handleDownloadMidi}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
              bg-[rgba(0,240,255,0.12)] text-[var(--accent-cyan)] font-medium text-sm
              hover:bg-[rgba(0,240,255,0.2)]
              border border-[rgba(0,240,255,0.15)]
              transition-all shadow-[0_0_12px_rgba(0,240,255,0.05)]
              hover:shadow-[0_0_20px_rgba(0,240,255,0.15)]"
            aria-label="Download MIDI file"
          >
            <Download className="w-4 h-4" />
            Download MIDI
          </button>
        )}

        {bassAudioB64 && (
          <button
            onClick={handleDownloadBass}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl
              bg-[rgba(255,0,229,0.08)] text-[var(--accent-magenta)] font-medium text-sm
              hover:bg-[rgba(255,0,229,0.15)]
              border border-[rgba(255,0,229,0.15)]
              transition-all"
            aria-label="Download bass audio"
          >
            <FileAudio className="w-4 h-4" />
            Download Bass
          </button>
        )}
      </div>

      {/* Reset */}
      <button
        onClick={reset}
        className="w-full mt-3 flex items-center justify-center gap-2 py-2 rounded-xl
          text-[var(--text-muted)] text-sm
          hover:text-[var(--text-primary)] hover:bg-[rgba(255,255,255,0.03)]
          transition-all"
        aria-label="Process another file"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        Process another
      </button>
    </motion.div>
  )
})
