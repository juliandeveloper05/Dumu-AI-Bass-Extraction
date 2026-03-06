// frontend/src/components/ProgressConsole.jsx
/**
 * Terminal-style progress console with timestamped log entries
 * and animated progress bar with scan-line effect.
 */
import React, { useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'
import { motion } from 'framer-motion'
import useAppStore from '../stores/appStore'

export default React.memo(function ProgressConsole() {
  const logs = useAppStore((s) => s.logs)
  const progress = useAppStore((s) => s.progress)
  const stage = useAppStore((s) => s.stage)
  const substage = useAppStore((s) => s.substage)
  const scrollRef = useRef(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const isActive = stage === 'processing' || stage === 'uploading'
  const progressPct = Math.round(progress * 100)

  if (logs.length === 0 && !isActive) return null

  return (
    <motion.div
      className="glass-panel p-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Terminal className="w-4 h-4 text-[var(--accent-cyan)]" />
        <span className="text-sm font-medium text-[var(--text-primary)] font-heading">
          Processing Console
        </span>
        {substage && (
          <span className="text-xs text-[var(--text-muted)] font-mono ml-auto">
            {substage.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="max-h-40 overflow-y-auto mb-3 space-y-1 scrollbar-thin"
      >
        {logs.map((log, i) => {
          const time = new Date(log.time)
          const timestamp = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`

          return (
            <div key={i} className="flex gap-2 text-xs font-mono">
              <span className="text-[var(--text-muted)] flex-shrink-0">[{timestamp}]</span>
              <span className={`${_getLogColor(log.message)}`}>{log.message}</span>
            </div>
          )
        })}

        {/* Blinking cursor */}
        {isActive && (
          <div className="flex gap-2 text-xs font-mono">
            <span className="text-[var(--text-muted)] flex-shrink-0">&gt;</span>
            <span className="text-[var(--accent-cyan)] animate-blink">_</span>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="relative h-3 bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full progress-bar-glow"
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{
              background: `linear-gradient(90deg, var(--accent-cyan), var(--accent-magenta))`,
            }}
          />
          {/* Scan-line effect */}
          <div className="absolute inset-0 scan-line-effect" />

          {/* Percentage */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-white mix-blend-difference">
              {progressPct}%
            </span>
          </div>
        </div>
      )}
    </motion.div>
  )
})

function _getLogColor(message) {
  if (message.includes('Error') || message.includes('❌') || message.includes('failed')) {
    return 'text-[var(--accent-magenta)]'
  }
  if (message.includes('complete') || message.includes('✅') || message.includes('Done')) {
    return 'text-[var(--accent-lime)]'
  }
  return 'text-[var(--text-primary)]'
}
