import { useState, useCallback } from 'react'
import CameraFeedCell from './CameraFeedCell'

const s = {
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '20px',
  },
  title: {
    fontSize: '0.8rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: 'var(--text-secondary)',
    marginBottom: 14,
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    textAlign: 'center',
    padding: '24px 0',
  },
  totalsRow: {
    display: 'flex',
    gap: 16,
    marginTop: 14,
    padding: '10px 14px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    alignItems: 'center',
  },
  totalsLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 'auto',
  },
  totalStat: (color) => ({
    fontSize: '0.82rem',
    fontWeight: 700,
    color,
  }),
}

function gridColumns(count) {
  if (count <= 1) return '1fr'
  if (count <= 2) return '1fr 1fr'
  return '1fr 1fr 1fr'
}

export default function MultiCameraGrid({ cameras }) {
  const [metricsMap, setMetricsMap] = useState({})

  const handleMetricsUpdate = useCallback((cameraId, metrics) => {
    setMetricsMap(prev => ({ ...prev, [cameraId]: metrics }))
  }, [])

  const active = cameras.filter(c => c.active)

  const totalAvailable = Object.values(metricsMap).reduce((sum, m) => sum + (m.available || 0), 0)
  const totalOccupied  = Object.values(metricsMap).reduce((sum, m) => sum + (m.occupied  || 0), 0)
  const totalSlots     = totalAvailable + totalOccupied

  if (active.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.title}>Live Camera Feeds</div>
        <div style={s.empty}>No active cameras. Activate one above.</div>
      </div>
    )
  }

  return (
    <div style={s.card}>
      <div style={s.title}>Live Camera Feeds</div>

      <div style={{ display: 'grid', gridTemplateColumns: gridColumns(active.length), gap: 12 }}>
        {active.map(cam => (
          <CameraFeedCell
            key={cam.id}
            cameraId={cam.id}
            name={cam.name}
            onMetricsUpdate={handleMetricsUpdate}
          />
        ))}
      </div>

      <div style={s.totalsRow}>
        <span style={s.totalsLabel}>Unified Totals</span>
        <span style={s.totalStat('var(--text-secondary)')}>{totalSlots} slots</span>
        <span style={s.totalStat('var(--color-vacant)')}>■ {totalAvailable} avail</span>
        <span style={s.totalStat('var(--color-occupied)')}>■ {totalOccupied} occ</span>
      </div>
    </div>
  )
}
