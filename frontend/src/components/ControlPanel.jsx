import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../api'
import RoiEditor from './RoiEditor'

const MODELS = [
  { id: 'cnn_scratch',     label: 'CNN Scratch'      },
  { id: 'resnet50',        label: 'ResNet-50'        },
  { id: 'mobilenetv4',     label: 'MobileNetV4'      },
  { id: 'yolo26_classify', label: 'YOLO26 Classify'  },
  { id: 'yolo26',          label: 'YOLO26 Detect'    },
]

const LOTS_KEY = 'smartpark_test_lots'

const DEFAULT_LOTS = [
  { name: 'LotA', id: 'lot-lota' },
  { name: 'LotB', id: 'ctrl_testing' },
]

const slugify = (name) =>
  'lot-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const loadLots = () => {
  try {
    let saved = JSON.parse(localStorage.getItem(LOTS_KEY) || '[]')
    let changed = false
    for (const def of DEFAULT_LOTS) {
      const idx = saved.findIndex(l => l.id === def.id)
      if (idx === -1) {
        saved = [def, ...saved]
        changed = true
      } else if (saved[idx].name !== def.name) {
        saved = [...saved]
        saved[idx] = { ...saved[idx], name: def.name }
        changed = true
      }
    }
    if (changed) localStorage.setItem(LOTS_KEY, JSON.stringify(saved))
    return saved
  } catch { return [...DEFAULT_LOTS] }
}

const inputStyle = {
  flex: 1,
  background: 'var(--bg-glass)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  padding: '6px 14px',
  fontFamily: 'inherit',
  fontSize: '0.8rem',
  fontWeight: 600,
  outline: 'none',
  transition: 'all var(--transition-fast)',
}

