// frontend/src/hooks/useWebSocket.js
/**
 * WebSocket hook for real-time audio processing with SSE fallback.
 *
 * Tries WebSocket first. If the WS connection fails (e.g., HF Spaces nginx
 * stripping upgrade headers), automatically falls back to the legacy SSE
 * system (startJob → useProgressStream → getResult).
 *
 * Uses Zustand store for all state mutations.
 */
import { useCallback, useRef, useEffect } from 'react'
import useAppStore from '../stores/appStore'
import { WS_URL, WS_RECONNECT_MAX_RETRIES, WS_RECONNECT_BASE_DELAY_MS } from '../utils/constants'
import { readFileAsArrayBuffer } from '../utils/audioUtils'
import { startJob, getResult } from '../api/bassApi'

/**
 * @returns {{ sendAudio, cancel, isConnected, useFallback }}
 */
export function useWebSocket() {
  const wsRef = useRef(null)
  const isConnectedRef = useRef(false)
  const fallbackRef = useRef(false)
  const cancelledRef = useRef(false)

  // Zustand actions
  const {
    setStage, setProgress, addLog, setResult, setMultiResult,
    setError, params, clearLogs,
  } = useAppStore.getState()

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try { wsRef.current.close() } catch {}
        wsRef.current = null
      }
    }
  }, [])

  /**
   * Send an audio file for processing via WebSocket.
   * Falls back to SSE if WS fails.
   */
  const sendAudio = useCallback(async (file, multiStem = false) => {
    cancelledRef.current = false
    const store = useAppStore.getState()

    // Reset state
    store.clearLogs()
    store.setStage('uploading', null)
    store.setProgress(0)

    store.addLog('Preparing upload...')

    // Read file as ArrayBuffer
    let arrayBuffer
    try {
      arrayBuffer = await readFileAsArrayBuffer(file)
    } catch (err) {
      store.setError(`Failed to read file: ${err.message}`)
      return
    }

    // Try WebSocket first
    const wsEndpoint = multiStem ? '/multi-stem' : '/process'
    const wsUrl = `${WS_URL}/api/ws${wsEndpoint}`

    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        let wsOpened = false

        // Timeout: if WS doesn't open in 5s, fall back to SSE
        const openTimeout = setTimeout(() => {
          if (!wsOpened) {
            console.warn('[useWebSocket] WS open timeout, falling back to SSE')
            try { ws.close() } catch {}
            _fallbackToSSE(file, store)
            resolve()
          }
        }, 5000)

        ws.onopen = () => {
          wsOpened = true
          clearTimeout(openTimeout)
          isConnectedRef.current = true
          store.addLog('Connected to server.')
          store.setStage('uploading', null)

          // Step 1: Send binary audio data
          ws.send(arrayBuffer)
          store.addLog('Uploading audio...')

          // Step 2: Send JSON config
          const currentParams = useAppStore.getState().params
          const config = {
            filename: file.name,
            quantization: currentParams.quantization,
            onset_threshold: currentParams.onset_threshold,
            frame_threshold: currentParams.frame_threshold,
            minimum_note_length_ms: currentParams.minimum_note_length_ms,
            pitch_confidence_threshold: currentParams.pitch_confidence_threshold,
            frequency_range: currentParams.frequency_range,
          }
          ws.send(JSON.stringify(config))
          store.setStage('processing', 'initializing')
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            switch (data.type) {
              case 'progress':
                store.setStage('processing', data.stage)
                store.setProgress(data.progress)
                store.addLog(data.message)
                break

              case 'result':
                store.setResult(data)
                store.addLog('Processing complete!')
                _closeWs()
                resolve()
                break

              case 'multi_result':
                store.setMultiResult(data)
                store.addLog('Multi-stem processing complete!')
                _closeWs()
                resolve()
                break

              case 'error':
                store.setError(data.message)
                store.addLog(`Error: ${data.message}`)
                _closeWs()
                resolve()
                break
            }
          } catch (e) {
            console.error('[useWebSocket] Message parse error:', e)
          }
        }

        ws.onerror = (err) => {
          if (!wsOpened) {
            // WS never opened — fall back to SSE
            clearTimeout(openTimeout)
            console.warn('[useWebSocket] WS error before open, falling back to SSE')
            _fallbackToSSE(file, store)
            resolve()
          } else {
            console.error('[useWebSocket] WS error:', err)
          }
        }

        ws.onclose = (event) => {
          isConnectedRef.current = false
          wsRef.current = null
          if (!wsOpened && !fallbackRef.current) {
            clearTimeout(openTimeout)
            _fallbackToSSE(file, store)
            resolve()
          }
        }
      } catch (err) {
        console.warn('[useWebSocket] WS creation failed, falling back to SSE:', err)
        _fallbackToSSE(file, useAppStore.getState())
        resolve()
      }
    })
  }, [])

  /**
   * Cancel the current processing.
   */
  const cancel = useCallback(() => {
    cancelledRef.current = true
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel' }))
      useAppStore.getState().addLog('Cancellation requested...')
    }
    _closeWs()
  }, [])

  /**
   * Close WebSocket connection.
   */
  function _closeWs() {
    if (wsRef.current) {
      try { wsRef.current.close() } catch {}
      wsRef.current = null
      isConnectedRef.current = false
    }
  }

  /**
   * Fallback to legacy SSE system when WebSocket fails.
   */
  async function _fallbackToSSE(file, store) {
    if (fallbackRef.current) return
    fallbackRef.current = true

    console.log('[useWebSocket] Falling back to SSE transport')
    store.addLog('WebSocket unavailable, using SSE fallback...')
    store.setStage('uploading', null)

    try {
      const currentParams = useAppStore.getState().params
      const { job_id } = await startJob(file, {
        quantization: currentParams.quantization,
      })

      store.addLog('Upload complete. Processing started...')
      store.setStage('processing', 'bpm_detection')

      // Poll SSE progress
      const es = new EventSource(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/api/progress/${job_id}`
      )

      es.onmessage = (e) => {
        try {
          const { progress: pct, message } = JSON.parse(e.data)
          if (pct < 0) {
            store.setError(message)
            store.addLog(message)
            es.close()
            return
          }
          store.setProgress(pct / 100)
          store.addLog(message)
          if (pct >= 100) {
            es.close()
            // Fetch result
            getResult(job_id)
              .then((data) => {
                store.setResult(data)
                store.addLog('Processing complete!')
              })
              .catch((err) => {
                store.setError(err.message)
              })
              .finally(() => {
                fallbackRef.current = false
              })
          }
        } catch {}
      }

      es.onerror = () => {
        store.setError('SSE connection lost.')
        store.addLog('Connection lost.')
        es.close()
        fallbackRef.current = false
      }
    } catch (err) {
      store.setError(err.message || 'Upload failed.')
      store.addLog(`Error: ${err.message}`)
      fallbackRef.current = false
    }
  }

  return {
    sendAudio,
    cancel,
    get isConnected() { return isConnectedRef.current },
    get useFallback() { return fallbackRef.current },
  }
}
