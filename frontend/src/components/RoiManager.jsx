import { useState, useEffect } from 'react'
import RoiEditor from './RoiEditor'


const API_BASE = `http://${window.location.hostname}:8000`
const CAMERA_ID = 'default'

export default function RoiManager() {
  const [rois, setRois] = useState([])
  const [bgImage, setBgImage] = useState(null)
  const [saveMsg, setSaveMsg] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [proposals, setProposals] = useState([])
  const [proposing, setProposing] = useState(false)

  useEffect(() => { if (bgImage) setModalOpen(true) }, [bgImage])

  useEffect(() => {
    fetch(`${API_BASE}/api/roi/${CAMERA_ID}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const showMsg = (msg) => {
    setSaveMsg(msg)
    setTimeout(() => setSaveMsg(null), 4000)
  }

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    fetch(`${API_BASE}/api/roi/${CAMERA_ID}/snapshot`, { method: 'POST', body: formData })
      .then(r => { if (!r.ok) throw new Error('Upload failed'); return r.json() })
      .then(() => {
        const reader = new FileReader()
        reader.onload = (ev) => setBgImage(ev.target.result)
        reader.readAsDataURL(file)
      })
      .catch(err => showMsg(`Error: ${err.message}`))
  }

  const handleSave = () => {
    fetch(`${API_BASE}/api/roi/${CAMERA_ID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rois }),
    })
      .then(r => r.ok ? r.json() : Promise.reject('Save failed'))
      .then(data => showMsg(`Saved ${data.saved} ROIs`))
      .catch(err => showMsg(`Error: ${err}`))
  }

  const handleDeleteRoi = (roiId) => {
    fetch(`${API_BASE}/api/roi/${CAMERA_ID}/${roiId}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) throw new Error('Delete failed'); return r.json() })
      .then(() => setRois(prev => prev.filter(r => r.id !== roiId)))
      .catch(err => showMsg(`Error: ${err.message}`))
  }

  const handleClearAll = async () => {
    for (const roi of [...rois]) {
      await fetch(`${API_BASE}/api/roi/${CAMERA_ID}/${roi.id}`, { method: 'DELETE' })
    }
    setRois([])
  }

  const handleAutoDetect = async () => {
    if (!bgImage) {
      showMsg('Upload a reference image first.')
      return
    }
    setProposing(true)
    try {
      const res = await fetch(`${API_BASE}/api/roi/${CAMERA_ID}/propose`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        showMsg(`Auto-detect failed: ${err.detail || res.statusText}`)
        return
      }
      const data = await res.json()
      if (data.proposals && data.proposals.length > 0) {
        setProposals(data.proposals)
        setModalOpen(true)
        showMsg(`${data.proposals.length} candidate spot(s) detected — review in editor`)
      } else {
        showMsg('No candidate spots detected. Try a clearer or better-lit image.')
      }
    } catch (err) {
      showMsg(`Auto-detect error: ${err.message}`)
    } finally {
      setProposing(false)
    }
  }

  const uploadBtnStyle = {
    display: 'inline-block', padding: '6px 14px', borderRadius: 4,
    background: 'var(--color-primary, #3498db)', color: '#fff',
    cursor: 'pointer', fontSize: '0.8rem', border: 'none',
  }

  const saveBtnStyle = {
    padding: '7px 16px', borderRadius: 4, border: 'none',
    background: 'var(--color-primary, #3498db)', color: '#fff',
    cursor: 'pointer', fontSize: '0.85rem',
  }

  const autoDetectBtnStyle = {
    padding: '6px 14px', borderRadius: 4,
    border: '1px solid rgba(100,200,255,0.5)',
    background: proposing ? 'rgba(100,200,255,0.05)' : 'rgba(100,200,255,0.1)',
    color: proposing ? 'rgba(100,200,255,0.45)' : '#64c8ff',
    cursor: proposing ? 'default' : 'pointer',
    fontSize: '0.8rem',
  }

  return (
    <div className="glass-card" style={{ padding: '20px', marginTop: '16px' }}>
      <div className="section-title">ROI Manager</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>
          Reference Image
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={uploadBtnStyle}>
            Upload Image
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
          </label>
          {bgImage && (
            <button
              style={autoDetectBtnStyle}
              disabled={proposing}
              onClick={handleAutoDetect}
              title="Run automatic vehicle detection to propose candidate parking spots"
            >
              {proposing ? 'Detecting…' : 'Auto-detect spots'}
            </button>
          )}
        </div>
        {bgImage && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted,#888)', marginTop: 5 }}>
            Auto-detect finds occupied spots (vehicles visible). Empty spots may be missed — always review proposals.
          </div>
        )}
      </div>

      {!bgImage && (
        <div style={{
          border: '2px dashed rgba(255,255,255,0.15)', borderRadius: 6,
          padding: '32px 16px', textAlign: 'center',
          color: 'var(--text-muted, #888)', fontSize: '0.85rem', marginBottom: 12,
        }}>
          Upload an aerial or reference image
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button onClick={handleSave} style={saveBtnStyle}>Save ROIs</button>
        {bgImage && (
          <button onClick={() => setModalOpen(true)} style={{ ...saveBtnStyle, background: 'rgba(255,255,255,0.1)' }}>
            Edit ROIs
          </button>
        )}
        {saveMsg && (
          <span style={{
            fontSize: '0.8rem',
            color: saveMsg.startsWith('Error') || saveMsg.startsWith('Auto-detect')
              ? 'var(--color-occupied, #e74c3c)'
              : 'var(--color-vacant, #2ecc71)',
          }}>
            {saveMsg}
          </span>
        )}
      </div>

      {rois.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{
                color: 'var(--text-muted, #888)',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
              }}>
                <th style={{ textAlign: 'left', paddingBottom: 4 }}>ID</th>
                <th style={{ textAlign: 'left', padding: '0 8px 4px' }}>Label</th>
                <th style={{ textAlign: 'left', padding: '0 8px 4px' }}>Vertices</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rois.map(roi => (
                <tr key={roi.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                    {roi.id.slice(-8)}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{roi.label}</td>
                  <td style={{ padding: '4px 8px' }}>{roi.polygon.length}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right' }}>
                    <button
                      onClick={() => handleDeleteRoi(roi.id)}
                      style={{
                        fontSize: '0.7rem', padding: '2px 8px', cursor: 'pointer',
                        borderRadius: 3,
                        border: '1px solid var(--color-occupied, #e74c3c)',
                        background: 'transparent',
                        color: 'var(--color-occupied, #e74c3c)',
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={handleClearAll}
            style={{
              marginTop: 8, fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer',
              borderRadius: 3, border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: 'var(--text-muted, #888)',
            }}
          >
            Clear All
          </button>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            position: 'relative',
            width: '90vw', height: '90vh',
            background: 'var(--bg-card, #1a1a2e)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 20px', borderBottom: '1px solid var(--border-color)',
              flexShrink: 0,
            }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                ROI Editor
                {proposals.length > 0
                  ? ` — ${proposals.length} proposal${proposals.length > 1 ? 's' : ''} pending review`
                  : ' — click to add polygon points, double-click to close'}
              </span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handleSave} style={saveBtnStyle}>Save ROIs</button>
                <button onClick={() => setModalOpen(false)} style={{ ...saveBtnStyle, background: 'rgba(255,255,255,0.1)' }}>Close</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
              <RoiEditor
                backgroundImage={bgImage}
                rois={rois}
                onRoisChange={setRois}
                proposals={proposals}
                onProposalsChange={setProposals}
              />
            </div>
            {saveMsg && (
              <div style={{
                padding: '8px 20px', fontSize: '0.8rem',
                color: saveMsg.startsWith('Error') || saveMsg.startsWith('Auto-detect')
                  ? 'var(--color-occupied, #e74c3c)'
                  : 'var(--color-vacant, #2ecc71)',
              }}>
                {saveMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
