/**
 * bassApi.js
 * Centralized API module. All fetch logic lives here — no raw fetch calls
 * scattered across components. Returns typed result objects so the UI never
 * has to parse raw Response objects.
 */

// VITE_API_URL is set in Vercel to the HF Space origin, e.g.
// https://julian4deep-bass-trap-ai.hf.space
// Locally it falls back to localhost:8000.
// The backend mounts its router at /api, so we append /api here.
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

/**
 * Uploads an audio file and starts the extraction pipeline.
 * Returns immediately with a job_id — does NOT wait for processing.
 *
 * @param {File} file - The audio file to process
 * @param {AbortSignal} [signal] - Optional AbortController signal for cancellation
 * @returns {Promise<{ job_id: string }>}
 */
export async function startJob(file, { signal, quantization = '1/16' } = {}) {
  const formData = new FormData()
  formData.append('audio_file', file)
  formData.append('quantization', quantization)

  const response = await fetch(`${API_ORIGIN}/api/process`, {
    method: 'POST',
    body: formData,
    signal,
  })

  const data = await response.json().catch(() => ({
    detail: `Server returned ${response.status} with no JSON body`,
  }))

  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : JSON.stringify(data.detail)
    throw new ApiError(message, response.status)
  }

  return data
}

/**
 * Fetches the final pipeline result after processing is done.
 *
 * @param {string} jobId
 * @returns {Promise<{ bpm: number, midi_b64: string, filename: string }>}
 */
export async function getResult(jobId) {
  const response = await fetch(`${API_ORIGIN}/api/result/${jobId}`)

  const data = await response.json().catch(() => ({
    detail: `Server returned ${response.status} with no JSON body`,
  }))

  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : JSON.stringify(data.detail)
    throw new ApiError(message, response.status)
  }

  return data
}

/**
 * @deprecated Use startJob() + EventSource + getResult() instead.
 * Kept temporarily for reference.
 */
export async function extractBass(file, signal) {
  const formData = new FormData()
  formData.append('audio_file', file)

  const response = await fetch(`${API_ORIGIN}/api/process`, {
    method: 'POST',
    body: formData,
    signal,
  })

  const data = await response.json().catch(() => ({
    detail: `Server returned ${response.status} with no JSON body`,
  }))

  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : JSON.stringify(data.detail)
    throw new ApiError(message, response.status)
  }

  return data
}

/**
 * Structured error class so UI can differentiate API errors from
 * network failures (e.g. no `status` on a TypeError).
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}