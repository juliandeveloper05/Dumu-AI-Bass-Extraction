// frontend/src/hooks/useAudioContext.js
/**
 * Web Audio API hook for client-side audio decoding.
 * Decodes uploaded files instantly for waveform preview before server responds.
 */
import { useState, useCallback, useRef } from 'react'

/**
 * @returns {{ audioBuffer: AudioBuffer|null, decodeFile: (file: File) => Promise<AudioBuffer>, isDecoding: boolean, error: string|null }}
 */
export function useAudioContext() {
  const [audioBuffer, setAudioBuffer] = useState(null)
  const [isDecoding, setIsDecoding] = useState(false)
  const [error, setError] = useState(null)
  const ctxRef = useRef(null)

  /**
   * Get or create the AudioContext.
   * Lazy-initialized to comply with browser autoplay policies.
   */
  function getContext() {
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      ctxRef.current = new AudioCtx()
    }
    return ctxRef.current
  }

  /**
   * Decode a File object into an AudioBuffer.
   * @param {File} file — Audio file to decode
   * @returns {Promise<AudioBuffer>}
   */
  const decodeFile = useCallback(async (file) => {
    setIsDecoding(true)
    setError(null)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const ctx = getContext()
      const buffer = await ctx.decodeAudioData(arrayBuffer)
      setAudioBuffer(buffer)
      setIsDecoding(false)
      return buffer
    } catch (err) {
      const msg = `Failed to decode audio: ${err.message}`
      setError(msg)
      setIsDecoding(false)
      console.error('[useAudioContext]', msg)
      return null
    }
  }, [])

  /**
   * Extract waveform peaks from an AudioBuffer for canvas rendering.
   * @param {AudioBuffer} buffer
   * @param {number} numPoints — Number of output peak values
   * @returns {number[]} — Normalized peak values [0, 1]
   */
  const extractPeaks = useCallback((buffer, numPoints = 2000) => {
    if (!buffer) return []

    const channelData = buffer.getChannelData(0) // Mono or left channel
    const totalSamples = channelData.length
    const chunkSize = Math.max(1, Math.floor(totalSamples / numPoints))
    const actualPoints = Math.min(numPoints, totalSamples)
    const peaks = new Float32Array(actualPoints)

    let maxPeak = 0
    for (let i = 0; i < actualPoints; i++) {
      const start = i * chunkSize
      const end = Math.min(start + chunkSize, totalSamples)
      let rms = 0
      for (let j = start; j < end; j++) {
        rms += channelData[j] * channelData[j]
      }
      rms = Math.sqrt(rms / (end - start))
      peaks[i] = rms
      if (rms > maxPeak) maxPeak = rms
    }

    // Normalize to [0, 1]
    if (maxPeak > 0) {
      for (let i = 0; i < peaks.length; i++) {
        peaks[i] /= maxPeak
      }
    }

    return Array.from(peaks)
  }, [])

  return { audioBuffer, decodeFile, extractPeaks, isDecoding, error }
}
