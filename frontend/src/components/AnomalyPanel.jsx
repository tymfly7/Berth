import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

export default function AnomalyPanel({ apiBase }) {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)

  useEffect(() => {
    apiFetch(`${apiBase}/api/settings/anomaly`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setEnabled(d.enabled) })
      .catch(() => {})
  }, [apiBase])

  const toggle = async () => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await apiFetch(`${apiBase}/api/settings/anomaly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.detail || 'Failed to toggle anomaly detection')
      } else {
        setEnabled(data.enabled)
        setMsg(data.enabled
          ? 'Enabled — orange boxes highlight misparked vehicles'
          : 'Disabled')
      }
    } catch {
      setMsg('Request failed')
    } finally {
      setLoading(false)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  const isError = msg && !msg.startsWith('Enabled') && !msg.startsWith('Disabled')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Wrong Parking Detection
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            Flags vehicles outside ROI markings on live feed. Requires YOLO26 detect model.
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={loading}
          className={`btn btn-sm ${enabled ? 'btn-primary' : 'btn-ghost'}`}
          style={{ minWidth: 56, flexShrink: 0 }}
        >
          {loading ? '…' : (enabled ? 'ON' : 'OFF')}
        </button>
      </div>
      {msg && (
        <div style={{
          marginTop: 8,
          fontSize: '0.75rem',
          padding: '6px 10px',
          borderRadius: 'var(--radius-sm)',
          background: isError
            ? 'rgba(244,63,94,0.1)'
            : enabled
              ? 'rgba(16,185,129,0.1)'
              : 'rgba(99,102,241,0.1)',
          color: isError
            ? 'var(--color-occupied)'
            : enabled
              ? 'var(--color-vacant)'
              : 'var(--accent-primary)',
          wordBreak: 'break-word',
        }}>
          {msg}
        </div>
      )}
    </div>
  )
}
