// frontend/src/utils/constants.js
/**
 * Design tokens, default parameters, API configuration, and animation constants.
 * Single source of truth for the entire DUMU v2.0.0 design system.
 */

// ── Color Palette ───────────────────────────────────────────────────────────
export const COLORS = {
  bgVoid: '#050510',
  bgSurface: '#0A0A2E',
  accentCyan: '#00F0FF',
  accentMagenta: '#FF00E5',
  accentLime: '#AAFF00',
  textPrimary: '#E0E0FF',
  textMuted: '#6B6B99',
  glassBorder: 'rgba(255,255,255,0.08)',
  glassFill: 'rgba(10,10,46,0.6)',
  errorRed: '#FF3366',
  warningAmber: '#FFAA00',
}

// ── Typography ──────────────────────────────────────────────────────────────
export const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Fira Code", monospace',
}

// ── Default Basic Pitch Parameters ──────────────────────────────────────────
export const DEFAULT_PARAMS = {
  onset_threshold: 0.6,
  frame_threshold: 0.5,
  minimum_note_length_ms: 100,
  pitch_confidence_threshold: 0.7,
  frequency_range: { min_hz: 30, max_hz: 400 },
  quantization: '1/16',
}

// ── Parameter Presets ───────────────────────────────────────────────────────
export const PRESETS = {
  conservative: {
    onset_threshold: 0.8,
    frame_threshold: 0.7,
    minimum_note_length_ms: 150,
    pitch_confidence_threshold: 0.85,
    label: 'Conservative',
    description: 'High thresholds — fewer notes, higher confidence.',
  },
  balanced: {
    ...DEFAULT_PARAMS,
    label: 'Balanced',
    description: 'Default settings — good balance of precision and recall.',
  },
  aggressive: {
    onset_threshold: 0.3,
    frame_threshold: 0.3,
    minimum_note_length_ms: 50,
    pitch_confidence_threshold: 0.5,
    label: 'Aggressive',
    description: 'Low thresholds — more notes, including subtle passages.',
  },
}

// ── Parameter Metadata (for slider UI) ──────────────────────────────────────
export const PARAM_META = {
  onset_threshold: {
    label: 'Onset Threshold',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    tooltip: 'Controls how sensitive note onset detection is. Lower = more notes detected.',
  },
  frame_threshold: {
    label: 'Frame Threshold',
    min: 0.1,
    max: 0.9,
    step: 0.05,
    tooltip: 'Controls frame-level pitch confidence. Lower = longer sustains preserved.',
  },
  minimum_note_length_ms: {
    label: 'Min Note Length',
    min: 10,
    max: 500,
    step: 10,
    unit: 'ms',
    tooltip: 'Minimum note duration in milliseconds. Shorter = catches faster passages.',
  },
  pitch_confidence_threshold: {
    label: 'Pitch Confidence',
    min: 0.1,
    max: 0.99,
    step: 0.05,
    tooltip: 'Minimum confidence for pitch detection. Lower = more notes, possibly noisy.',
  },
  frequency_range_min: {
    label: 'Min Frequency',
    min: 20,
    max: 2000,
    step: 10,
    unit: 'Hz',
    tooltip: 'Lower bound of the frequency range for note detection.',
  },
  frequency_range_max: {
    label: 'Max Frequency',
    min: 20,
    max: 2000,
    step: 10,
    unit: 'Hz',
    tooltip: 'Upper bound of the frequency range for note detection.',
  },
}

// ── Quantization Options ────────────────────────────────────────────────────
export const QUANTIZATION_OPTIONS = [
  { value: 'none', label: 'No Quantization', description: 'Original Basic Pitch timing' },
  { value: '1/4', label: '1/4 — Quarter', description: 'Quarter note grid (less precise)' },
  { value: '1/8', label: '1/8 — Eighth', description: 'Eighth note grid' },
  { value: '1/16', label: '1/16 — Sixteenth', description: 'Sixteenth note grid (recommended)' },
]

// ── Stem Configuration ──────────────────────────────────────────────────────
export const STEM_CONFIG = {
  bass: { label: 'Bass', icon: 'Guitar', color: COLORS.accentCyan, locked: true },
  drums: { label: 'Drums', icon: 'Drum', color: COLORS.accentMagenta, locked: false },
  vocals: { label: 'Vocals', icon: 'Mic', color: COLORS.accentLime, locked: false },
  other: { label: 'Other', icon: 'Music', color: COLORS.textPrimary, locked: false },
}

// ── API Configuration ───────────────────────────────────────────────────────
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const WS_URL = (() => {
  const origin = API_ORIGIN
  const wsProtocol = origin.startsWith('https') ? 'wss' : 'ws'
  const host = origin.replace(/^https?:\/\//, '')
  return `${wsProtocol}://${host}`
})()

// ── File Validation ─────────────────────────────────────────────────────────
export const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg']
export const MAX_FILE_SIZE_MB = 50

// ── Animation Constants ─────────────────────────────────────────────────────
export const DEBOUNCE_MS = 300
export const THROTTLE_MS = 16  // 60fps
export const HEALTH_POLL_INTERVAL_MS = 30000
export const WS_RECONNECT_MAX_RETRIES = 5
export const WS_RECONNECT_BASE_DELAY_MS = 1000

// ── Post-Processing Defaults ────────────────────────────────────────────────
export const POST_PROCESSING = {
  bloom: { intensity: 0.5, luminanceThreshold: 0.6, luminanceSmoothing: 0.9 },
  chromaticAberration: { offset: [0.0005, 0.0005] },
  vignette: { darkness: 0.4, offset: 0.3 },
  noise: { opacity: 0.03 },
}
