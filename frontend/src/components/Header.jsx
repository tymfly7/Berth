import { useState, useEffect } from 'react'

const style = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 0',
    borderBottom: '1px solid var(--border-color)',
    marginBottom: '4px',
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 'var(--radius-md)',
    background: 'var(--gradient-accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.4rem',
    boxShadow: '0 2px 12px rgba(99,102,241,0.3)',
  },
  title: {
    fontSize: '1.35rem',
    fontWeight: 800,
    background: 'var(--gradient-accent)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontWeight: 400,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  time: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    fontFamily: 'monospace',
  },
}

export default function Header({ connected, model }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <header style={style.header}>
      <div style={style.logoArea}>
        <div style={style.icon}>🅿️</div>
        <div>
          <div style={style.title}>Smart Parking AI</div>
          <div style={style.subtitle}>Intelligent Parking Detection System</div>
        </div>
      </div>
      <div style={style.right}>
        <span style={style.time}>
          {time.toLocaleTimeString()}
        </span>
        <span className={`badge ${model === 'demo' ? 'badge-warning' : 'badge-info'}`}>
          {model.toUpperCase()}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`pulse-dot ${connected ? 'connected' : 'disconnected'}`}
               style={{ color: connected ? 'var(--color-vacant)' : 'var(--color-occupied)' }} />
          <span className="text-xs text-muted">
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  )
}
