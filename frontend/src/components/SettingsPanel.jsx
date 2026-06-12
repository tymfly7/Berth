import { useState, useEffect, useCallback } from 'react'
import ControlPanel from './ControlPanel'
import TrainingPanel from './TrainingPanel'
import ModelStatus from './ModelStatus'
import CameraManager from './CameraManager'
import AnomalyPanel from './AnomalyPanel'
import OccupancyPanel from './OccupancyPanel'
import { apiFetch } from '../api'


const toggleBtnStyle = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-color)',
  padding: '12px 16px',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--text-primary)',
  fontSize: '0.78rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const dividerStyle = {
  height: 1,
  background: 'var(--border-color)',
  margin: '0',
}

function TrainingDataBrowser({ apiBase }) {
  const [folders, setFolders] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${apiBase}/api/dataset/browse`)
      if (!res.ok) throw new Error(res.statusText)
      const data = await res.json()
      setFolders(data.folders)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { refresh() }, [refresh])

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '5px 0', fontSize: '0.8rem', borderBottom: '1px solid var(--border-color)',
  }

  return (
    <div>
      {loading && !folders && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Loading…</div>
      )}
      {error && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-occupied)' }}>✗ {error}</div>
      )}
      {folders && folders.map(f => (
        <div key={f.name} style={rowStyle}>
          <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {f.name}
          </span>
          {f.exists ? (
            <span style={{ fontWeight: 600 }}>
              {f.count ?? 0} img{f.count !== 1 ? 's' : ''}
              {f.splits && (
                <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.72rem', marginLeft: 6 }}>
                  ({Object.entries(f.splits).map(([k, v]) => `${k}:${v ?? 0}`).join(' ')})
                </span>
              )}
            </span>
          ) : (
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>not found</span>
          )}
        </div>
      ))}
      <button
        className="btn btn-ghost btn-sm"
        onClick={refresh}
        disabled={loading}
        style={{ marginTop: 10, fontSize: '0.75rem' }}
      >
        {loading ? 'Refreshing…' : '↻ Refresh'}
      </button>
    </div>
  )
}

function SubSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '14px 16px' }}>{children}</div>}
    </div>
  )
}

export default function SettingsPanel({ apiAction, apiBase, modelInfo, fetchModelInfo, onCamerasChange }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="glass-card" style={{ overflow: 'hidden' }}>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>Settings</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <SubSection title="Camera Registry" defaultOpen={false}>
            <CameraManager compact onCamerasChange={onCamerasChange} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Controls">
            <ControlPanel apiAction={apiAction} apiBase={apiBase} modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} />
            <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />
            <AnomalyPanel apiBase={apiBase} />
            <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />
            <OccupancyPanel apiBase={apiBase} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Training Data" defaultOpen={false}>
            <TrainingDataBrowser apiBase={apiBase} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Model Training" defaultOpen={false}>
            <TrainingPanel
              apiAction={apiAction}
              apiBase={apiBase}
              modelInfo={modelInfo}
              fetchModelInfo={fetchModelInfo}
            />
            <ModelStatus modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} apiBase={apiBase} />
          </SubSection>

        </>
      )}
    </div>
  )
}
