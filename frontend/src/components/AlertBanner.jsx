import { useState, useEffect } from 'react'

const style = {
  banner: {
    padding: '12px 20px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: '16px',
    fontSize: '0.85rem',
    fontWeight: 500,
    transition: 'all var(--transition-base)',
    animation: 'fadeIn 0.3s ease-out',
  },
  icon: { fontSize: '1.2rem' },
}

const LEVELS = {
  ok: {
    bg: 'rgba(16,185,129,0.1)',
    border: 'rgba(16,185,129,0.3)',
    color: 'var(--color-vacant)',
    icon: '✅',
    message: 'Parking lot has available spaces',
  },
  info: {
    bg: 'rgba(59,130,246,0.1)',
    border: 'rgba(59,130,246,0.3)',
    color: 'var(--color-info)',
    icon: 'ℹ️',
    message: 'Parking lot is getting busy',
  },
  warning: {
    bg: 'rgba(245,158,11,0.1)',
    border: 'rgba(245,158,11,0.3)',
    color: 'var(--color-warning)',
    icon: '⚠️',
    message: 'Parking lot is almost full',
  },
  critical: {
    bg: 'rgba(239,68,68,0.1)',
    border: 'rgba(239,68,68,0.3)',
    color: 'var(--color-critical)',
    icon: '🚨',
    message: 'Parking lot is nearly full!',
  },
}

export default function AlertBanner({ occupancy }) {
  const [visible, setVisible] = useState(false)

  let level = 'ok'
  if (occupancy >= 95) level = 'critical'
  else if (occupancy >= 85) level = 'warning'
  else if (occupancy >= 70) level = 'info'

  useEffect(() => {
    setVisible(occupancy > 0)
  }, [occupancy])

  if (!visible) return null

  const config = LEVELS[level]

  return (
    <div
      style={{
        ...style.banner,
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.color,
      }}
    >
      <span style={style.icon}>{config.icon}</span>
      <span>{config.message} — <strong>{occupancy}% occupied</strong></span>
    </div>
  )
}
