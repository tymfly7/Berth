import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch, wsAuthParam } from '../api'
import { WS_BASE } from '../config'
import RoiEditor from './RoiEditor'
import MultiCameraGrid from './MultiCameraGrid'

const FRAME_W = 1280
const FRAME_H = 720

const roiBtnStyle = {
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary)',
  fontSize: '0.7rem',
  fontWeight: 600,
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  lineHeight: '1.4',
}

// Thumbnail card used in the camera picker. Opens its own short-lived WS to show
// a live frame so the admin can identify which feed to edit ROIs on.
function PickerCell({ cameraId, name, apiBase, onClick }) {
  const [frame, setFrame] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    const ws = new WebSocket(
      WS_BASE + `/ws/cameras/${cameraId}${wsAuthParam()}`
    )
    wsRef.current = ws
    ws.onmessage = (e) => {
      // Frames now arrive as binary JPEG messages; ignore the JSON metrics.
      if (typeof e.data !== 'string') {
        setFrame(prev => {
          if (prev) URL.revokeObjectURL(prev)
          return URL.createObjectURL(e.data)
        })
      }
    }
    ws.onerror = () => ws.close()
    return () => ws.close()
  }, [cameraId, apiBase])

  return (
    <div
      onClick={onClick}
      style={{
        width: 210,
        flexShrink: 0,
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
    >
      <div style={{ aspectRatio: '16/9', background: 'var(--media-bg)', position: 'relative' }}>
        {frame
          ? <img src={frame} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={name} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Connecting…</div>
        }
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--media-veil)' }}>
          <span style={{ background: 'var(--accent-primary)', color: 'var(--on-accent)', padding: '4px 12px', borderRadius: 4, fontSize: '0.72rem', fontWeight: 700, pointerEvents: 'none' }}>
            ✎ Edit ROIs
          </span>
        </div>
      </div>
      <div style={{ padding: '5px 8px', background: 'var(--bg-card)', fontSize: '0.73rem', fontWeight: 600, color: 'var(--text-primary)', borderTop: '1px solid var(--border-color)' }}>
        {name}
      </div>
    </div>
  )
}

