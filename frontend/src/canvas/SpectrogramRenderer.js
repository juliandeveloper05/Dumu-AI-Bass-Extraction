// frontend/src/canvas/SpectrogramRenderer.js
/**
 * Custom Canvas 2D spectrogram heatmap renderer.
 * Draws mel spectrogram data using a magma-style colormap.
 * Supports side-by-side and overlay modes.
 */
import { COLORS } from '../utils/constants'

// Magma-style colormap (black → purple → red → yellow → white)
const MAGMA_STOPS = [
  [0.0, [0, 0, 4]],
  [0.15, [28, 16, 68]],
  [0.3, [79, 18, 123]],
  [0.45, [129, 37, 129]],
  [0.6, [181, 54, 122]],
  [0.7, [229, 89, 100]],
  [0.8, [251, 135, 97]],
  [0.9, [254, 194, 140]],
  [1.0, [252, 253, 191]],
]

/**
 * Interpolate the magma colormap for a value in [0, 1].
 * @param {number} t — Value between 0 and 1
 * @returns {[number, number, number]} — RGB values [0-255]
 */
function magmaColor(t) {
  t = Math.max(0, Math.min(1, t))

  for (let i = 1; i < MAGMA_STOPS.length; i++) {
    const [t1, c1] = MAGMA_STOPS[i - 1]
    const [t2, c2] = MAGMA_STOPS[i]
    if (t <= t2) {
      const f = (t - t1) / (t2 - t1)
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * f),
        Math.round(c1[1] + (c2[1] - c1[1]) * f),
        Math.round(c1[2] + (c2[2] - c1[2]) * f),
      ]
    }
  }
  return MAGMA_STOPS[MAGMA_STOPS.length - 1][1]
}

/**
 * Render a spectrogram heatmap onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} matrix — 2D array [n_mels][time_frames], values in [0, 1]
 * @param {object} options
 * @param {number} [options.devicePixelRatio=1]
 */
export function renderSpectrogram(canvas, matrix, options = {}) {
  if (!canvas || !matrix || matrix.length === 0) return

  const {
    devicePixelRatio = window.devicePixelRatio || 1,
  } = options

  const ctx = canvas.getContext('2d')
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(devicePixelRatio, devicePixelRatio)

  const nMels = matrix.length
  const nTime = matrix[0].length

  const cellW = w / nTime
  const cellH = h / nMels

  // Use ImageData for performance
  const imageData = ctx.createImageData(Math.ceil(w * devicePixelRatio), Math.ceil(h * devicePixelRatio))
  const data = imageData.data
  const imgW = imageData.width
  const imgH = imageData.height

  for (let freq = 0; freq < nMels; freq++) {
    for (let time = 0; time < nTime; time++) {
      const value = matrix[freq][time] || 0
      const [r, g, b] = magmaColor(value)

      // Spectrogram is rendered with low frequencies at the bottom
      const y0 = Math.floor((nMels - 1 - freq) / nMels * imgH)
      const y1 = Math.floor((nMels - freq) / nMels * imgH)
      const x0 = Math.floor(time / nTime * imgW)
      const x1 = Math.floor((time + 1) / nTime * imgW)

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * imgW + px) * 4
          data[idx] = r
          data[idx + 1] = g
          data[idx + 2] = b
          data[idx + 3] = 255
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0)
  ctx.restore()
}

/**
 * Render side-by-side spectrograms (original vs bass).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} originalMatrix
 * @param {number[][]} bassMatrix
 * @param {object} options
 */
export function renderSpectrogramSideBySide(canvas, originalMatrix, bassMatrix, options = {}) {
  if (!canvas) return

  const {
    devicePixelRatio = window.devicePixelRatio || 1,
  } = options

  const ctx = canvas.getContext('2d')
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Create two off-screen canvases
  const halfW = Math.floor(w / 2) - 2

  if (originalMatrix && originalMatrix.length > 0) {
    const offCanvas1 = document.createElement('canvas')
    offCanvas1.width = halfW * devicePixelRatio
    offCanvas1.height = h * devicePixelRatio
    renderSpectrogram(offCanvas1, originalMatrix, { devicePixelRatio })
    ctx.drawImage(offCanvas1, 0, 0, halfW, h)

    // Label
    ctx.fillStyle = COLORS.textMuted
    ctx.font = `11px "Inter", sans-serif`
    ctx.fillText('Original', 8, 16)
  }

  if (bassMatrix && bassMatrix.length > 0) {
    const offCanvas2 = document.createElement('canvas')
    offCanvas2.width = halfW * devicePixelRatio
    offCanvas2.height = h * devicePixelRatio
    renderSpectrogram(offCanvas2, bassMatrix, { devicePixelRatio })
    ctx.drawImage(offCanvas2, halfW + 4, 0, halfW, h)

    // Label
    ctx.fillStyle = COLORS.accentCyan
    ctx.font = `11px "Inter", sans-serif`
    ctx.fillText('Bass', halfW + 12, 16)
  }

  // Divider line
  ctx.strokeStyle = COLORS.glassBorder
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(halfW + 2, 0)
  ctx.lineTo(halfW + 2, h)
  ctx.stroke()
}

/**
 * Render overlaid spectrograms (bass highlighted on original).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} originalMatrix
 * @param {number[][]} bassMatrix
 * @param {object} options
 * @param {number} [options.bassAlpha=0.6] — Opacity of bass overlay
 */
export function renderSpectrogramOverlay(canvas, originalMatrix, bassMatrix, options = {}) {
  if (!canvas || !originalMatrix) return

  const {
    devicePixelRatio = window.devicePixelRatio || 1,
    bassAlpha = 0.6,
  } = options

  // Render original first
  renderSpectrogram(canvas, originalMatrix, { devicePixelRatio })

  if (!bassMatrix || bassMatrix.length === 0) return

  // Overlay bass with alpha blending
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  const nMels = bassMatrix.length
  const nTime = bassMatrix[0].length

  for (let freq = 0; freq < nMels; freq++) {
    for (let time = 0; time < nTime; time++) {
      const value = bassMatrix[freq][time] || 0
      if (value < 0.1) continue // Skip near-zero

      const y0 = Math.floor((nMels - 1 - freq) / nMels * h)
      const y1 = Math.floor((nMels - freq) / nMels * h)
      const x0 = Math.floor(time / nTime * w)
      const x1 = Math.floor((time + 1) / nTime * w)

      ctx.fillStyle = `rgba(0, 240, 255, ${value * bassAlpha})`
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
  }
}

/**
 * Get frequency and time at a cursor position.
 *
 * @param {number} x — Cursor X in CSS pixels
 * @param {number} y — Cursor Y in CSS pixels
 * @param {number} canvasWidth — CSS width
 * @param {number} canvasHeight — CSS height
 * @param {object} spectrogramMeta — { duration, sr, fmax, n_mels }
 * @returns {{ frequencyHz: number, timeSeconds: number }}
 */
export function getCursorInfo(x, y, canvasWidth, canvasHeight, spectrogramMeta) {
  const { duration = 1, fmax = 8000, n_mels = 128 } = spectrogramMeta || {}

  const timeSeconds = (x / canvasWidth) * duration
  const melBin = Math.round((1 - y / canvasHeight) * n_mels)
  // Approximate Hz from mel bin (linear approximation for tooltip)
  const frequencyHz = (melBin / n_mels) * fmax

  return {
    frequencyHz: Math.round(frequencyHz),
    timeSeconds: Math.round(timeSeconds * 100) / 100,
  }
}
