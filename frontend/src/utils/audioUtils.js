// frontend/src/utils/audioUtils.js
/**
 * Audio data conversion utilities.
 * Handles Base64 decoding, ArrayBuffer conversion, and file downloads.
 */

/**
 * Decode a Base64 string to a Uint8Array.
 * @param {string} b64 — Base64-encoded string
 * @returns {Uint8Array}
 */
export function base64ToUint8Array(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * Decode a Base64 string to an ArrayBuffer.
 * @param {string} b64 — Base64-encoded string
 * @returns {ArrayBuffer}
 */
export function base64ToArrayBuffer(b64) {
  return base64ToUint8Array(b64).buffer
}

/**
 * Create a Blob from a Base64 string.
 * @param {string} b64 — Base64-encoded data
 * @param {string} mimeType — MIME type (e.g., 'audio/wav', 'audio/midi')
 * @returns {Blob}
 */
export function base64ToBlob(b64, mimeType) {
  return new Blob([base64ToUint8Array(b64)], { type: mimeType })
}

/**
 * Trigger a browser download for a Blob.
 * @param {Blob} blob — File data
 * @param {string} filename — Download filename
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Download a Base64-encoded file.
 * @param {string} b64 — Base64 data
 * @param {string} filename — Download filename
 * @param {string} mimeType — MIME type
 */
export function downloadBase64(b64, filename, mimeType) {
  const blob = base64ToBlob(b64, mimeType)
  downloadBlob(blob, filename)
}

/**
 * Read a File object as an ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

/**
 * Validate a file for upload.
 * @param {File} file
 * @param {string[]} allowedExtensions — e.g., ['.mp3', '.wav']
 * @param {number} maxSizeMB
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateFile(file, allowedExtensions, maxSizeMB) {
  if (!file) return { valid: false, error: 'No file selected.' }

  const ext = '.' + file.name.split('.').pop().toLowerCase()
  if (!allowedExtensions.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported format: ${ext}. Allowed: ${allowedExtensions.join(', ')}`,
    }
  }

  const sizeMB = file.size / (1024 * 1024)
  if (sizeMB > maxSizeMB) {
    return {
      valid: false,
      error: `File too large (${sizeMB.toFixed(1)}MB). Max: ${maxSizeMB}MB.`,
    }
  }

  return { valid: true }
}

/**
 * Format seconds as MM:SS.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
