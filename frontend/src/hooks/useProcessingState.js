// frontend/src/hooks/useProcessingState.js
/**
 * Derived processing state hook — reads from Zustand store and
 * exposes computed UI state for component rendering decisions.
 */
import useAppStore from '../stores/appStore'

/**
 * @returns {{ isIdle, isUploading, isProcessing, isComplete, isError, canUpload, canPlay, canDownload, hasResult, stage, substage, progress, error }}
 */
export function useProcessingState() {
  const stage = useAppStore((s) => s.stage)
  const substage = useAppStore((s) => s.substage)
  const progress = useAppStore((s) => s.progress)
  const error = useAppStore((s) => s.error)
  const midiB64 = useAppStore((s) => s.midiB64)
  const bpm = useAppStore((s) => s.bpm)
  const stems = useAppStore((s) => s.stems)

  return {
    // Stage booleans
    isIdle: stage === 'idle',
    isUploading: stage === 'uploading',
    isProcessing: stage === 'processing',
    isComplete: stage === 'complete',
    isError: stage === 'error',

    // Computed permissions
    canUpload: stage === 'idle' || stage === 'complete' || stage === 'error',
    canPlay: stage === 'complete' && !!midiB64,
    canDownload: stage === 'complete' && !!midiB64,
    hasResult: stage === 'complete' && (!!midiB64 || !!stems),

    // Raw values
    stage,
    substage,
    progress,
    error,
    bpm,
  }
}
