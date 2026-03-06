// frontend/src/canvas/WaveformRenderer.js
/**
 * Custom Canvas 2D waveform renderer.
 * Draws audio waveform peaks with a cyan gradient fill.
 * Supports zoom, horizontal scroll, and playhead cursor.
 *
 * No external waveform libraries — built from scratch for full control
 * over appearance and 3D texture integration.
 */
import { COLORS } from '../utils/constants'

/**
 * Render waveform peaks onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} peaks — Normalized peak values [0, 1]
 * @param {object} options
 * @param {number} [options.zoom=1] — Horizontal zoom factor
 * @param {number} [options.scrollOffset=0] — Horizontal scroll offset (0–1)
 * @param {number} [options.playheadPosition=-1] — Playhead position (0–1), -1 = hidden
 * @param {boolean} [options.mirror=true] — Draw mirrored (above + below center)
 * @param {number} [options.devicePixelRatio=1] — DPR for high-res rendering
 */
export function renderWaveform(canvas, peaks, options = {}) {
  if (!canvas || !peaks || peaks.length === 0) return

  const {
    zoom = 1,
    scrollOffset = 0,
    playheadPosition = -1,
    mirror = true,
    devicePixelRatio = window.devicePixelRatio || 1,
  } = options

  const ctx = canvas.getContext('2d')
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio

  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Scale for DPR
  ctx.save()
  ctx.scale(devicePixelRatio, devicePixelRatio)

  // Calculate visible range
  const totalBars = peaks.length
  const visibleBars = Math.floor(totalBars / zoom)
  const startBar = Math.floor(scrollOffset * (totalBars - visibleBars))
  const endBar = Math.min(startBar + visibleBars, totalBars)
  const barWidth = w / visibleBars

  const centerY = h / 2

  // Create gradient
  const gradientUp = ctx.createLinearGradient(0, 0, 0, centerY)
  gradientUp.addColorStop(0, COLORS.accentCyan)
  gradientUp.addColorStop(0.5, 'rgba(0, 240, 255, 0.6)')
  gradientUp.addColorStop(1, COLORS.bgSurface)

  const gradientDown = ctx.createLinearGradient(0, centerY, 0, h)
  gradientDown.addColorStop(0, COLORS.bgSurface)
  gradientDown.addColorStop(0.5, 'rgba(0, 240, 255, 0.6)')
  gradientDown.addColorStop(1, COLORS.accentCyan)

  // Draw bars
  for (let i = startBar; i < endBar; i++) {
    const x = (i - startBar) * barWidth
    const peak = peaks[i] || 0
    const barHeight = peak * (centerY - 4)

    // Upper half
    ctx.fillStyle = gradientUp
    ctx.fillRect(x + 0.5, centerY - barHeight, Math.max(barWidth - 1, 1), barHeight)

    // Lower half (mirrored)
    if (mirror) {
      ctx.fillStyle = gradientDown
      ctx.fillRect(x + 0.5, centerY, Math.max(barWidth - 1, 1), barHeight)
    }
  }

  // Center line
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, centerY)
  ctx.lineTo(w, centerY)
  ctx.stroke()

  // Playhead cursor
  if (playheadPosition >= 0 && playheadPosition <= 1) {
    const playX = playheadPosition * w
    ctx.strokeStyle = COLORS.accentCyan
    ctx.lineWidth = 2
    ctx.shadowColor = COLORS.accentCyan
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.moveTo(playX, 0)
    ctx.lineTo(playX, h)
    ctx.stroke()
    ctx.shadowBlur = 0

    // Playhead dot
    ctx.fillStyle = COLORS.accentCyan
    ctx.beginPath()
    ctx.arc(playX, centerY, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

/**
 * Setup canvas for high-DPI rendering.
 * @param {HTMLCanvasElement} canvas
 * @param {number} width — CSS width
 * @param {number} height — CSS height
 * @returns {number} devicePixelRatio
 */
export function setupHiDPI(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1
  canvas.width = width * dpr
  canvas.height = height * dpr
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  return dpr
}
