import { useState, useEffect } from 'react'
import { apiFetch } from '../api'

export default function AnomalyPanel({ apiBase }) {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState(null)
  const [parkThresh, setParkThresh] = useState(0.6)

  useEffect(() => {
    apiFetch(`${apiBase}/api/settings/anomaly`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setEnabled(d.enabled)
          if (typeof d.park_thresh === 'number') setParkThresh(d.park_thresh)
        }
      })
      .catch(() => {})
  }, [apiBase])

  // Post the given settings to the backend; returns the parsed response (or null).
  const postSettings = async (body, okMsg) => {
    setLoading(true)
    setMsg(null)
    try {
      const res = await apiFetch(`${apiBase}/api/settings/anomaly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setMsg(data.detail || 'Failed to update anomaly detection')
        return null
      }
      setEnabled(data.enabled)
      if (typeof data.park_thresh === 'number') setParkThresh(data.park_thresh)
      setMsg(okMsg(data))
      return data
    } catch {
      setMsg('Request failed')
      return null
    } finally {
      setLoading(false)
      setTimeout(() => setMsg(null), 5000)
    }
  }

  const toggle = () =>
    postSettings(
      { enabled: !enabled, park_thresh: parkThresh },
      d => d.enabled
        ? 'Enabled — orange boxes highlight misparked vehicles'
        : 'Disabled',
    )

  // Send the slider value once the user finishes dragging (not on every tick).
  const commitSensitivity = () =>
    postSettings(
      { enabled, park_thresh: parkThresh },
      d => `Sensitivity set to ${d.park_thresh.toFixed(2)}`,
    )

  const isError = msg && !msg.startsWith('Enabled') && !msg.startsWith('Disabled')
    && !msg.startsWith('Sensitivity')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Misparked Vehicle Detection
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
            Flags misparked vehicles on live feeds. Requires the YOLO26 Detect model.
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

      {enabled && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Sensitivity
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
              {parkThresh.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.3}
            max={0.9}
            step={0.05}
            value={parkThresh}
            disabled={loading}
            onChange={e => setParkThresh(parseFloat(e.target.value))}
            onMouseUp={commitSensitivity}
            onTouchEnd={commitSensitivity}
            onKeyUp={commitSensitivity}
            style={{ width: '100%', marginTop: 4, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
            <span>lenient — fewer flags</span>
            <span>strict — more flags</span>
          </div>
        </div>
      )}

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
