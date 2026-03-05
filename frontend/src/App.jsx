/**
 * App.jsx
 *
 * Root component. Owns the file selection state (a simple useState<File|null>)
 * and delegates all async/extraction state to useExtraction(). The component
 * itself is a pure rendering machine — it reads status and drives which
 * sub-component is visible.
 *
 * State machine:
 *   file === null          → show DropZone only
 *   file set, idle         → show DropZone (greyed) + FilePreview with CTA
 *   status === processing  → show DropZone (disabled) + FilePreview (spinner) + LogConsole
 *   status === done        → show LogConsole + ResultCard
 *   status === error       → show DropZone (re-enabled) + error banner + LogConsole
 */
import React, { useState, useCallback, useEffect } from 'react'
import { AlertCircle, Github, Waves, FileAudio, X, Zap, Loader2, Linkedin, Instagram, Mail, Phone, Heart, ExternalLink, Info, CheckCircle2, ChevronDown } from 'lucide-react'

import { useExtraction, Status } from './hooks/useExtraction'
import DropZone      from './components/DropZone'
import LogConsole    from './components/LogConsole'
import ResultCard    from './components/ResultCard'
import NotFound      from './components/NotFound'
import NeuralCanvas  from './components/NeuralCanvas'

export default function App() {
  // Selected file — lives here rather than in useExtraction because it's
  // purely a UI concern; the hook only cares about it at submission time.
  const [file, setFile] = useState(null)
  const [showBanner, setShowBanner] = useState(true)
  const [quantization, setQuantization] = useState('1/16')
  const [successToast, setSuccessToast] = useState(null)

  const {
    status,
    logs,
    result,
    error,
    progress,
    startExtraction,
    downloadResult,
    reset,
  } = useExtraction()

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleFile = useCallback((f) => {
    setFile(f)
  }, [])

  const handleStart = useCallback(() => {
    if (file) startExtraction(file, quantization)
  }, [file, quantization, startExtraction])

  // Show success toast when extraction finishes
  useEffect(() => {
    if (status === Status.DONE && result) {
      setSuccessToast(result.bpm)
      const t = setTimeout(() => setSuccessToast(null), 5000)
      return () => clearTimeout(t)
    }
  }, [status, result])

  const handleReset = useCallback(() => {
    reset()
    setFile(null)
  }, [reset])

  // ── Derived booleans ───────────────────────────────────────────────────────
  const isProcessing = status === Status.PROCESSING
  const isDone       = status === Status.DONE
  const isError      = status === Status.ERROR
  // Show the drop zone again when idle or on error (so user can retry)
  const showDropZone = !isDone
  const showLogs     = logs.length > 0

  // Lightweight client-side 404 — no router library needed for a single-page app
  if (window.location.pathname !== '/') {
    return <NotFound />
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-zinc-900 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          {/* Logo mark */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-acid-500/10 border border-acid-500/30 flex items-center justify-center">
              <Waves className="w-4 h-4 text-acid-500" />
            </div>
            <span className="font-mono text-sm font-semibold text-zinc-100 tracking-tight">
              Dumu
            </span>
            <span className="font-mono text-xs text-zinc-600 border border-zinc-800 rounded px-1.5 py-0.5 ml-1">
              v1.5.0
            </span>
          </div>

          {/* Nav right — links to the actual repo */}
          <a
            href="https://github.com/juliandeveloper05/Dumu-AI-Bass-Extraction"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors font-mono text-xs"
            aria-label="GitHub Repository"
          >
            <Github className="w-4 h-4" />
            <span className="hidden sm:inline">Source</span>
          </a>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center px-4 py-16">
        <div className="w-full max-w-2xl space-y-5">

          {/* ── Info Banner ─────────────────────────────────────────────── */}
          {showBanner && (
            <div className="animate-fade-in rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-semibold text-blue-300 mb-1">
                  Processing Time Notice
                </p>
                <p className="font-mono text-xs text-blue-300/70 leading-relaxed">
                  This app runs AI models (Demucs + Basic Pitch) on <strong>CPU</strong>. Processing a full track
                  takes approximately <strong>3–7 minutes</strong>. The progress bar may stay at high percentages
                  while neural networks finish their work — <strong>this is normal</strong>. Your MIDI file will
                  download automatically when ready.
                </p>
              </div>
              <button
                onClick={() => setShowBanner(false)}
                className="text-blue-400/50 hover:text-blue-300 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ── Hero headline ─────────────────────────────────────────────── */}
          <div className="text-center mb-10">
            <h1 className="font-sans text-3xl font-bold text-zinc-100 tracking-tight mb-2">
              AI Bass Extraction
            </h1>
            <p className="font-mono text-sm text-zinc-500">
              Upload your track · Isolate the bass · Export to MIDI
            </p>
          </div>

          {/* ── Pipeline steps indicator ──────────────────────────────────── */}
          <PipelineSteps status={status} />

          {/* ── Quantization selector ─────────────────────────────────────── */}
          {!isDone && (
            <QuantizationSelect
              value={quantization}
              onChange={setQuantization}
              disabled={isProcessing}
            />
          )}

          {/* ── Drop zone ─────────────────────────────────────────────────── */}
          {showDropZone && (
            <DropZone
              onFile={handleFile}
              disabled={isProcessing}
            />
          )}

          {/* ── File preview + Extract CTA ────────────────────────────────── */}
          {file && !isDone && (
            <div className="animate-fade-in rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-4">
              <div className="flex items-center gap-3">
                <FileAudio className="w-5 h-5 text-acid-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm text-zinc-200 truncate">{file.name}</p>
                  <p className="font-mono text-xs text-zinc-600">
                    {file.size < 1024*1024 ? `${(file.size/1024).toFixed(1)} KB` : `${(file.size/(1024*1024)).toFixed(1)} MB`}
                  </p>
                </div>
                {!isProcessing && (
                  <button onClick={handleReset} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button
                onClick={handleStart}
                disabled={isProcessing}
                className={`w-full flex items-center justify-center gap-2 font-mono text-sm font-semibold py-3 rounded-lg transition-all duration-200 ${
                  isProcessing
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-acid-500 text-black hover:bg-acid-400 shadow-[0_0_20px_rgba(163,230,53,0.2)]'
                }`}
              >
                {isProcessing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Processing... (may take 1–2 min)</>
                ) : (
                  <><Zap className="w-4 h-4" /> Extract Bass to MIDI</>
                )}
              </button>

              {/* ── Neural Canvas (Matrix rain) + thin progress bar ──── */}
              {isProcessing && (
                <div className="space-y-3">
                  <NeuralCanvas progress={progress} />
                  {/* Slim progress bar below canvas */}
                  <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-acid-500 to-acid-400 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${progress}%`, boxShadow: '0 0 8px rgba(163,230,53,0.5)' }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Log console ───────────────────────────────────────────────── */}
          {showLogs && (
            <LogConsole
              logs={logs}
              isLive={isProcessing}
            />
          )}

          {/* ── Error banner ──────────────────────────────────────────────── */}
          {isError && error && (
            <ErrorBanner message={error} onDismiss={handleReset} />
          )}

          {/* ── Result card (success state) ───────────────────────────────── */}
          {isDone && result && (
            <ResultCard
              result={result}
              onDownload={downloadResult}
              onReset={handleReset}
            />
          )}

        </div>
      </main>

      {/* ── Success toast ───────────────────────────────────────────────────── */}
      {successToast !== null && (
        <SuccessToast bpm={successToast} onDismiss={() => setSuccessToast(null)} />
      )}

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-zinc-900 px-6 py-8 mt-auto">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Tech stack */}
          <p className="text-center font-mono text-xs text-zinc-700">
            Powered by{' '}
            <span className="text-zinc-500">Demucs</span> ·{' '}
            <span className="text-zinc-500">Basic Pitch</span> ·{' '}
            <span className="text-zinc-500">librosa</span>
          </p>

          {/* Divider */}
          <div className="border-t border-zinc-900" />

          {/* Social + Contact grid */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">

            {/* Social links */}
            <div className="flex items-center gap-4">
              <a href="https://github.com/juliandeveloper05" target="_blank" rel="noreferrer"
                className="text-zinc-600 hover:text-acid-400 transition-colors" aria-label="GitHub">
                <Github className="w-4 h-4" />
              </a>
              <a href="https://www.linkedin.com/in/full-stack-julian-soto/" target="_blank" rel="noreferrer"
                className="text-zinc-600 hover:text-acid-400 transition-colors" aria-label="LinkedIn">
                <Linkedin className="w-4 h-4" />
              </a>
              <a href="https://www.instagram.com/palee_0x71" target="_blank" rel="noreferrer"
                className="text-zinc-600 hover:text-acid-400 transition-colors" aria-label="Instagram">
                <Instagram className="w-4 h-4" />
              </a>
              <a href="https://juliansoto-portfolio.vercel.app/es" target="_blank" rel="noreferrer"
                className="text-zinc-600 hover:text-acid-400 transition-colors flex items-center gap-1" aria-label="Portfolio">
                <ExternalLink className="w-4 h-4" />
                <span className="font-mono text-xs hidden sm:inline">Portfolio</span>
              </a>
            </div>

            {/* Contact info */}
            <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-4">
              <a href="mailto:juliansoto.dev@gmail.com"
                className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors font-mono text-xs">
                <Mail className="w-3.5 h-3.5" />
                juliansoto.dev@gmail.com
              </a>
              <a href="https://wa.me/5491130666369" target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 transition-colors font-mono text-xs">
                <Phone className="w-3.5 h-3.5" />
                +54 9 11 3066-6369
              </a>
            </div>
          </div>

          {/* Copyright */}
          <div className="text-center space-y-1">
            <p className="font-mono text-xs text-zinc-600 flex items-center justify-center gap-1">
              Hecho con <Heart className="w-3 h-3 text-red-500 fill-red-500" /> por{' '}
              <a href="https://github.com/juliandeveloper05" target="_blank" rel="noreferrer"
                className="text-zinc-400 hover:text-acid-400 transition-colors">
                Julian Javier Soto
              </a>
            </p>
            <p className="font-mono text-[10px] text-zinc-700">
              © 2026 Julian Soto. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ─── Internal sub-components ──────────────────────────────────────────────────
// These are simple enough to live in App.jsx without their own files.

/**
 * Three-step visual indicator showing where we are in the pipeline.
 * Step 1 = Upload · Step 2 = Process · Step 3 = Download
 */
function PipelineSteps({ status }) {
  const steps = [
    { label: 'Upload',   activeOn: [Status.IDLE, Status.ERROR] },
    { label: 'Process',  activeOn: [Status.PROCESSING] },
    { label: 'Download', activeOn: [Status.DONE] },
  ]

  const activeIndex =
    status === Status.IDLE || status === Status.ERROR ? 0
    : status === Status.PROCESSING                    ? 1
    :                                                   2

  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {steps.map((step, i) => {
        const isActive   = i === activeIndex
        const isComplete = i < activeIndex

        return (
          <React.Fragment key={step.label}>
            {/* Step circle */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center
                  font-mono text-xs font-bold
                  transition-all duration-300
                  ${isComplete ? 'bg-acid-500/20 border border-acid-500/50 text-acid-400'
                   : isActive  ? 'bg-acid-500 text-black shadow-[0_0_12px_rgba(163,230,53,0.4)]'
                   :             'bg-surface-700 border border-zinc-800 text-zinc-600'}
                `}
              >
                {isComplete ? '✓' : i + 1}
              </div>
              <span
                className={`font-mono text-xs ${
                  isActive ? 'text-zinc-300' : 'text-zinc-600'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line between steps */}
            {i < steps.length - 1 && (
              <div
                className={`
                  w-16 h-px mx-2 mb-5 transition-all duration-500
                  ${i < activeIndex ? 'bg-acid-500/40' : 'bg-zinc-800'}
                `}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

const QUANTIZATION_OPTIONS = [
  { value: 'none', label: 'Sin cuantizar',  description: 'Tiempos originales de Basic Pitch' },
  { value: '1/4',  label: '1/4 — Negras',   description: 'Grilla de negras (menos preciso)' },
  { value: '1/8',  label: '1/8 — Corcheas', description: 'Grilla de corcheas' },
  { value: '1/16', label: '1/16 — Semicorcheas', description: 'Grilla de semicorcheas (recomendado)' },
]

/**
 * Styled dropdown for selecting MIDI quantization resolution.
 */
function QuantizationSelect({ value, onChange, disabled }) {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
        Cuantización MIDI
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`
            w-full appearance-none font-mono text-sm rounded-lg px-4 py-2.5 pr-10
            border border-zinc-800 bg-zinc-900/80
            transition-colors duration-150
            focus:outline-none focus:border-acid-500/50 focus:ring-1 focus:ring-acid-500/20
            ${disabled
              ? 'text-zinc-600 cursor-not-allowed opacity-60'
              : 'text-zinc-200 cursor-pointer hover:border-zinc-700'}
          `}
        >
          {QUANTIZATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.description}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
      </div>
    </div>
  )
}

/**
 * Fixed-position success toast with BPM and auto-dismiss.
 */
function SuccessToast({ bpm, onDismiss }) {
  return (
    <div className="
      fixed bottom-6 right-6 z-50
      animate-slide-up
      flex items-center gap-3
      rounded-xl border border-acid-500/40 bg-zinc-900/95 backdrop-blur-sm
      px-4 py-3 shadow-[0_0_30px_rgba(163,230,53,0.15)]
      max-w-xs
    ">
      <CheckCircle2 className="w-5 h-5 text-acid-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm font-semibold text-acid-400">¡Extracción completa!</p>
        <p className="font-mono text-xs text-zinc-400">
          BPM detectado: <span className="text-acid-300 font-bold">{bpm}</span>
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

/**
 * Error banner with a dismiss/retry action.
 */
function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="animate-slide-up flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm font-semibold text-red-400 mb-0.5">
          Pipeline failed
        </p>
        <p className="font-mono text-xs text-red-400/70 break-words">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="
          shrink-0 font-mono text-xs text-red-500/70 hover:text-red-300
          border border-red-500/30 hover:border-red-400/50
          rounded px-2.5 py-1.5
          transition-colors duration-150
        "
      >
        Try again
      </button>
    </div>
  )
}