import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

// Live control for the YOLO classify occupancy decision threshold. Lower values
// call more spots "occupied" (fewer false negatives — taken spots shown as free).
export default function OccupancyPanel({ apiBase }) {
  const [thresh, setThresh]   = useState(0.4)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)

  useEffect(() => {
    apiFetch(`${apiBase}/api/settings/occupancy`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && typeof d.threshold === 'number') setThresh(d.threshold) })
      .catch(() => {})
  }, [apiBase])

  // Send the slider value once the user finishes dragging (not on every tick).
  const commit = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await apiFetch(`${apiBase}/api/settings/occupancy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: thresh }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.detail || 'Failed to update threshold')
        return
      }
      if (typeof data.threshold === 'number') setThresh(data.threshold)
      setMsg(`Threshold set to ${data.threshold.toFixed(2)}`)
    } catch {
      setMsg('Request failed')
    } finally {
      setLoading(false)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  const isError = msg && !msg.startsWith('Threshold')

  return (
    <div>
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Occupancy Sensitivity
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
          Lower flags more spots as occupied (fewer taken spots missed); higher is stricter.
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Threshold
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
            {thresh.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min={0.15}
          max={0.6}
          step={0.05}
          value={thresh}
          disabled={loading}
          onChange={e => setThresh(parseFloat(e.target.value))}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          style={{ width: '100%', marginTop: 4, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
          <span>more occupied</span>
          <span>stricter</span>
        </div>
      </div>

      {msg && (
        <div style={{
          marginTop: 8,
          fontSize: '0.75rem',
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          background: isError ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
          color: isError ? 'var(--color-occupied)' : 'var(--color-vacant)',
          wordBreak: 'break-word',
        }}>
          {msg}
        </div>
      )}
    </div>
  )
}
