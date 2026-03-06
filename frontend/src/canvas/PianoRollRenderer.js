// frontend/src/canvas/PianoRollRenderer.js
/**
 * Custom Canvas 2D piano roll renderer.
 * Draws MIDI notes as glowing rectangles with velocity-mapped opacity.
 * Features: horizontal scroll synced to playback, vertical "now" cursor.
 */
import { COLORS } from '../utils/constants'

/**
 * Render a piano roll onto a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} notes — Array of { midi, time, duration, velocity, name }
 * @param {object} options
 * @param {number} [options.currentTime=0] — Current playback position in seconds
 * @param {number} [options.duration=10] — Total MIDI duration in seconds
 * @param {number} [options.pitchMin=24] — Lowest visible MIDI note (C1)
 * @param {number} [options.pitchMax=72] — Highest visible MIDI note (C5)
 * @param {number} [options.zoom=1] — Horizontal zoom factor
 * @param {number} [options.scrollOffset=0] — Scroll offset (0–1)
 * @param {boolean} [options.followPlayhead=true] — Auto-scroll to follow playhead
 * @param {number} [options.devicePixelRatio=1]
 */
export function renderPianoRoll(canvas, notes, options = {}) {
  if (!canvas || !notes) return

  const {
    currentTime = 0,
    duration = 10,
    pitchMin = 24,
    pitchMax = 72,
    zoom = 1,
    scrollOffset = 0,
    followPlayhead = true,
    devicePixelRatio = window.devicePixelRatio || 1,
  } = options

  const ctx = canvas.getContext('2d')
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(devicePixelRatio, devicePixelRatio)

  const totalDuration = Math.max(duration, 1)
  const visibleDuration = totalDuration / zoom
  const pitchRange = pitchMax - pitchMin + 1
  const rowHeight = h / pitchRange

  // Calculate visible time window
  let timeStart
  if (followPlayhead && currentTime > 0) {
    // Center playhead at 30% of the viewport
    timeStart = Math.max(0, currentTime - visibleDuration * 0.3)
  } else {
    timeStart = scrollOffset * (totalDuration - visibleDuration)
  }
  const timeEnd = timeStart + visibleDuration

  const pixelsPerSecond = w / visibleDuration

  // ── Background grid ─────────────────────────────────────────────────────
  _drawGrid(ctx, w, h, pitchMin, pitchMax, rowHeight, timeStart, timeEnd, pixelsPerSecond)

  // ── Notes ───────────────────────────────────────────────────────────────
  for (const note of notes) {
    if (note.time + note.duration < timeStart || note.time > timeEnd) continue
    if (note.midi < pitchMin || note.midi > pitchMax) continue

    const x = (note.time - timeStart) * pixelsPerSecond
    const noteW = note.duration * pixelsPerSecond
    const y = h - (note.midi - pitchMin + 1) * rowHeight
    const velocity = note.velocity || 0.8

    // Determine if note is currently playing
    const isActive = currentTime >= note.time && currentTime < note.time + note.duration

    // Note rectangle
    const alpha = 0.3 + velocity * 0.7
    if (isActive) {
      // Active note — bright cyan with glow
      ctx.shadowColor = COLORS.accentCyan
      ctx.shadowBlur = 12
      ctx.fillStyle = `rgba(0, 240, 255, ${Math.min(alpha + 0.2, 1)})`
    } else {
      ctx.shadowBlur = 0
      ctx.fillStyle = `rgba(0, 240, 255, ${alpha * 0.6})`
    }

    const noteRadius = Math.min(3, rowHeight / 2 - 1, noteW / 2)
    _roundRect(ctx, Math.max(0, x), y + 1, Math.max(2, noteW - 1), rowHeight - 2, noteRadius)
    ctx.fill()
    ctx.shadowBlur = 0

    // Note border
    ctx.strokeStyle = isActive
      ? 'rgba(0, 240, 255, 0.9)'
      : 'rgba(0, 240, 255, 0.3)'
    ctx.lineWidth = isActive ? 1.5 : 0.5
    _roundRect(ctx, Math.max(0, x), y + 1, Math.max(2, noteW - 1), rowHeight - 2, noteRadius)
    ctx.stroke()

    // Note label (only if wide enough)
    if (noteW > 30 && rowHeight > 12) {
      ctx.fillStyle = isActive ? '#fff' : COLORS.textMuted
      ctx.font = `${Math.min(10, rowHeight - 4)}px "JetBrains Mono", monospace`
      ctx.fillText(note.name, x + 4, y + rowHeight - 4)
    }
  }

  // ── Playhead cursor ─────────────────────────────────────────────────────
  if (currentTime >= timeStart && currentTime <= timeEnd) {
    const playX = (currentTime - timeStart) * pixelsPerSecond

    // Glow line
    ctx.strokeStyle = COLORS.accentCyan
    ctx.lineWidth = 2
    ctx.shadowColor = COLORS.accentCyan
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.moveTo(playX, 0)
    ctx.lineTo(playX, h)
    ctx.stroke()
    ctx.shadowBlur = 0

    // Playhead triangle at top
    ctx.fillStyle = COLORS.accentCyan
    ctx.beginPath()
    ctx.moveTo(playX - 5, 0)
    ctx.lineTo(playX + 5, 0)
    ctx.lineTo(playX, 8)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
}

/**
 * Draw background grid lines (pitch rows + time markers).
 */
function _drawGrid(ctx, w, h, pitchMin, pitchMax, rowHeight, timeStart, timeEnd, pixelsPerSecond) {
  const pitchRange = pitchMax - pitchMin + 1
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  // Horizontal pitch lines
  for (let pitch = pitchMin; pitch <= pitchMax; pitch++) {
    const y = h - (pitch - pitchMin + 1) * rowHeight
    const noteName = noteNames[pitch % 12]
    const isC = noteName === 'C'
    const isBlackKey = noteName.includes('#')

    // Row background (alternating)
    if (isBlackKey) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)'
      ctx.fillRect(0, y, w, rowHeight)
    }

    // Grid line
    ctx.strokeStyle = isC ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)'
    ctx.lineWidth = isC ? 1 : 0.5
    ctx.beginPath()
    ctx.moveTo(0, y + rowHeight)
    ctx.lineTo(w, y + rowHeight)
    ctx.stroke()

    // Pitch label (only for C notes)
    if (isC && rowHeight > 8) {
      const octave = Math.floor(pitch / 12) - 1
      ctx.fillStyle = COLORS.textMuted
      ctx.font = '9px "JetBrains Mono", monospace'
      ctx.fillText(`C${octave}`, 2, y + rowHeight - 2)
    }
  }

  // Vertical time markers (every second or beat)
  const interval = _getTimeInterval(timeEnd - timeStart)
  const firstMark = Math.ceil(timeStart / interval) * interval

  for (let t = firstMark; t <= timeEnd; t += interval) {
    const x = (t - timeStart) * pixelsPerSecond
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()

    // Time label
    ctx.fillStyle = COLORS.textMuted
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.fillText(`${t.toFixed(1)}s`, x + 2, h - 4)
  }
}

/**
 * Choose a sensible time interval based on visible range.
 */
function _getTimeInterval(visibleSeconds) {
  if (visibleSeconds < 2) return 0.25
  if (visibleSeconds < 5) return 0.5
  if (visibleSeconds < 15) return 1
  if (visibleSeconds < 30) return 2
  if (visibleSeconds < 60) return 5
  return 10
}

/**
 * Draw a rounded rectangle path.
 */
function _roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
