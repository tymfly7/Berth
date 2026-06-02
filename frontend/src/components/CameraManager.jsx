import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { createPortal } from 'react-dom'
import RoiEditor from './RoiEditor'

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

  const [editingCamId, setEditingCamId] = useState(null)
  const [editCamForm, setEditCamForm] = useState({ name: '', source: '', type: 'usb', roi_camera_id: '' })
  const [editCamError, setEditCamError] = useState(null)

  const startCamEdit = (cam) => {
    setEditingCamId(cam.id)
    setEditCamForm({
      name: cam.name,
      source: cam.source,
      type: cam.type,
      roi_camera_id: cam.roi_camera_id === cam.id ? '' : (cam.roi_camera_id || ''),
    })
    setEditCamError(null)
  }

  const cancelCamEdit = () => { setEditingCamId(null); setEditCamError(null) }

  const handleCamUpdate = async () => {
    setEditCamError(null)
    if (!editCamForm.name.trim() || !editCamForm.source.trim()) {
      setEditCamError('Name and Source are required.')
      return
    }
    try {
      const res = await apiFetch(`${API_BASE}/api/cameras/${editingCamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editCamForm.name.trim(),
          source: editCamForm.source.trim(),
          type: editCamForm.type,
          roi_camera_id: editCamForm.roi_camera_id.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setEditCamError(d.detail || 'Failed to update camera.')
        return
      }
      setEditingCamId(null)
      await fetchCameras()
    } catch { setEditCamError('Network error.') }
  }

  const setEditCamField = (field) => (e) => setEditCamForm(prev => ({ ...prev, [field]: e.target.value }))

  const [roiEditCam, setRoiEditCam] = useState(null)
  const [editRois, setEditRois] = useState([])
  const [editBg, setEditBg] = useState(null)
  const [roiMsg, setRoiMsg] = useState(null)
  const [proposing, setProposing] = useState(false)
  const [editProposals, setEditProposals] = useState([])
  const editWsRef = useRef(null)

  const fetchCameras = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/cameras`)
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
      const res = await apiFetch(`${API_BASE}/api/cameras`, {
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
      await apiFetch(`${API_BASE}/api/cameras/${id}`, { method: 'DELETE' })
      await fetchCameras()
    } catch { /* silent */ }
  }

  const handleToggle = async (cam) => {
    const endpoint = cam.active ? 'deactivate' : 'activate'
    try {
      const res = await apiFetch(`${API_BASE}/api/cameras/${cam.id}/${endpoint}`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json()
        setError(d.detail || `Failed to ${endpoint}.`)
        return
      }
      await fetchCameras()
    } catch { /* silent */ }
  }

  const setField = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  const showRoiMsg = (msg) => { setRoiMsg(msg); setTimeout(() => setRoiMsg(null), 4000) }

  const openRoiEdit = async (cam) => {
    const cameraId = cam.roi_camera_id || cam.id

    const blobToDataUrl = (blob) => new Promise(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve(e.target.result)
      reader.readAsDataURL(blob)
    })

    // Fetch ROIs and snapshot in parallel
    const [rois, bg] = await Promise.all([
      apiFetch(`${API_BASE}/api/roi/${cameraId}`)
        .then(res => res.ok ? res.json() : [])
        .then(data => Array.isArray(data) ? data : [])
        .catch(() => []),
      apiFetch(`${API_BASE}/api/roi/${cameraId}/snapshot`)
        .then(res => res.ok ? res.blob() : null)
        .then(blob => blob ? blobToDataUrl(blob) : null)
        .catch(() => null),
    ])

    setEditRois(rois)
    setEditBg(bg)
    setEditProposals([])
    setRoiEditCam(cam)

    // WebSocket fallback only if no snapshot — loads in async after editor is open
    if (!bg && cam.active) {
      new Promise(resolve => {
        const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/cameras/${cam.id}`)
        editWsRef.current = ws
        const timeout = setTimeout(() => { ws.close(); resolve(null) }, 5000)
        ws.onmessage = (e) => {
          try {
            const d = JSON.parse(e.data)
            if (d.frame) { clearTimeout(timeout); ws.close(); resolve(`data:image/jpeg;base64,${d.frame}`) }
          } catch { /* ignore */ }
        }
        ws.onerror = () => { clearTimeout(timeout); resolve(null) }
      }).then(wsBg => { if (wsBg) setEditBg(wsBg) })
    }
  }

  const closeRoiEdit = () => {
    editWsRef.current?.close()
    setRoiEditCam(null)
    setEditBg(null)
    setEditRois([])
    setEditProposals([])
    setRoiMsg(null)
  }

  const saveEditRois = async () => {
    if (!roiEditCam) return
    const cameraId = roiEditCam.roi_camera_id || roiEditCam.id
    try {
      const res = await apiFetch(`${API_BASE}/api/roi/${cameraId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rois: editRois }),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      showRoiMsg(`Saved ${data.saved} ROI${data.saved !== 1 ? 's' : ''}`)
    } catch (e) { showRoiMsg(`Error: ${e.message}`) }
  }

  const handleAutoDetect = async () => {
    if (!roiEditCam) return
    const cameraId = roiEditCam.roi_camera_id || roiEditCam.id
    setProposing(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/roi/${cameraId}/propose`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showRoiMsg(`Auto-detect failed: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      if (data.proposals?.length > 0) {
        setEditProposals(data.proposals)
        showRoiMsg(`${data.proposals.length} candidate${data.proposals.length > 1 ? 's' : ''} detected`)
      } else {
        showRoiMsg('No candidates found — try a clearer frame')
      }
    } catch (err) { showRoiMsg(`Error: ${err.message}`) }
    finally { setProposing(false) }
  }

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
    <>
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
                  <button
                    onClick={() => handleToggle(cam)}
                    style={{
                      padding: compact ? '1px 10px' : '3px 14px',
                      borderRadius: 99,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: cam.active ? 'rgba(46,204,113,0.18)' : 'rgba(244,63,94,0.18)',
                      color: cam.active ? '#2ecc71' : '#f43f5e',
                    }}
                  >
                    {cam.active ? 'On' : 'Off'}
                  </button>
                </td>
                <td style={compactTd}>
                  <button
                    style={{ ...s.btn(editingCamId === cam.id ? 'primary' : 'default'), fontSize: '0.72rem', padding: compact ? '2px 7px' : '4px 12px', marginRight: 4 }}
                    onClick={() => editingCamId === cam.id ? cancelCamEdit() : startCamEdit(cam)}
                  >
                    ⚙
                  </button>
                  <button style={{ ...s.btn(), fontSize: '0.72rem', padding: compact ? '2px 7px' : '4px 12px', marginRight: 4 }} onClick={() => openRoiEdit(cam)}>
                    ✎
                  </button>
                  <button style={{ ...s.btn('danger'), fontSize: '0.72rem', padding: compact ? '2px 7px' : '4px 12px' }} onClick={() => handleDelete(cam.id)}>✕</button>
                </td>
              </tr>
            ))}
            {editingCamId && (() => {
              const colSpan = compact ? 4 : 5
              return (
                <tr key={`${editingCamId}-edit`}>
                  <td colSpan={colSpan} style={{ ...compactTd, background: 'rgba(0,0,0,0.25)', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                      <div>
                        <label style={{ ...s.label, fontSize: '0.7rem' }}>Name *</label>
                        <input style={{ ...compactInput }} value={editCamForm.name} onChange={setEditCamField('name')} />
                      </div>
                      <div>
                        <label style={{ ...s.label, fontSize: '0.7rem' }}>Type</label>
                        <select style={{ ...compactSelect }} value={editCamForm.type} onChange={setEditCamField('type')}>
                          <option value="usb">USB</option>
                          <option value="rtsp">RTSP</option>
                          <option value="youtube">YouTube Live</option>
                        </select>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ ...s.label, fontSize: '0.7rem' }}>Source *</label>
                        <input style={{ ...compactInput }} value={editCamForm.source} onChange={setEditCamField('source')} />
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={{ ...s.label, fontSize: '0.7rem' }}>ROI Config ID (optional)</label>
                        <input style={{ ...compactInput }} value={editCamForm.roi_camera_id} onChange={setEditCamField('roi_camera_id')} placeholder="Defaults to camera id" />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button style={{ ...s.btn('primary'), fontSize: '0.75rem' }} onClick={handleCamUpdate}>Save</button>
                      <button style={{ ...s.btn(), fontSize: '0.75rem' }} onClick={cancelCamEdit}>Cancel</button>
                      {editCamError && <span style={{ ...s.error, marginTop: 0, fontSize: '0.73rem' }}>{editCamError}</span>}
                    </div>
                  </td>
                </tr>
              )
            })()}
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
              <option value="youtube">YouTube Live</option>
            </select>
          </div>
          <div style={{ gridColumn: compact ? 'auto' : 'span 2' }}>
            <label style={{ ...s.label, fontSize: '0.7rem' }}>Source *</label>
            <input style={compactInput} value={form.source} onChange={setField('source')} placeholder="0 · rtsp://… · youtube URL" />
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

    {roiEditCam && createPortal(
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.96)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)', flexShrink: 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ROI Editor — {roiEditCam.name}
          </span>
          <button
            style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(100,200,255,0.5)', background: 'rgba(100,200,255,0.08)', color: proposing ? 'rgba(100,200,255,0.4)' : '#64c8ff', fontSize: '0.7rem', fontWeight: 600, cursor: proposing ? 'default' : 'pointer', lineHeight: '1.4' }}
            disabled={proposing}
            onClick={handleAutoDetect}
          >
            {proposing ? 'Detecting…' : 'Auto-detect'}
          </button>
          <button
            style={{ padding: '3px 10px', borderRadius: 4, border: 'none', background: 'var(--accent-primary, #3498db)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', lineHeight: '1.4' }}
            onClick={saveEditRois}
          >
            Save
          </button>
          <button
            style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', lineHeight: '1.4' }}
            onClick={closeRoiEdit}
          >
            Done
          </button>
          {roiMsg && (
            <span style={{ fontSize: '0.75rem', marginLeft: 4, color: roiMsg.startsWith('Error') || roiMsg.startsWith('Auto-detect') || roiMsg.startsWith('No candidates') ? 'var(--color-occupied, #e74c3c)' : 'var(--color-vacant, #2ecc71)' }}>
              {roiMsg}
            </span>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
          <div style={{ aspectRatio: '1280 / 720', width: '100%' }}>
            <RoiEditor
              backgroundImage={editBg}
              rois={editRois}
              onRoisChange={setEditRois}
              proposals={editProposals}
              onProposalsChange={setEditProposals}
              idPrefix="cam-reg"
            />
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}
