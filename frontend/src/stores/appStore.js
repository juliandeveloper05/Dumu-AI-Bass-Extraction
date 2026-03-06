// frontend/src/stores/appStore.js
/**
 * Zustand global state store for the entire DUMU application.
 *
 * State machine: idle → uploading → processing → complete → error → idle
 * Processing has substages: bpm_detection | bass_isolation | midi_conversion | quantization | encoding
 */
import { create } from 'zustand'

const DEFAULT_PARAMS = {
  onset_threshold: 0.6,
  frame_threshold: 0.5,
  minimum_note_length_ms: 100,
  pitch_confidence_threshold: 0.7,
  frequency_range: { min_hz: 30, max_hz: 400 },
  quantization: '1/16',
}

const useAppStore = create((set, get) => ({
  // ── Processing state machine ──────────────────────────────────────────────
  stage: 'idle',        // idle | uploading | processing | complete | error
  substage: null,       // bpm_detection | bass_isolation | midi_conversion | quantization | encoding
  progress: 0,          // 0.0 – 1.0
  logs: [],             // [{ time: number, message: string }]
  error: null,          // string | null

  // ── Audio data ────────────────────────────────────────────────────────────
  audioFile: null,      // File object from upload
  audioBuffer: null,    // Decoded AudioBuffer for client-side preview
  waveformPeaks: null,  // { peaks: [float], duration: float, sample_rate: int }
  spectrogramData: null, // { original: {...}, bass: {...} }

  // ── MIDI data ─────────────────────────────────────────────────────────────
  midiBinary: null,     // Uint8Array — raw MIDI bytes
  midiB64: null,        // Base64 string for download
  bpm: null,            // Detected BPM (integer)
  filename: null,       // Original filename

  // ── Bass audio ────────────────────────────────────────────────────────────
  bassAudioB64: null,   // Base64-encoded WAV

  // ── Multi-stem ────────────────────────────────────────────────────────────
  stems: null,          // { bass: { audio_b64, midi_b64 }, drums: { audio_b64 }, ... }
  multiStemMode: false, // Whether multi-stem extraction is enabled
  selectedStems: ['bass'], // Which stems to extract

  // ── Parameters ────────────────────────────────────────────────────────────
  params: { ...DEFAULT_PARAMS },

  // ── UI state ──────────────────────────────────────────────────────────────
  midiPlaybackActive: false,
  showParameterPanel: false,
  showStemSelector: false,

  // ── Actions ───────────────────────────────────────────────────────────────

  setStage: (stage, substage = null) => set({ stage, substage }),

  setProgress: (progress) => set({ progress }),

  addLog: (message) =>
    set((s) => ({
      logs: [...s.logs, { time: Date.now(), message }],
    })),

  clearLogs: () => set({ logs: [] }),

  setAudioFile: (file) => set({ audioFile: file }),

  setAudioBuffer: (buffer) => set({ audioBuffer: buffer }),

  setWaveformPeaks: (peaks) => set({ waveformPeaks: peaks }),

  setSpectrogramData: (data) => set({ spectrogramData: data }),

  setResult: (data) =>
    set({
      stage: 'complete',
      substage: null,
      progress: 1.0,
      bpm: data.bpm,
      midiB64: data.midi_b64,
      midiBinary: data.midi_b64
        ? Uint8Array.from(atob(data.midi_b64), (c) => c.charCodeAt(0))
        : null,
      bassAudioB64: data.bass_audio_b64 || null,
      filename: data.filename || null,
      waveformPeaks: data.waveform_data || null,
      spectrogramData: data.spectrogram_data || null,
    }),

  setMultiResult: (data) =>
    set({
      stage: 'complete',
      substage: null,
      progress: 1.0,
      bpm: data.bpm,
      stems: data.stems,
      filename: data.filename || null,
      // Extract bass MIDI if available
      midiB64: data.stems?.bass?.midi_b64 || null,
      midiBinary: data.stems?.bass?.midi_b64
        ? Uint8Array.from(atob(data.stems.bass.midi_b64), (c) => c.charCodeAt(0))
        : null,
      bassAudioB64: data.stems?.bass?.audio_b64 || null,
    }),

  setError: (error) => set({ error, stage: 'error' }),

  setParams: (partialParams) =>
    set((s) => ({
      params: { ...s.params, ...partialParams },
    })),

  setFrequencyRange: (range) =>
    set((s) => ({
      params: {
        ...s.params,
        frequency_range: { ...s.params.frequency_range, ...range },
      },
    })),

  resetParams: () => set({ params: { ...DEFAULT_PARAMS } }),

  applyPreset: (presetName) => {
    const presets = {
      conservative: {
        onset_threshold: 0.8,
        frame_threshold: 0.7,
        minimum_note_length_ms: 150,
        pitch_confidence_threshold: 0.85,
      },
      balanced: { ...DEFAULT_PARAMS },
      aggressive: {
        onset_threshold: 0.3,
        frame_threshold: 0.3,
        minimum_note_length_ms: 50,
        pitch_confidence_threshold: 0.5,
      },
    }
    const preset = presets[presetName]
    if (preset) {
      set((s) => ({ params: { ...s.params, ...preset } }))
    }
  },

  setMultiStemMode: (enabled) => set({ multiStemMode: enabled }),

  setSelectedStems: (stems) => {
    // Bass is always included
    const withBass = stems.includes('bass') ? stems : ['bass', ...stems]
    set({ selectedStems: withBass })
  },

  toggleStem: (stem) =>
    set((s) => {
      if (stem === 'bass') return s // Bass cannot be deselected
      const current = s.selectedStems
      const next = current.includes(stem)
        ? current.filter((s) => s !== stem)
        : [...current, stem]
      return { selectedStems: next }
    }),

  setMidiPlaybackActive: (active) => set({ midiPlaybackActive: active }),

  toggleParameterPanel: () =>
    set((s) => ({ showParameterPanel: !s.showParameterPanel })),

  toggleStemSelector: () =>
    set((s) => ({ showStemSelector: !s.showStemSelector })),

  // ── Full reset ────────────────────────────────────────────────────────────
  reset: () =>
    set({
      stage: 'idle',
      substage: null,
      progress: 0,
      logs: [],
      error: null,
      audioFile: null,
      audioBuffer: null,
      waveformPeaks: null,
      spectrogramData: null,
      midiBinary: null,
      midiB64: null,
      bpm: null,
      filename: null,
      bassAudioB64: null,
      stems: null,
      midiPlaybackActive: false,
    }),
}))

export default useAppStore
