import { useState, useEffect } from 'react'

const API_BASE = `http://${window.location.hostname}:8000`

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
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.82rem',
  },
  th: {
    textAlign: 'left',
    padding: '6px 10px',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  td: {
    padding: '8px 10px',
    borderBottom: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    verticalAlign: 'middle',
  },
  badge: (active) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 99,
    fontSize: '0.72rem',
    fontWeight: 600,
    background: active ? 'var(--color-vacant-glow)' : 'rgba(255,255,255,0.05)',
    color: active ? 'var(--color-vacant)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--color-vacant)' : 'transparent'}`,
  }),
  btn: (variant = 'default') => ({
    padding: '4px 12px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.78rem',
    fontWeight: 600,
    marginRight: 6,
    background:
      variant === 'danger'  ? 'rgba(244,63,94,0.15)' :
      variant === 'primary' ? 'var(--accent-primary)' :
      'rgba(255,255,255,0.07)',
    color:
      variant === 'danger'  ? 'var(--color-occupied)' :
      variant === 'primary' ? '#fff' :
      'var(--text-primary)',
    transition: 'opacity 0.15s',
  }),
  addToggle: {
    marginTop: 16,
    fontSize: '0.8rem',
    color: 'var(--accent-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  form: {
    marginTop: 14,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    padding: '14px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
  },
  label: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    marginBottom: 4,
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.82rem',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.82rem',
    boxSizing: 'border-box',
  },
  formActions: {
    gridColumn: '1 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  error: {
    color: 'var(--color-occupied)',
    fontSize: '0.78rem',
    marginTop: 10,
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    padding: '12px 0',
    textAlign: 'center',
  },
}

export default function CameraManager({ onCamerasChange, compact = false }) {
  const [cameras, setCameras] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ name: '', source: '', type: 'usb', roi_camera_id: '' })

  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cameras`)
      if (res.ok) {
        const data = await res.json()
        setCameras(data)
        onCamerasChange?.(data)
      }
    } catch { /* silent */ }
  }

  useEffect(() => { fetchCameras() }, [])

  const handleAdd = async () => {
    setError(null)
    if (!form.name.trim() || !form.source.trim()) {
      setError('Name and Source are required.')
      return
    }
    try {
      const res = await fetch(`${API_BASE}/api/cameras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          source: form.source.trim(),
          type: form.type,
          roi_camera_id: form.roi_camera_id.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail || 'Failed to add camera.')
        return
      }
      setForm({ name: '', source: '', type: 'usb', roi_camera_id: '' })
      setShowForm(false)
      await fetchCameras()
    } catch (e) {
      setError('Network error.')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this camera?')) return
    try {
      await fetch(`${API_BASE}/api/cameras/${id}`, { method: 'DELETE' })
      await fetchCameras()
    } catch { /* silent */ }
  }

  const handleToggle = async (cam) => {
    const endpoint = cam.active ? 'deactivate' : 'activate'
    try {
      const res = await fetch(`${API_BASE}/api/cameras/${cam.id}/${endpoint}`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail || `Failed to ${endpoint}.`)
        return
      }
      await fetchCameras()
    } catch { /* silent */ }
  }

  const setField = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  const cFont = compact ? '0.75rem' : '0.82rem'
  const cPad  = compact ? '4px 8px' : '8px 10px'

  const compactTd = { ...s.td, padding: cPad, fontSize: cFont }
  const compactTh = { ...s.th, padding: cPad, fontSize: '0.68rem' }

  const compactInput  = { ...s.input,  fontSize: cFont, padding: '4px 8px' }
  const compactSelect = { ...s.select, fontSize: cFont, padding: '4px 8px' }
  const compactForm   = {
    ...s.form,
    gridTemplateColumns: compact ? '1fr' : '1fr 1fr',
    gap: compact ? 7 : 10,
    padding: compact ? '10px' : '14px',
  }

  return (
    <div style={compact ? {} : s.card}>
      {!compact && <div style={s.title}>Camera Registry</div>}

      {cameras.length === 0 ? (
        <div style={{ ...s.empty, fontSize: cFont }}>No cameras registered.</div>
      ) : (
        <table style={{ ...s.table, fontSize: cFont }}>
          <thead>
            <tr>
              <th style={compactTh}>Name</th>
              <th style={compactTh}>Type</th>
              {!compact && <th style={compactTh}>Source</th>}
              <th style={compactTh}>Status</th>
              <th style={compactTh}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map(cam => (
              <tr key={cam.id}>
                <td style={compactTd}>{cam.name}</td>
                <td style={compactTd}>{cam.type}</td>
                {!compact && (
                  <td style={{ ...compactTd, fontFamily: 'monospace', fontSize: '0.7rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cam.source}
                  </td>
                )}
                <td style={compactTd}>
                  <span style={{ ...s.badge(cam.active), fontSize: '0.68rem', padding: compact ? '1px 6px' : '2px 8px' }}>
                    {cam.active ? 'Active' : 'Idle'}
                  </span>
                </td>
                <td style={compactTd}>
                  <button style={{ ...s.btn(), fontSize: '0.72rem', padding: compact ? '2px 7px' : '4px 12px', marginRight: 4 }} onClick={() => handleToggle(cam)}>
                    {cam.active ? 'Off' : 'On'}
                  </button>
                  <button style={{ ...s.btn('danger'), fontSize: '0.72rem', padding: compact ? '2px 7px' : '4px 12px' }} onClick={() => handleDelete(cam.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <span style={{ ...s.addToggle, fontSize: cFont, marginTop: compact ? 10 : 16 }} onClick={() => { setShowForm(v => !v); setError(null) }}>
        {showForm ? '▲ Hide' : '＋ Add Camera'}
      </span>

      {showForm && (
        <div style={compactForm}>
          <div>
            <label style={{ ...s.label, fontSize: '0.7rem' }}>Name *</label>
            <input style={compactInput} value={form.name} onChange={setField('name')} placeholder="Lot A — Entrance" />
          </div>
          <div>
            <label style={{ ...s.label, fontSize: '0.7rem' }}>Type</label>
            <select style={compactSelect} value={form.type} onChange={setField('type')}>
              <option value="usb">USB</option>
              <option value="rtsp">RTSP</option>
              <option value="file">File</option>
              <option value="youtube">YouTube Live</option>
            </select>
          </div>
          <div style={{ gridColumn: compact ? 'auto' : 'span 2' }}>
            <label style={{ ...s.label, fontSize: '0.7rem' }}>Source *</label>
            <input style={compactInput} value={form.source} onChange={setField('source')} placeholder="0 · rtsp://… · /path · youtube URL" />
          </div>
          <div style={{ gridColumn: compact ? 'auto' : 'span 2' }}>
            <label style={{ ...s.label, fontSize: '0.7rem' }}>ROI Config ID (optional)</label>
            <input style={compactInput} value={form.roi_camera_id} onChange={setField('roi_camera_id')} placeholder="Defaults to camera id" />
          </div>
          <div style={{ ...s.formActions, gridColumn: compact ? 'auto' : '1 / -1' }}>
            <button style={{ ...s.btn('primary'), fontSize: '0.75rem' }} onClick={handleAdd}>Add</button>
            <button style={{ ...s.btn(), fontSize: '0.75rem' }} onClick={() => { setShowForm(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ ...s.error, fontSize: '0.73rem' }}>{error}</div>}
    </div>
  )
}
