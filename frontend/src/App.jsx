// frontend/src/App.jsx
/**
 * DUMU v2.0.0 — Root application shell.
 *
 * Architecture:
 *   Layer 0 (z-index: 0)  — R3F Canvas: particles, logo, fog
 *   Layer 1 (z-index: 10) — HTML overlay: glassmorphism 2D UI
 *
 * The 3D scene runs as a fixed background canvas. All interactive UI
 * is rendered as standard HTML on top, using glassmorphism panels.
 *
 * Mobile fallback: if WebGL is unavailable, the 3D scene is skipped
 * and a CSS gradient background is used instead.
 */
import React, { Suspense, useState, useEffect, lazy } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import useAppStore from './stores/appStore'
import { useProcessingState } from './hooks/useProcessingState'

// Components
import UploadZone from './components/UploadZone'
import ProgressConsole from './components/ProgressConsole'
import ParameterPanel from './components/ParameterPanel'
import StemSelector from './components/StemSelector'
import TransportControls from './components/TransportControls'
import MidiPlayer from './components/MidiPlayer'
import ResultPanel from './components/ResultPanel'
import HealthBadge from './components/HealthBadge'

// Lazy-load 3D scene (tree-shaken if WebGL unavailable)
const Scene = lazy(() => import('./scene/Scene'))

/**
 * Detect WebGL support.
 */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    )
  } catch {
    return false
  }
}

export default function App() {
  const [webglAvailable] = useState(() => hasWebGL())
  const { isIdle, isProcessing, isComplete, isError, canUpload } = useProcessingState()
  const error = useAppStore((s) => s.error)

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Layer 0: 3D Background */}
      {webglAvailable ? (
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      ) : (
        // CSS gradient fallback
        <div
          className="fixed inset-0 z-0"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, #0A0A2E 0%, #050510 70%)',
          }}
        />
      )}

      {/* Layer 1: HTML Overlay */}
      <div className="html-overlay">
        <div className="app-layout">

          {/* ── Header ──────────────────────────────────────────── */}
          <header className="flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <h1 className="logo-title text-2xl">DUMU</h1>
              <span className="text-xs text-[var(--text-muted)] font-mono mt-1">v2.0</span>
            </div>

            <div className="flex items-center gap-2">
              <HealthBadge />
            </div>
          </header>

          {/* ── Main Content ────────────────────────────────────── */}
          <div className="main-content">
            {/* Left Column: Main workflow */}
            <div className="main-left">
              {/* Upload section */}
              <AnimatePresence mode="wait">
                {canUpload && (
                  <motion.div
                    key="upload"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    <UploadZone />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Processing console */}
              <ProgressConsole />

              {/* Error display */}
              <AnimatePresence>
                {isError && error && (
                  <motion.div
                    className="glass-panel p-4 border-l-4 border-[var(--accent-magenta)]"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                  >
                    <p className="text-sm text-[var(--accent-magenta)] font-medium">Error</p>
                    <p className="text-sm text-[var(--text-muted)] mt-1">{error}</p>
                    <button
                      onClick={() => useAppStore.getState().reset()}
                      className="text-xs text-[var(--accent-cyan)] mt-2 hover:underline"
                    >
                      Try again
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results */}
              <AnimatePresence>
                {isComplete && (
                  <motion.div
                    key="results"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.5 }}
                    className="space-y-3"
                  >
                    <ResultPanel />
                    <MidiPlayer />
                    <TransportControls />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right Column: Controls */}
            <div className="main-right">
              <div className="flex flex-col gap-3">
                {/* Parameter and Stem controls as floating panels */}
                <div className="space-y-3">
                  <ParameterPanel />
                  <StemSelector />
                </div>
              </div>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────────── */}
          <footer className="flex items-center justify-center py-2 flex-shrink-0">
            <p className="text-xs text-[var(--text-muted)] font-mono">
              DUMU — AI Bass Extraction v2.0.0
            </p>
          </footer>

        </div>
      </div>
    </div>
  )
}