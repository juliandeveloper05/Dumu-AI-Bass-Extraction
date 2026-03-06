// frontend/src/components/UploadZone.jsx
/**
 * Drag-and-drop upload zone with pulsing cyan border glow.
 * Validates file extension and size before triggering WebSocket upload.
 */
import React, { useState, useCallback, useRef } from 'react'
import { Upload, Music, X, AlertCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import useAppStore from '../stores/appStore'
import { useWebSocket } from '../hooks/useWebSocket'
import { useAudioContext } from '../hooks/useAudioContext'
import { validateFile } from '../utils/audioUtils'
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB } from '../utils/constants'

export default React.memo(function UploadZone() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [ripple, setRipple] = useState(false)
  const inputRef = useRef(null)

  const stage = useAppStore((s) => s.stage)
  const audioFile = useAppStore((s) => s.audioFile)
  const multiStemMode = useAppStore((s) => s.multiStemMode)
  const { setAudioFile, setAudioBuffer, setWaveformPeaks } = useAppStore.getState()

  const { sendAudio } = useWebSocket()
  const { decodeFile, extractPeaks } = useAudioContext()

  const canUpload = stage === 'idle' || stage === 'complete' || stage === 'error'

  const handleFile = useCallback(async (file) => {
    setError(null)

    // Validate
    const validation = validateFile(file, ALLOWED_EXTENSIONS, MAX_FILE_SIZE_MB)
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    // Store file reference
    setAudioFile(file)

    // Decode for instant waveform preview
    const buffer = await decodeFile(file)
    if (buffer) {
      setAudioBuffer(buffer)
      const peaks = extractPeaks(buffer, 2000)
      setWaveformPeaks({ peaks, duration: buffer.duration, sample_rate: buffer.sampleRate })
    }

    // Trigger ripple animation
    setRipple(true)
    setTimeout(() => setRipple(false), 600)

    // Send via WebSocket
    sendAudio(file, multiStemMode)
  }, [sendAudio, decodeFile, extractPeaks, multiStemMode])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => setIsDragOver(false), [])

  const onFileSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // Reset input
  }, [handleFile])

  const isDisabled = !canUpload

  return (
    <motion.div
      className="glass-panel relative overflow-hidden"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div
        className={`
          relative p-8 border-2 border-dashed rounded-2xl
          transition-all duration-300 cursor-pointer
          ${isDragOver
            ? 'border-[var(--accent-cyan)] bg-[rgba(0,240,255,0.05)]'
            : 'border-[var(--glass-border)] hover:border-[rgba(0,240,255,0.3)]'
          }
          ${isDisabled ? 'opacity-50 pointer-events-none' : ''}
          ${canUpload ? 'upload-pulse' : ''}
        `}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => !isDisabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload audio file for bass extraction"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={onFileSelect}
          className="hidden"
          aria-hidden="true"
        />

        {/* Ripple effect on drop */}
        <AnimatePresence>
          {ripple && (
            <motion.div
              className="absolute inset-0 rounded-2xl"
              initial={{ scale: 0, opacity: 0.5 }}
              animate={{ scale: 2, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              style={{
                background: 'radial-gradient(circle, rgba(0,240,255,0.2) 0%, transparent 70%)',
              }}
            />
          )}
        </AnimatePresence>

        <div className="flex flex-col items-center gap-4 text-center relative z-10">
          <motion.div
            animate={isDragOver ? { scale: 1.1, rotate: 5 } : { scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            {audioFile ? (
              <Music className="w-12 h-12 text-[var(--accent-cyan)]" />
            ) : (
              <Upload className="w-12 h-12 text-[var(--text-muted)]" />
            )}
          </motion.div>

          {audioFile ? (
            <div>
              <p className="text-[var(--text-primary)] font-medium">{audioFile.name}</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                {(audioFile.size / (1024 * 1024)).toFixed(1)}MB
              </p>
            </div>
          ) : (
            <div>
              <p className="text-[var(--text-primary)] font-medium">
                Drop audio file here or click to browse
              </p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                MP3, WAV, FLAC, OGG — up to {MAX_FILE_SIZE_MB}MB
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-center gap-2 mt-3 px-4 py-2 rounded-lg bg-[rgba(255,51,102,0.1)] text-[var(--accent-magenta)]"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="text-sm">{error}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setError(null) }}
              className="ml-auto"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})
