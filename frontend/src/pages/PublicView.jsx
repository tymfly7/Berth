import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import MetricCards from '../components/MetricCards'

const API_BASE = `http://${window.location.hostname}:8000`

export default function PublicView() {
  const [metrics, setMetrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/public/metrics`)
        if (res.ok) setMetrics(await res.json())
      } catch { /* silent */ }
    }

    fetchMetrics()
    const pollInterval = setInterval(fetchMetrics, 8000)
    const clockInterval = setInterval(() => setTime(new Date()), 1000)

    return () => {
      clearInterval(pollInterval)
      clearInterval(clockInterval)
    }
  }, [])

  const availableColor =
    metrics.available === 0
      ? 'var(--color-occupied)'
      : metrics.occupancy_percent > 85
      ? 'var(--color-warning)'
      : 'var(--color-vacant)'

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      position: 'relative',
    }}>
      {/* Heading + clock */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{
          fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
          fontWeight: 800,
          background: 'var(--gradient-accent)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: 8,
        }}>
          Parking Availability
        </h1>
        <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '1rem' }}>
          {time.toLocaleTimeString()}
        </div>
      </div>


      {/* Available spots — large number */}
      <div style={{
        textAlign: 'center',
        margin: '32px 0',
      }}>
        <div style={{
          fontSize: 'clamp(5rem, 18vw, 10rem)',
          fontWeight: 900,
          lineHeight: 1,
          color: availableColor,
          textShadow: `0 0 60px ${availableColor}55`,
          letterSpacing: '-4px',
        }}>
          {metrics.available}
        </div>
        <div style={{
          fontSize: '1rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          letterSpacing: '2px',
          textTransform: 'uppercase',
          marginTop: 8,
        }}>
          spots available
        </div>
      </div>

      {/* Metric cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        width: '100%',
        maxWidth: 800,
        marginBottom: 32,
      }}>
        <MetricCards metrics={metrics} />
      </div>

      {/* Admin link — bottom-right corner */}
      <Link
        to="/admin"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 24,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textDecoration: 'none',
          padding: '4px 10px',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Admin
      </Link>
    </div>
  )
}
