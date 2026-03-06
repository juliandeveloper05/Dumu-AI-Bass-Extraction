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
 *
 * Uses SSE progress events from the backend. If the SSE connection drops
 * before the job completes (e.g. 5-min proxy timeout on long files), the
 * hook automatically falls back to polling GET /api/result/{jobId} every 5s
 * until the result is available or a 15-minute hard timeout is reached.
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
    connectionLost,
  } = useProgressStream(jobId)

  // Merge stream logs with any local logs (e.g. initial "Uploading..." message)
  const [localLogs, setLocalLogs] = useState([])
  const logs     = [...localLogs, ...streamLogs]
  const progress = jobId ? streamProgress : 0

  // ── SSE happy path: stream reported done ─────────────────────────────────
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

  // ── SSE backend error (pct = -1) — propagate immediately ─────────────────
  useEffect(() => {
    if (streamError && status === Status.PROCESSING) {
      setError(streamError)
      setStatus(Status.ERROR)
    }
  }, [streamError, status])

  // ── Polling fallback when SSE transport drops ─────────────────────────────
  // If the SSE connection cuts out (proxy timeout, network hiccup) but the
  // backend job is still running, poll GET /api/result/{jobId} every 5s.
  // Backend returns 404 while processing and 200 when done.
  const pollActive = useRef(false)
  const pollTimer  = useRef(null)

  useEffect(() => {
    if (!connectionLost || !jobId || fetchingResult.current || pollActive.current) return

    pollActive.current = true
    let pollCount = 0
    const POLL_INTERVAL_MS = 5_000
    const MAX_POLLS = 180 // 15 minutes (180 × 5s)

    setLocalLogs((prev) => [...prev, '🔄 Connection lost — polling for result every 5s...'])

    const poll = async () => {
      if (!pollActive.current) return

      pollCount++

      if (pollCount > MAX_POLLS) {
        pollActive.current = false
        const msg = 'Processing timed out after 15 minutes.'
        setError(msg)
        setStatus(Status.ERROR)
        setLocalLogs((prev) => [...prev, `❌ ${msg}`])
        return
      }

      try {
        const data = await getResult(jobId)
        // 200 OK — job finished
        pollActive.current = false
        setResult(data)
        setStatus(Status.DONE)
      } catch (err) {
        if (err.status === 500) {
          // Backend explicitly stored a processing error
          pollActive.current = false
          const msg = err.message || 'Processing failed'
          setError(msg)
          setStatus(Status.ERROR)
          setLocalLogs((prev) => [...prev, `❌ ${msg}`])
        } else {
          // 404 (not ready yet) or transient network error — keep polling
          if (pollCount % 12 === 0) {
            // Log a heartbeat every ~60 seconds (12 × 5s)
            const elapsed = Math.round((pollCount * POLL_INTERVAL_MS) / 60_000)
            setLocalLogs((prev) => [
              ...prev,
              `⏳ Still processing... (~${elapsed} min elapsed)`,
            ])
          }
          pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS)
        }
      }
    }

    poll()

    return () => {
      pollActive.current = false
      clearTimeout(pollTimer.current)
    }
  }, [connectionLost, jobId])

  // ── Actions ───────────────────────────────────────────────────────────────
  const startExtraction = useCallback(async (file, quantization = '1/16') => {
    // Cancel any in-flight poll from a previous run
    pollActive.current = false
    clearTimeout(pollTimer.current)

    // Reset FSM state
    setStatus(Status.PROCESSING)
    setError(null)
    setResult(null)
    setJobId(null)
    setLocalLogs(['🎵 Uploading audio file...'])
    fetchingResult.current = false

    try {
      const { job_id } = await startJob(file, { quantization })
      setJobId(job_id) // Triggers the SSE connection via useProgressStream
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
    pollActive.current = false
    clearTimeout(pollTimer.current)
    setStatus(Status.IDLE)
    setLocalLogs([])
    setResult(null)
    setError(null)
    setJobId(null)
    fetchingResult.current = false
  }, [])

  return { status, logs, result, error, progress, startExtraction, downloadResult, reset }
}
