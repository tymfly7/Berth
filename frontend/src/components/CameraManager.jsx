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

export default function CameraManager({ onCamerasChange }) {
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

  return (
    <div style={s.card}>
      <div style={s.title}>Camera Registry</div>

      {cameras.length === 0 ? (
        <div style={s.empty}>No cameras registered.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Name</th>
              <th style={s.th}>Type</th>
              <th style={s.th}>Source</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map(cam => (
              <tr key={cam.id}>
                <td style={s.td}>{cam.name}</td>
                <td style={s.td}>{cam.type}</td>
                <td style={{ ...s.td, fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cam.source}
                </td>
                <td style={s.td}>
                  <span style={s.badge(cam.active)}>{cam.active ? 'Active' : 'Idle'}</span>
                </td>
                <td style={s.td}>
                  <button style={s.btn()} onClick={() => handleToggle(cam)}>
                    {cam.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button style={s.btn('danger')} onClick={() => handleDelete(cam.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <span style={s.addToggle} onClick={() => { setShowForm(v => !v); setError(null) }}>
        {showForm ? '▲ Hide' : '＋ Add Camera'}
      </span>

      {showForm && (
        <div style={s.form}>
          <div>
            <label style={s.label}>Name *</label>
            <input style={s.input} value={form.name} onChange={setField('name')} placeholder="Lot A — Entrance" />
          </div>
          <div>
            <label style={s.label}>Source *</label>
            <input style={s.input} value={form.source} onChange={setField('source')} placeholder="0 for USB, rtsp://... or file path" />
          </div>
          <div>
            <label style={s.label}>Type</label>
            <select style={s.select} value={form.type} onChange={setField('type')}>
              <option value="usb">USB</option>
              <option value="rtsp">RTSP</option>
              <option value="file">File</option>
            </select>
          </div>
          <div>
            <label style={s.label}>ROI Config ID (optional)</label>
            <input style={s.input} value={form.roi_camera_id} onChange={setField('roi_camera_id')} placeholder="Defaults to camera id" />
          </div>
          <div style={s.formActions}>
            <button style={s.btn('primary')} onClick={handleAdd}>Add</button>
            <button style={s.btn()} onClick={() => { setShowForm(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={s.error}>{error}</div>}
    </div>
  )
}
