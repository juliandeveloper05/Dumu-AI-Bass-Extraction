// frontend/src/components/StemSelector.jsx
/**
 * Multi-stem toggle UI with icons for bass, drums, vocals, other.
 * Bass is always selected and locked.
 */
import React from 'react'
import { Guitar, Drum, Mic, Music, Download } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import useAppStore from '../stores/appStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { downloadBase64 } from '../utils/audioUtils'
import { STEM_CONFIG } from '../utils/constants'

const STEM_ICONS = { Guitar, Drum, Mic, Music }

export default React.memo(function StemSelector() {
  const showSelector = useAppStore((s) => s.showStemSelector)
  const selectedStems = useAppStore((s) => s.selectedStems)
  const stems = useAppStore((s) => s.stems)
  const stage = useAppStore((s) => s.stage)
  const audioFile = useAppStore((s) => s.audioFile)
  const filename = useAppStore((s) => s.filename)
  const { toggleStem, toggleStemSelector, setMultiStemMode } = useAppStore.getState()

  const { sendAudio } = useWebSocket()
  const isProcessing = stage === 'processing' || stage === 'uploading'

  const handleExtract = () => {
    if (!audioFile) return
    setMultiStemMode(true)
    sendAudio(audioFile, true)
  }

  const handleDownloadStem = (stemName, audio_b64) => {
    const baseName = filename?.replace(/\.[^.]+$/, '') || 'track'
    downloadBase64(audio_b64, `${baseName}_${stemName}.wav`, 'audio/wav')
  }

  return (
    <>
      <button
        onClick={toggleStemSelector}
        className={`glass-panel p-2.5 rounded-xl transition-all ${showSelector ? 'border-[var(--accent-magenta)]' : ''}`}
        aria-label="Toggle stem selector"
      >
        <Music className={`w-5 h-5 ${showSelector ? 'text-[var(--accent-magenta)]' : 'text-[var(--text-muted)]'}`} />
      </button>

      <AnimatePresence>
        {showSelector && (
          <motion.div
            className="glass-panel p-5 w-72"
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
          >
            <h3 className="text-sm font-medium text-[var(--text-primary)] font-heading mb-4">
              Multi-Stem Export
            </h3>

            {/* Stem toggles */}
            <div className="space-y-2 mb-4">
              {Object.entries(STEM_CONFIG).map(([key, config]) => {
                const Icon = STEM_ICONS[config.icon] || Music
                const isSelected = selectedStems.includes(key)
                const stemData = stems?.[key]
                const isExtracting = isProcessing && isSelected

                return (
                  <div key={key} className="flex items-center gap-3">
                    <button
                      onClick={() => !config.locked && toggleStem(key)}
                      disabled={config.locked}
                      className={`
                        flex items-center gap-2 flex-1 px-3 py-2 rounded-lg text-sm
                        transition-all border
                        ${isSelected
                          ? 'bg-[rgba(0,240,255,0.08)] border-[rgba(0,240,255,0.2)] text-[var(--text-primary)]'
                          : 'bg-transparent border-[var(--glass-border)] text-[var(--text-muted)]'
                        }
                        ${config.locked ? 'cursor-default' : 'cursor-pointer hover:border-[rgba(0,240,255,0.3)]'}
                        ${isExtracting ? 'stem-pulse' : ''}
                      `}
                      aria-label={`Toggle ${config.label} stem`}
                    >
                      <Icon className="w-4 h-4" style={{ color: isSelected ? config.color : undefined }} />
                      <span>{config.label}</span>
                      {config.locked && (
                        <span className="text-[10px] text-[var(--text-muted)] ml-auto">always on</span>
                      )}
                    </button>

                    {/* Download button for extracted stems */}
                    {stemData?.audio_b64 && (
                      <button
                        onClick={() => handleDownloadStem(key, stemData.audio_b64)}
                        className="p-2 rounded-lg bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(0,240,255,0.1)]
                          text-[var(--text-muted)] hover:text-[var(--accent-cyan)] transition-all"
                        aria-label={`Download ${config.label} stem`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Extract button */}
            <button
              onClick={handleExtract}
              disabled={isProcessing || !audioFile}
              className="w-full py-2.5 rounded-lg text-sm font-medium
                bg-[rgba(255,0,229,0.15)] text-[var(--accent-magenta)]
                hover:bg-[rgba(255,0,229,0.25)]
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all border border-[rgba(255,0,229,0.2)]"
              aria-label="Extract selected stems"
            >
              {isProcessing ? 'Extracting...' : 'Extract Stems'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
})
