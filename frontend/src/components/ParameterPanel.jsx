// frontend/src/components/ParameterPanel.jsx
/**
 * Floating control panel for adjustable Basic Pitch parameters.
 * Custom range sliders with presets and re-process functionality.
 */
import React, { useCallback, useRef } from 'react'
import { Settings, RotateCcw, Zap, Scale, Crosshair } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import useAppStore from '../stores/appStore'
import { PARAM_META, PRESETS, DEBOUNCE_MS } from '../utils/constants'
import { useWebSocket } from '../hooks/useWebSocket'

export default React.memo(function ParameterPanel() {
  const showPanel = useAppStore((s) => s.showParameterPanel)
  const params = useAppStore((s) => s.params)
  const stage = useAppStore((s) => s.stage)
  const midiB64 = useAppStore((s) => s.midiB64)
  const { setParams, setFrequencyRange, resetParams, applyPreset, toggleParameterPanel } = useAppStore.getState()

  const { sendAudio } = useWebSocket()
  const debounceTimers = useRef({})

  const hasResult = stage === 'complete' && !!midiB64

  const debouncedSetParam = useCallback((key, value) => {
    if (debounceTimers.current[key]) {
      clearTimeout(debounceTimers.current[key])
    }
    debounceTimers.current[key] = setTimeout(() => {
      if (key === 'frequency_range_min') {
        setFrequencyRange({ min_hz: value })
      } else if (key === 'frequency_range_max') {
        setFrequencyRange({ max_hz: value })
      } else {
        setParams({ [key]: value })
      }
    }, DEBOUNCE_MS)
  }, [])

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={toggleParameterPanel}
        className={`glass-panel p-2.5 rounded-xl transition-all ${showPanel ? 'border-[var(--accent-cyan)]' : ''}`}
        aria-label="Toggle parameter panel"
      >
        <Settings className={`w-5 h-5 ${showPanel ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-muted)]'}`} />
      </button>

      {/* Panel */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            className="glass-panel p-5 w-80"
            initial={{ opacity: 0, x: 20, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            transition={{ duration: 0.3 }}
          >
            <h3 className="text-sm font-medium text-[var(--text-primary)] font-heading mb-4 flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-[var(--accent-cyan)]" />
              MIDI Parameters
            </h3>

            {/* Presets */}
            <div className="flex gap-2 mb-5">
              {Object.entries(PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg
                    bg-[rgba(255,255,255,0.05)] text-[var(--text-muted)]
                    hover:bg-[rgba(0,240,255,0.1)] hover:text-[var(--accent-cyan)]
                    transition-all border border-[var(--glass-border)]"
                  title={preset.description}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Sliders */}
            <div className="space-y-4">
              <ParamSlider
                meta={PARAM_META.onset_threshold}
                value={params.onset_threshold}
                onChange={(v) => debouncedSetParam('onset_threshold', v)}
              />
              <ParamSlider
                meta={PARAM_META.frame_threshold}
                value={params.frame_threshold}
                onChange={(v) => debouncedSetParam('frame_threshold', v)}
              />
              <ParamSlider
                meta={PARAM_META.minimum_note_length_ms}
                value={params.minimum_note_length_ms}
                onChange={(v) => debouncedSetParam('minimum_note_length_ms', v)}
              />
              <ParamSlider
                meta={PARAM_META.pitch_confidence_threshold}
                value={params.pitch_confidence_threshold}
                onChange={(v) => debouncedSetParam('pitch_confidence_threshold', v)}
              />
              <ParamSlider
                meta={PARAM_META.frequency_range_min}
                value={params.frequency_range.min_hz}
                onChange={(v) => debouncedSetParam('frequency_range_min', v)}
              />
              <ParamSlider
                meta={PARAM_META.frequency_range_max}
                value={params.frequency_range.max_hz}
                onChange={(v) => debouncedSetParam('frequency_range_max', v)}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 mt-5 pt-4 border-t border-[var(--glass-border)]">
              <button
                onClick={resetParams}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                  text-[var(--text-muted)] hover:text-[var(--text-primary)]
                  bg-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.06)]
                  transition-all"
                aria-label="Reset parameters to defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>

              {hasResult && (
                <button
                  onClick={() => {
                    const file = useAppStore.getState().audioFile
                    if (file) sendAudio(file, false)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg
                    text-[var(--accent-cyan)] font-medium
                    bg-[rgba(0,240,255,0.1)] hover:bg-[rgba(0,240,255,0.2)]
                    transition-all ml-auto"
                  aria-label="Re-process with new parameters"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Re-process
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
})

/**
 * Individual parameter slider.
 */
function ParamSlider({ meta, value, onChange }) {
  const displayValue = meta.step >= 1 ? Math.round(value) : value.toFixed(2)

  return (
    <div className="group">
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-xs text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors"
          title={meta.tooltip}
        >
          {meta.label}
        </label>
        <span className="text-xs font-mono text-[var(--accent-cyan)]">
          {displayValue}{meta.unit ? ` ${meta.unit}` : ''}
        </span>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer
          bg-[rgba(255,255,255,0.06)]
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-[var(--accent-cyan)]
          [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,240,255,0.5)]
          [&::-webkit-slider-thumb]:cursor-pointer
          [&::-webkit-slider-thumb]:transition-shadow
          [&::-webkit-slider-thumb]:hover:shadow-[0_0_12px_rgba(0,240,255,0.8)]"
        aria-label={meta.label}
      />
      <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
        <span>{meta.min}{meta.unit || ''}</span>
        <span>{meta.max}{meta.unit || ''}</span>
      </div>
    </div>
  )
}
