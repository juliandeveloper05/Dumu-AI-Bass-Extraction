/**
 * useProgressStream.js
 *
 * Hook that opens an SSE connection to the backend progress endpoint.
 * Uses the native EventSource Web API — no external dependencies.
 *
 * Distinguishes two failure modes:
 *   - `error`          — backend sent an explicit error event (progress = -1)
 *   - `connectionLost` — SSE transport dropped (network timeout, proxy cut-off)
 *
 * Usage:
 *   const { logs, progress, done, error, connectionLost } = useProgressStream(jobId)
 */
import { useEffect, useState, useRef } from 'react'
import { API_ORIGIN } from '../api/bassApi'

export function useProgressStream(jobId) {
  const [logs, setLogs]                     = useState([])
  const [progress, setProgress]             = useState(0)
  const [done, setDone]                     = useState(false)
  const [error, setError]                   = useState(null)
  const [connectionLost, setConnectionLost] = useState(false)
  const esRef = useRef(null)

  useEffect(() => {
    if (!jobId) return

    // Reset state for new job
    setLogs([])
    setProgress(0)
    setDone(false)
    setError(null)
    setConnectionLost(false)

    const es = new EventSource(`${API_ORIGIN}/api/progress/${jobId}`)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const { progress: pct, message } = JSON.parse(e.data)

        // Backend-sent error event (progress = -1)
        if (pct < 0) {
          setError(message)
          setLogs((prev) => [...prev, message])
          es.close()
          return
        }

        setProgress(pct)
        setLogs((prev) => [...prev, message])

        if (pct >= 100) {
          setDone(true)
          es.close()
        }
      } catch {
        // Malformed event — skip
      }
    }

    // Transport-level drop (proxy timeout, network cut-off, etc.)
    // NOT a backend processing error — the job may still be running.
    es.onerror = () => {
      setConnectionLost(true)
      setLogs((prev) => [...prev, '⚠️ Stream disconnected — switching to polling...'])
      es.close()
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [jobId])

  return { logs, progress, done, error, connectionLost }
}
