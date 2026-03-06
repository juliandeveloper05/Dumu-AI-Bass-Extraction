// frontend/src/components/HealthBadge.jsx
/**
 * Server health indicator badge.
 * Polls GET /api/health every 30s, shows colored status dot.
 */
import React, { useState, useEffect, useRef } from 'react'
import { Activity } from 'lucide-react'
import { API_ORIGIN, HEALTH_POLL_INTERVAL_MS } from '../utils/constants'

export default React.memo(function HealthBadge() {
  const [status, setStatus] = useState('unknown') // unknown | healthy | warning | error
  const [memPercent, setMemPercent] = useState(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API_ORIGIN}/api/health`, {
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) {
          setStatus('error')
          return
        }
        const data = await res.json()
        const mem = data.memory?.system?.percent ?? data.memory_percent
        setMemPercent(mem)
        if (mem > 85) {
          setStatus('warning')
        } else {
          setStatus('healthy')
        }
      } catch {
        setStatus('error')
      }
    }

    checkHealth()
    intervalRef.current = setInterval(checkHealth, HEALTH_POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  const colors = {
    unknown: 'bg-[var(--text-muted)]',
    healthy: 'bg-[var(--accent-lime)]',
    warning: 'bg-[var(--accent-magenta)]',
    error: 'bg-red-500',
  }

  const labels = {
    unknown: 'Checking...',
    healthy: 'Server OK',
    warning: 'High Memory',
    error: 'Offline',
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg
      bg-[rgba(255,255,255,0.03)] border border-[var(--glass-border)]"
      title={memPercent !== null ? `Memory: ${memPercent}%` : labels[status]}
    >
      <div className={`w-2 h-2 rounded-full ${colors[status]} ${status === 'healthy' ? 'animate-pulse' : ''}`} />
      <Activity className="w-3.5 h-3.5 text-[var(--text-muted)]" />
      <span className="text-xs text-[var(--text-muted)] font-mono">
        {labels[status]}
      </span>
    </div>
  )
})