export default function VideoFeed({ connected, activeCamera, apiBase, cameras = [], onCameraMetrics, onCameraUnavailable, onRoisSaved, editRequest = null }) {
  const [roiOpen, setRoiOpen]       = useState(false)
  const [picking, setPicking]       = useState(false)
  const [selectedCamId, setSelectedCamId] = useState(null)
  const [focusedCamId, setFocusedCamId]   = useState(null)
  const [rois, setRois]             = useState([])
  const [saveMsg, setSaveMsg]       = useState(null)
  const [proposals, setProposals]   = useState([])
  const [proposing, setProposing]   = useState(false)
  const [editBg, setEditBg]         = useState(null)
  const [orient, setOrient]         = useState(null)
  const skipSnapshotUpload          = useRef(false)
  const rootRef                     = useRef(null)

  const activeCams = cameras.filter(c => c.active)

  // The camera object being edited (selected by picker or fallback to activeCamera).
  const editCam = selectedCamId
    ? cameras.find(c => c.id === selectedCamId)
    : activeCamera
  // ROI camera ID (may differ from the WS camera ID via roi_camera_id mapping).
  const cameraId = editCam ? (editCam.roi_camera_id || editCam.id) : null

  // Reload ROIs (and the orientation frame) whenever the target camera changes.
  useEffect(() => {
    if (!cameraId || apiBase == null) { setRois([]); setOrient(null); return }
    apiFetch(`${apiBase}/api/roi/${cameraId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
    apiFetch(`${apiBase}/api/roi/${cameraId}/orientation`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setOrient(data && Object.keys(data).length ? data : null))
      .catch(() => {})
  }, [cameraId, apiBase])

  // Grab one live frame from camId to use as the ROI editor background. Uses a
  // single cheap HTTP request against the camera's already-running processor
  // instead of opening a new WebSocket stream (which a loaded edge device may be
  // too saturated to handshake).
  const captureEditFrame = useCallback((camId) => {
    if (!camId || apiBase == null) return
    apiFetch(`${apiBase}/api/cameras/${camId}/frame`)
      .then(r => r.ok ? r.blob() : null)
      .then(blob => { if (blob) setEditBg(URL.createObjectURL(blob)) })
      .catch(() => { /* no live frame available */ })
  }, [apiBase])

  // Upload live-captured frames as the snapshot. Skipped when editBg was loaded
  // from the server (no point re-uploading what we just downloaded).
  useEffect(() => {
    if (!editBg || !cameraId || apiBase == null) return
    if (skipSnapshotUpload.current) { skipSnapshotUpload.current = false; return }
    apiFetch(editBg)
      .then(r => r.blob())
      .then(blob => {
        const fd = new FormData()
        fd.append('file', blob, 'snapshot.jpg')
        return apiFetch(`${apiBase}/api/roi/${cameraId}/snapshot`, { method: 'POST', body: fd })
      })
      .catch(() => { /* non-fatal */ })
  }, [editBg, cameraId, apiBase])

  const showMsg = (msg) => {
    setSaveMsg(msg)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  // Select a camera and open the ROI editor for it.
  // Loads the saved snapshot immediately as background, then replaces it with a
  // fresh live frame so the editor always has something to show.
  const selectCameraForEdit = useCallback(async (camId) => {
    const cam = cameras.find(c => c.id === camId)
    const roiCamId = cam ? (cam.roi_camera_id || cam.id) : camId

    setSelectedCamId(camId)
    setPicking(false)
    setProposals([])
    setEditBg(null)
    setRoiOpen(true)

    // Show saved snapshot right away so the editor isn't blank.
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${roiCamId}/snapshot`)
      if (res.ok) {
        const blob = await res.blob()
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result)
          reader.readAsDataURL(blob)
        })
        skipSnapshotUpload.current = true
        setEditBg(dataUrl)
      }
    } catch { /* no snapshot yet — live capture below will provide one */ }

    // Capture a fresh frame to replace/set the snapshot.
    captureEditFrame(camId)
  }, [cameras, apiBase, captureEditFrame])

  // Open the editor for a camera when the Camera Registry requests it. Keyed on
  // the request's seq (via a ref) so it fires once per click, not when
  // selectCameraForEdit's identity changes on camera-list updates.
  const lastEditReqSeq = useRef(null)
  useEffect(() => {
    if (editRequest?.camId && editRequest.seq !== lastEditReqSeq.current) {
      lastEditReqSeq.current = editRequest.seq
      selectCameraForEdit(editRequest.camId)
      rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [editRequest, selectCameraForEdit])

  const openRoiEditor = () => {
    if (!activeCams.length) return
    // If a camera is already in focus, go straight to editing it.
    if (focusedCamId) {
      selectCameraForEdit(focusedCamId)
      return
    }
    if (activeCams.length === 1) {
      selectCameraForEdit(activeCams[0].id)
    } else {
      setPicking(true)
    }
  }

  // Switch to a different camera while already inside the ROI editor.
  const switchEditorCamera = (camId) => {
    setSelectedCamId(camId)
    setProposals([])
    setEditBg(null)
    captureEditFrame(camId)
  }

  const handleSave = async () => {
    if (!cameraId) return
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${cameraId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rois }),
      })
      if (res.ok) {
        const d = await res.json()
        // Persist the orientation frame too (separate file; never processed).
        await apiFetch(`${apiBase}/api/roi/${cameraId}/orientation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orientation: orient || {} }),
        }).catch(() => {})
        showMsg(`Saved ${d.saved} ROI${d.saved !== 1 ? 's' : ''}`)
        onRoisSaved?.()
      } else {
        showMsg('Save failed')
      }
    } catch {
      showMsg('Network error')
    }
  }

  const handleDeleteRoi = async (roiId) => {
    if (!cameraId) return
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${cameraId}/${roiId}`, { method: 'DELETE' })
      if (res.ok) {
        setRois(prev => prev.filter(r => r.id !== roiId))
        onRoisSaved?.()
      } else {
        showMsg('Delete failed')
      }
    } catch {
      showMsg('Network error')
    }
  }

  const handleAutoDetect = async () => {
    if (!cameraId) return
    setProposing(true)
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${cameraId}/propose`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showMsg(`Auto-detect failed: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      if (data.proposals?.length > 0) {
        setProposals(data.proposals)
        showMsg(`${data.proposals.length} candidate${data.proposals.length > 1 ? 's' : ''} detected — review below`)
      } else {
        showMsg('No candidates found — try a clearer frame')
      }
    } catch (err) {
      showMsg(`Error: ${err.message}`)
    } finally {
      setProposing(false)
    }
  }

  const isError = (msg) => msg && (
    msg.startsWith('Save failed') || msg.startsWith('Network') ||
    msg.startsWith('Error') || msg.startsWith('Auto-detect failed') ||
    msg.startsWith('No candidates')
  )

  return (
    <div ref={rootRef} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>

        {/* Normal live view */}
        {!roiOpen && !picking && connected && (
          <span className="badge badge-occupied" style={{ background: 'var(--color-critical)', color: 'var(--on-accent)', fontSize: '0.65rem' }}>
            ● LIVE
          </span>
        )}
        {!roiOpen && !picking && activeCams.length > 0 && (
          <button
            style={{ ...roiBtnStyle, background: 'var(--surface-2)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            onClick={openRoiEditor}
            title="Select a camera feed and draw parking slot ROIs"
          >
            ✎ Edit ROIs
          </button>
        )}

        {/* Picker mode toolbar */}
        {picking && !roiOpen && (
          <>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1 }}>
              Select a camera to edit ROIs
            </span>
            <button style={roiBtnStyle} onClick={() => setPicking(false)}>
              Cancel
            </button>
          </>
        )}

        {/* ROI editor toolbar */}
        {roiOpen && (
          <>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ROI Editor — {editCam?.name || cameraId}
            </span>
            <button
              style={{ ...roiBtnStyle, borderColor: 'var(--color-proposal-border)', color: proposing ? 'var(--text-muted)' : 'var(--color-proposal)', background: 'var(--color-proposal-tint)', cursor: proposing ? 'default' : 'pointer' }}
              disabled={proposing}
              onClick={handleAutoDetect}
            >
              {proposing ? 'Detecting…' : 'Auto-detect'}
            </button>
            <button style={{ ...roiBtnStyle, background: 'var(--accent-primary)', color: 'var(--on-accent)', border: 'none' }} onClick={handleSave}>
              Save
            </button>
            <button style={roiBtnStyle} onClick={() => { setRoiOpen(false); setPicking(false) }}>
              Done
            </button>
          </>
        )}

        {saveMsg && (
          <span style={{ fontSize: '0.75rem', marginLeft: 4, color: isError(saveMsg) ? 'var(--color-occupied)' : 'var(--color-vacant)' }}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* ── Camera strip switcher (shown inside editor when multiple cameras) ── */}
      {roiOpen && activeCams.length > 1 && (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '8px 16px', borderBottom: '1px solid var(--border-color)', scrollbarWidth: 'thin', scrollbarColor: 'var(--border-color) transparent' }}>
          {activeCams.map(cam => {
            const isActive = (selectedCamId || activeCamera?.id) === cam.id
            return (
              <button
                key={cam.id}
                onClick={() => switchEditorCamera(cam.id)}
                style={{
                  padding: '3px 12px',
                  borderRadius: 4,
                  border: isActive ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: isActive ? 'var(--accent-tint-strong)' : 'var(--surface-1)',
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                {cam.name}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Live camera grid — kept mounted to preserve WS connections ── */}
      <div style={{ display: roiOpen || picking ? 'none' : 'block' }}>
        <MultiCameraGrid cameras={cameras} bare onFocusChange={setFocusedCamId} onMetrics={onCameraMetrics} onUnavailable={onCameraUnavailable} />
      </div>

      {/* ── Camera picker (slidable feed thumbnails) ── */}
      {picking && !roiOpen && (
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'thin', scrollbarColor: 'var(--border-color) transparent' }}>
            {activeCams.map(cam => (
              <PickerCell
                key={cam.id}
                cameraId={cam.id}
                name={cam.name}
                apiBase={apiBase}
                onClick={() => selectCameraForEdit(cam.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── ROI editor ─────────────────────────────────────────────────── */}
      {roiOpen && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}`, width: '100%' }}>
            <RoiEditor
              backgroundImage={editBg}
              rois={rois}
              onRoisChange={setRois}
              proposals={proposals}
              onProposalsChange={setProposals}
              orientation={orient}
              onOrientationChange={setOrient}
              idPrefix="cam"
            />
          </div>
          {rois.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                Saved ROIs ({rois.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {rois.map(roi => (
                  <div
                    key={roi.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '3px 8px', borderRadius: 4,
                      background: 'var(--surface-2)',
                      border: `1px solid ${roi.color || 'var(--border-strong)'}`,
                      fontSize: '0.75rem',
                    }}
                  >
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: roi.color || 'var(--text-muted)', flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-primary)' }}>{roi.label}</span>
                    <button
                      onClick={() => handleDeleteRoi(roi.id)}
                      title={`Delete ${roi.label}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-occupied)', fontSize: '0.7rem', padding: '0 2px', lineHeight: 1 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
