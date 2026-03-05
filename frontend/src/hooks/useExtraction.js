import { useState, useCallback, useRef, useEffect } from 'react'
import { startJob, getResult } from '../api/bassApi'
import { useProgressStream } from './useProgressStream'

/** FSM status constants — exported so App.jsx can reference them */
export const Status = Object.freeze({
  IDLE:       'idle',
  PROCESSING: 'processing',
  DONE:       'done',
  ERROR:      'error',
})

/**
 * Custom hook that owns all extraction-related async state.
 * Now uses real SSE progress events from the backend instead of timers.
 *
 * Returns { status, logs, result, error, progress, startExtraction, downloadResult, reset }
 */
export function useExtraction() {
  const [status, setStatus]     = useState(Status.IDLE)
  const [result, setResult]     = useState(null)
  const [error,  setError]      = useState(null)
  const [jobId,  setJobId]      = useState(null)

  // SSE stream — activates when jobId is set
  const {
    logs: streamLogs,
    progress: streamProgress,
    done: streamDone,
    error: streamError,
  } = useProgressStream(jobId)

  // Merge stream logs with any local logs (e.g. initial "Uploading..." message)
  const [localLogs, setLocalLogs] = useState([])
  const logs     = [...localLogs, ...streamLogs]
  const progress = jobId ? streamProgress : 0

  // When SSE stream reports done, fetch the final result
  const fetchingResult = useRef(false)
  useEffect(() => {
    if (!streamDone || !jobId || fetchingResult.current) return

    fetchingResult.current = true
    getResult(jobId)
      .then((data) => {
        setResult(data)
        setStatus(Status.DONE)
      })
      .catch((err) => {
        const msg = err.message || 'Failed to fetch result'
        setError(msg)
        setStatus(Status.ERROR)
        setLocalLogs((prev) => [...prev, `❌ ${msg}`])
      })
      .finally(() => {
        fetchingResult.current = false
      })
  }, [streamDone, jobId])

  // If SSE stream reports an error, propagate it
  useEffect(() => {
    if (streamError && status === Status.PROCESSING) {
      setError(streamError)
      setStatus(Status.ERROR)
    }
  }, [streamError, status])

  const startExtraction = useCallback(async (file, quantization = '1/16') => {
    // Reset state
    setStatus(Status.PROCESSING)
    setError(null)
    setResult(null)
    setJobId(null)
    setLocalLogs(['🎵 Uploading audio file...'])
    fetchingResult.current = false

    try {
      const { job_id } = await startJob(file, { quantization })
      setJobId(job_id) // This triggers the SSE connection via useProgressStream
    } catch (err) {
      const msg = err.message?.includes('Failed to fetch')
        ? 'Cannot reach the backend. Is the server running?'
        : err.message || 'Unknown error'
      setError(msg)
      setStatus(Status.ERROR)
      setLocalLogs((prev) => [...prev, `❌ Error: ${msg}`])
    }
  }, [])

  const downloadResult = useCallback(() => {
    if (!result?.midi_b64) return
    const binary = atob(result.midi_b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'audio/midi' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${result.filename?.replace(/\.[^.]+$/, '') || 'bass'}_extracted.mid`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }, [result])

  const reset = useCallback(() => {
    setStatus(Status.IDLE)
    setLocalLogs([])
    setResult(null)
    setError(null)
    setJobId(null)
    fetchingResult.current = false
  }, [])

  return { status, logs, result, error, progress, startExtraction, downloadResult, reset }
}