const style = {
  section: { padding: '20px' },
  divider: {
    height: 1,
    background: 'var(--border-color)',
    margin: '16px 0',
  },
  statusMsg: {
    marginTop: 8,
    fontSize: '0.8rem',
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(99,102,241,0.1)',
    color: 'var(--accent-primary)',
    wordBreak: 'break-word',
  },
  resultImg: {
    width: '100%',
    borderRadius: 'var(--radius-sm)',
    marginTop: 10,
  },
  resultStats: {
    display: 'flex',
    gap: 12,
    marginTop: 10,
    fontSize: '0.8rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
}

export default function ControlPanel({ apiAction, apiBase, modelInfo, fetchModelInfo }) {
  const [status, setStatus]           = useState('')
  const [resultImage, setResultImage] = useState(null)
  const [resultData, setResultData]   = useState(null)
  const [liveModel, setLiveModel] = useState(
    () => localStorage.getItem('selectedModel') || 'cnn_scratch'
  )
  const [testModel, setTestModel] = useState(
    () => localStorage.getItem('selectedModel') || 'cnn_scratch'
  )
  const [uploadedImage, setUploadedImage] = useState(null)
  const [rois, setRois]               = useState([])
  const [roiModalOpen, setRoiModalOpen] = useState(false)
  const [roiMsg, setRoiMsg]           = useState(null)
  const fileRef                       = useRef(null)
  const uploadedFileRef               = useRef(null)

  const [mode, setMode] = useState('camera')

  // Named ROI lots — separate from live camera ROIs
  const [lots, setLots]               = useState(loadLots)
  const [newLotName, setNewLotName]   = useState('')
  const [selectedLotId, setSelectedLotId] = useState(() => loadLots()[0]?.id || DEFAULT_LOT.id)

  // Keep live model in sync with server's active model
  useEffect(() => {
    if (modelInfo?.active_model && MODELS.find(m => m.id === modelInfo.active_model)) {
      setLiveModel(modelInfo.active_model)
      localStorage.setItem('selectedModel', modelInfo.active_model)
    }
  }, [modelInfo?.active_model])

  // Reload ROIs when selected lot changes
  useEffect(() => {
    if (!selectedLotId) { setRois([]); return }
    apiFetch(`${apiBase}/api/roi/${selectedLotId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [apiBase, selectedLotId])

  const showRoiMsg = (msg) => {
    setRoiMsg(msg)
    setTimeout(() => setRoiMsg(null), 3000)
  }

  const saveRois = async (roiList) => {
    if (!selectedLotId) return
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${selectedLotId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rois: roiList }),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      showRoiMsg(`Saved ${data.saved} ROIs`)
    } catch (e) {
      showRoiMsg(`Error: ${e.message}`)
    }
  }

  const handleCreateLot = () => {
    const name = newLotName.trim()
    if (!name) return
    const id = slugify(name)
    if (lots.find(l => l.id === id)) {
      showRoiMsg('A lot with that name already exists')
      return
    }
    const updated = [...lots, { name, id }]
    setLots(updated)
    localStorage.setItem(LOTS_KEY, JSON.stringify(updated))
    setSelectedLotId(id)
    setNewLotName('')
  }

  const handleDeleteLot = async (lotId) => {
    const lot = lots.find(l => l.id === lotId)
    if (!lot) return
    try {
      await apiFetch(`${apiBase}/api/roi/${lotId}`, { method: 'DELETE' })
    } catch { /* file may not exist yet — still remove from list */ }
    const updated = lots.filter(l => l.id !== lotId)
    setLots(updated)
    localStorage.setItem(LOTS_KEY, JSON.stringify(updated))
    setRois([])
    if (selectedLotId === lotId) {
      const next = updated[0]
      setSelectedLotId(next?.id || null)
    }
    showRoiMsg(`Deleted "${lot.name}"`)
  }

  const handleAction = async (endpoint, label) => {
    setStatus(`${label}...`)
    const res = await apiAction(endpoint)
    setStatus(res?.message || 'Done')
    fetchModelInfo?.()
    setTimeout(() => setStatus(''), 4000)
  }

  const handleActivateLive = () => {
    const label = MODELS.find(m => m.id === liveModel)?.label || liveModel
    handleAction(`/api/use-model/${liveModel}`, `Activating ${label} on live feeds`)
  }

  const handleClear = () => {
    setUploadedImage(null)
    uploadedFileRef.current = null
    setResultImage(null)
    setResultData(null)
    setStatus('')
  }

  const handleUpload = async (file) => {
    if (!file) return
    setMode('testing')
    setResultImage(null)
    setResultData(null)

    const isVideo = /\.(mp4|avi|mov|mkv|webm)$/i.test(file.name)
    const isImage = /\.(jpg|jpeg|png|bmp)$/i.test(file.name)

    if (isVideo) {
      setStatus('Uploading video...')
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await apiFetch(`${apiBase}/api/upload-video`, { method: 'POST', body: form })
        const data = await res.json()
        setStatus(data.message || 'Uploaded')
      } catch { setStatus('Upload failed') }
      setTimeout(() => setStatus(''), 6000)
      return
    }

    if (isImage) {
      uploadedFileRef.current = file
      setUploadedImage(null)

      if (selectedLotId) {
        const snapshotForm = new FormData()
        snapshotForm.append('file', file)
        apiFetch(`${apiBase}/api/roi/${selectedLotId}/snapshot`, { method: 'POST', body: snapshotForm }).catch(() => {})

        apiFetch(`${apiBase}/api/roi/${selectedLotId}`)
          .then(r => r.ok ? r.json() : [])
          .then(data => setRois(Array.isArray(data) ? data : []))
          .catch(() => {})
      }

      const reader = new FileReader()
      reader.onload = (ev) => setUploadedImage(ev.target.result)
      reader.readAsDataURL(file)

      setStatus('Image ready — select a lot, draw ROIs, then click Analyze.')
      setTimeout(() => setStatus(''), 6000)
    }
  }

  const handleTest = async () => {
    const hasImage = !!uploadedImage && !!uploadedFileRef.current
    if (hasImage) {
      if (!selectedLotId) {
        setStatus('Select or create a lot first.')
        setTimeout(() => setStatus(''), 4000)
        return
      }
      if (rois.length === 0) {
        setStatus('No ROIs defined — click "Draw ROIs" to mark parking spots first.')
        setTimeout(() => setStatus(''), 5000)
        return
      }
      setStatus('Analyzing with ROIs...')
      setResultImage(null)
      setResultData(null)
      await saveRois(rois)
      const form = new FormData()
      form.append('file', uploadedFileRef.current)
      try {
        const res = await apiFetch(`${apiBase}/api/analyze-roi?camera_id=${selectedLotId}&model_name=${testModel}`, {
          method: 'POST',
          body: form,
        })
        const data = await res.json()
        if (data.annotated_image) {
          setResultImage(data.annotated_image)
          setResultData(data)
          setStatus(
            `${data.total} ROIs: ${data.available} available, ` +
            `${data.occupied} occupied (${data.occupancy_percent}%)`
          )
        } else {
          setStatus(data.detail ? `Error: ${data.detail}` : 'Done')
        }
      } catch { setStatus('Analysis failed') }
      setTimeout(() => setStatus(''), 15000)
      return
    }
    handleAction(
      `/api/test-model/${testModel}`,
      `Testing ${MODELS.find(m => m.id === testModel)?.label}`
    )
  }

  return (
    <div className="glass-card" style={style.section}>
      {/* Mode + model */}
      <div className="section-title">Mode</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
          style={{ flex: 1 }}
          onClick={() => setMode('camera')}
        >
          📷 Camera
        </button>
        <button
          className={`btn ${mode === 'testing' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
          style={{ flex: 1 }}
          onClick={() => setMode('testing')}
        >
          🧪 Testing
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <select
          value={mode === 'camera' ? liveModel : testModel}
          onChange={e => {
            if (mode === 'camera') {
              setLiveModel(e.target.value)
              localStorage.setItem('selectedModel', e.target.value)
            } else {
              setTestModel(e.target.value)
            }
          }}
          className="panel-select"
          style={{ flex: 1 }}
        >
          {MODELS.map(({ id, label }) => {
            const active = mode === 'camera' ? liveModel : testModel
            return <option key={id} value={id}>{active === id ? '✓ ' : ''}{label}</option>
          })}
        </select>
        <button
          className="btn btn-ghost btn-sm"
          onClick={mode === 'camera' ? handleActivateLive : handleTest}
          title={mode === 'camera' ? 'Activate on live feeds' : 'Run analysis on uploaded image'}
        >
          {mode === 'camera' ? 'Activate' : 'Analyze'}
        </button>
      </div>

      {status && <div style={style.statusMsg}>{status}</div>}

      <div style={style.divider} />

      {/* Upload button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ flex: 1 }}
          onClick={() => fileRef.current?.click()}
        >
          📁 Upload to Test
        </button>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          image or video
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.bmp,.mp4,.avi,.mov,.mkv,.webm"
          style={{ display: 'none' }}
          onChange={(e) => { handleUpload(e.target.files[0]); e.target.value = '' }}
        />
      </div>

      {/* Raw uploaded image + lot selector + ROI controls */}
      {uploadedImage && !resultImage && (
        <div style={{ marginTop: 12 }}>
          <img src={uploadedImage} alt="Uploaded" style={style.resultImg} />

          {/* Lot selector — shown inline with Draw ROIs */}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>ROI Set:</span>
              <select
                value={selectedLotId}
                onChange={e => setSelectedLotId(e.target.value)}
                className="panel-select"
                style={{ flex: 1 }}
              >
                {lots.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--color-occupied)', flexShrink: 0 }}
                title={`Delete "${lots.find(l => l.id === selectedLotId)?.name}" ROI set`}
                onClick={() => selectedLotId && handleDeleteLot(selectedLotId)}
                disabled={!selectedLotId}
              >
                🗑
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="New lot name…"
                value={newLotName}
                onChange={e => setNewLotName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateLot()}
                style={{ ...inputStyle, fontSize: '0.75rem' }}
              />
              <button className="btn btn-ghost btn-sm" onClick={handleCreateLot}>+ New</button>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setRoiModalOpen(true)}
                disabled={!selectedLotId}
                title={!selectedLotId ? 'Select or create a lot first' : `Draw ROIs for ${lots.find(l => l.id === selectedLotId)?.name}`}
              >
                ✏️ Draw ROIs
              </button>
              {rois.length > 0 && (
                <span className="badge badge-info">
                  {rois.length} ROI{rois.length !== 1 ? 's' : ''} defined
                </span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'auto', color: 'var(--color-occupied)' }}
                onClick={handleClear}
              >
                ✕ Remove
              </button>
            </div>
          </div>

          {roiMsg && (
            <div style={{
              ...style.statusMsg,
              color: roiMsg.startsWith('Error') || roiMsg.startsWith('A lot') ? 'var(--color-occupied)' : 'var(--color-vacant)',
              background: roiMsg.startsWith('Error') || roiMsg.startsWith('A lot') ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
            }}>
              {roiMsg}
            </div>
          )}
        </div>
      )}

      {/* Annotated result image */}
      {resultImage && (
        <div style={{ marginTop: 12 }}>
          <img
            src={`data:image/jpeg;base64,${resultImage}`}
            alt="Analyzed"
            style={style.resultImg}
          />
          {resultData && (
            <div style={style.resultStats}>
              <span className="badge badge-vacant">🟢 {resultData.available} Available</span>
              <span className="badge badge-occupied">🔴 {resultData.occupied} Occupied</span>
              <span className="badge badge-info">📊 {resultData.occupancy_percent}%</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
              onClick={() => { setResultImage(null); setResultData(null) }}
            >
              ← Back to image
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-occupied)' }}
              onClick={handleClear}
            >
              ✕ Remove
            </button>
          </div>
        </div>
      )}

      {/* ROI Editor Modal — fullscreen */}
      {roiModalOpen && uploadedImage && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.96)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 20px', borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              ROI Editor — {lots.find(l => l.id === selectedLotId)?.name || selectedLotId} — click to add points, double-click to close polygon
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => { await saveRois(rois); setRoiModalOpen(false) }}
              >
                Save & Close
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRoiModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            <RoiEditor backgroundImage={uploadedImage} rois={rois} onRoisChange={setRois} idPrefix="test" />
          </div>

          {roiMsg && (
            <div style={{
              padding: '8px 20px', fontSize: '0.8rem', flexShrink: 0,
              color: roiMsg.startsWith('Error') ? 'var(--color-occupied)' : 'var(--color-vacant)',
              background: 'var(--bg-card)',
            }}>
              {roiMsg}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
