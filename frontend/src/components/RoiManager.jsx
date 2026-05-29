import { useState, useEffect } from 'react'
import RoiEditor from './RoiEditor'

const API_BASE = `http://${window.location.hostname}:8000`
const CAMERA_ID = 'default'

export default function RoiManager() {
  const [rois, setRois] = useState([])
  const [bgImage, setBgImage] = useState(null)
  const [saveMsg, setSaveMsg] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/roi/${CAMERA_ID}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const showMsg = (msg) => {
    setSaveMsg(msg)
    setTimeout(() => setSaveMsg(null), 3000)
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

  return (
    <div className="glass-card" style={{ padding: '20px', marginTop: '16px' }}>
      <div className="section-title">🗺️ ROI Manager</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>
          Reference Image
        </div>
        <label style={uploadBtnStyle}>
          Upload Image
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {bgImage ? (
        <RoiEditor backgroundImage={bgImage} rois={rois} onRoisChange={setRois} />
      ) : (
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
        {saveMsg && (
          <span style={{
            fontSize: '0.8rem',
            color: saveMsg.startsWith('Error')
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
    </div>
  )
}
