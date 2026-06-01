import { useState, useEffect, useRef, useCallback } from 'react'
import RoiEditor from './RoiEditor'
import MultiCameraGrid from './MultiCameraGrid'

// Frame dimensions must match config.FRAME_WIDTH / config.FRAME_HEIGHT on the backend.
// The ROI canvas is sized to this ratio so normalized coords map 1-to-1 to VideoProcessor pixels.
const FRAME_W = 1280
const FRAME_H = 720


const roiBtnStyle = {
  padding: '3px 10px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(0,0,0,0.55)',
  color: '#fff',
  fontSize: '0.7rem',
  fontWeight: 600,
  cursor: 'pointer',
  backdropFilter: 'blur(4px)',
  lineHeight: '1.4',
}

const saveBtnStyle = {
  padding: '7px 16px',
  borderRadius: 4,
  border: 'none',
  background: 'var(--accent-primary, #3498db)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '0.85rem',
  fontWeight: 600,
}

export default function VideoFeed({ frame, connected, activeCamera, apiBase, cameras = [] }) {
  const [roiOpen, setRoiOpen]     = useState(false)
  const [rois, setRois]           = useState([])
  const [saveMsg, setSaveMsg]     = useState(null)
  const [proposals, setProposals] = useState([])
  const [proposing, setProposing] = useState(false)
  // Background frame captured from the active camera WS when the ROI editor opens.
  // Using the actual camera frame (not the legacy /ws/video frame) ensures the canvas
  // coordinate system matches the VideoProcessor's 900×500 frame exactly.
  const [editBg, setEditBg]       = useState(null)
  const editWsRef                 = useRef(null)

  const cameraId = activeCamera ? (activeCamera.roi_camera_id || activeCamera.id) : null

  // Reload ROIs whenever active camera changes
  useEffect(() => {
    if (!cameraId || !apiBase) { setRois([]); return }
    fetch(`${apiBase}/api/roi/${cameraId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [cameraId, apiBase])

  // Clean up the frame-capture WS on unmount.
  useEffect(() => () => { editWsRef.current?.close() }, [])

  // Opens a short-lived WS to capture one frame from the active camera for the ROI editor
  // background. Closes immediately after the first frame arrives.
  const captureEditFrame = useCallback(() => {
    if (!cameraId || !apiBase) return
    editWsRef.current?.close()
    const wsUrl = apiBase.replace(/^http/, 'ws') + `/ws/cameras/${cameraId}`
    const ws = new WebSocket(wsUrl)
    editWsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (d.frame) {
          setEditBg(`data:image/jpeg;base64,${d.frame}`)
          ws.close()
        }
      } catch { /* ignore */ }
    }
    ws.onerror = () => ws.close()
  }, [cameraId, apiBase])

  const showMsg = (msg) => {
    setSaveMsg(msg)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  const openRoiEditor = async () => {
    if (!cameraId) return
    // Capture a frame from the active camera to use as the ROI editor background.
    // This frame also becomes the auto-detect snapshot so both use the same source.
    captureEditFrame()
    setProposals([])
    setRoiOpen(true)
  }

  // When editBg is updated (frame arrives from camera WS), also upload it as the
  // auto-detect snapshot so proposals are generated against the correct camera view.
  useEffect(() => {
    if (!editBg || !cameraId || !apiBase) return
    fetch(editBg)
      .then(r => r.blob())
      .then(blob => {
        const fd = new FormData()
        fd.append('file', blob, 'snapshot.jpg')
        return fetch(`${apiBase}/api/roi/${cameraId}/snapshot`, { method: 'POST', body: fd })
      })
      .catch(() => { /* non-fatal */ })
  }, [editBg, cameraId, apiBase])

  const handleSave = async () => {
    if (!cameraId) return
    try {
      const res = await fetch(`${apiBase}/api/roi/${cameraId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rois }),
      })
      if (res.ok) {
        const d = await res.json()
        showMsg(`Saved ${d.saved} ROI${d.saved !== 1 ? 's' : ''}`)
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
      const res = await fetch(`${apiBase}/api/roi/${cameraId}/${roiId}`, { method: 'DELETE' })
      if (res.ok) {
        setRois(prev => prev.filter(r => r.id !== roiId))
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
      const res = await fetch(`${apiBase}/api/roi/${cameraId}/propose`, { method: 'POST' })
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
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
        {!roiOpen && connected && frame && (
          <span className="badge badge-occupied" style={{ background: 'rgba(239,68,68,0.9)', color: '#fff', fontSize: '0.65rem' }}>
            ● LIVE
          </span>
        )}
        {!roiOpen && cameraId && (
          <button style={{ ...roiBtnStyle, background: 'rgba(255,255,255,0.07)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} onClick={openRoiEditor} title="Draw parking slot ROIs on this camera">
            ✎ Edit ROIs
          </button>
        )}
        {roiOpen && (
          <>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ROI Editor — {activeCamera?.name || cameraId}
            </span>
            <button
              style={{ ...roiBtnStyle, borderColor: 'rgba(100,200,255,0.5)', color: proposing ? 'rgba(100,200,255,0.4)' : '#64c8ff', background: 'rgba(100,200,255,0.08)', cursor: proposing ? 'default' : 'pointer' }}
              disabled={proposing}
              onClick={handleAutoDetect}
            >
              {proposing ? 'Detecting…' : 'Auto-detect'}
            </button>
            <button style={{ ...roiBtnStyle, background: 'var(--accent-primary, #3498db)', border: 'none' }} onClick={handleSave}>
              Save
            </button>
            <button style={roiBtnStyle} onClick={() => setRoiOpen(false)}>
              Done
            </button>
          </>
        )}
        {saveMsg && (
          <span style={{ fontSize: '0.75rem', marginLeft: 4, color: isError(saveMsg) ? 'var(--color-occupied, #e74c3c)' : 'var(--color-vacant, #2ecc71)' }}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* Live camera grid (shown when not editing) */}
      {!roiOpen && <MultiCameraGrid cameras={cameras} bare />}

      {/* ROI editor (shown instead of live grid while editing).
          The container is locked to the backend frame's aspect ratio (FRAME_W:FRAME_H)
          so the canvas coordinate system is identical to VideoProcessor pixel space,
          giving exact 1-to-1 ROI placement on the rendered frames. */}
      {roiOpen && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
          <div style={{ aspectRatio: `${FRAME_W} / ${FRAME_H}`, width: '100%' }}>
            <RoiEditor
              backgroundImage={editBg}
              rois={rois}
              onRoisChange={setRois}
              proposals={proposals}
              onProposalsChange={setProposals}
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
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${roi.color || 'rgba(255,255,255,0.15)'}`,
                      fontSize: '0.75rem',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block', width: 8, height: 8,
                        borderRadius: '50%', background: roi.color || '#888', flexShrink: 0,
                      }}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>{roi.label}</span>
                    <button
                      onClick={() => handleDeleteRoi(roi.id)}
                      title={`Delete ${roi.label}`}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-occupied, #e74c3c)', fontSize: '0.7rem',
                        padding: '0 2px', lineHeight: 1,
                      }}
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
