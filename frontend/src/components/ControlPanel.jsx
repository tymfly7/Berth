import { useState, useRef, useEffect } from 'react'
import RoiEditor from './RoiEditor'

const MODELS = [
  { id: 'cnn_scratch',     label: 'CNN Scratch'      },
  { id: 'resnet50',        label: 'ResNet-50'        },
  { id: 'mobilenetv4',     label: 'MobileNetV4'      },
  { id: 'yolo26_classify', label: 'YOLO26 Classify'  },
  { id: 'yolo26',          label: 'YOLO26 Detect'    },
]

const TESTING_CAMERA_ID = 'ctrl_testing'

const style = {
  section: { padding: '20px' },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '16px',
  },
  divider: {
    height: 1,
    background: 'var(--border-color)',
    margin: '16px 0',
  },
  uploadZone: {
    border: '2px dashed var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '24px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all var(--transition-base)',
    color: 'var(--text-secondary)',
    fontSize: '0.85rem',
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
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const [resultImage, setResultImage] = useState(null)
  const [resultData, setResultData] = useState(null)
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('selectedModel') || 'cnn_scratch')
  const [uploadedImage, setUploadedImage] = useState(null)
  const [rois, setRois] = useState([])
  const [roiModalOpen, setRoiModalOpen] = useState(false)
  const [roiMsg, setRoiMsg] = useState(null)
  const fileRef = useRef(null)
  const uploadedFileRef = useRef(null)

  const [mode, setMode] = useState('camera')

  // Keep the model dropdown in sync with the server's active model
  useEffect(() => {
    if (modelInfo?.active_model) {
      if (MODELS.find(m => m.id === modelInfo.active_model)) {
        setSelectedModel(modelInfo.active_model)
        localStorage.setItem('selectedModel', modelInfo.active_model)
      }
    }
  }, [modelInfo?.active_model])

  useEffect(() => {
    fetch(`${apiBase}/api/roi/${TESTING_CAMERA_ID}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [apiBase])

  const showRoiMsg = (msg) => {
    setRoiMsg(msg)
    setTimeout(() => setRoiMsg(null), 3000)
  }

  const saveRois = async (roiList) => {
    try {
      const res = await fetch(`${apiBase}/api/roi/${TESTING_CAMERA_ID}`, {
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

  const handleAction = async (endpoint, label) => {
    setStatus(`${label}...`)
    const res = await apiAction(endpoint)
    setStatus(res?.message || 'Done')
    fetchModelInfo?.()
    setTimeout(() => setStatus(''), 4000)
  }

  const handleActivateLive = () => {
    const label = MODELS.find(m => m.id === selectedModel)?.label || selectedModel
    handleAction(`/api/use-model/${selectedModel}`, `Activating ${label} on live feeds`)
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
        const res = await fetch(`${apiBase}/api/upload-video`, { method: 'POST', body: form })
        const data = await res.json()
        setStatus(data.message || 'Uploaded')
      } catch { setStatus('Upload failed') }
      setTimeout(() => setStatus(''), 6000)
      return
    }

    if (isImage) {
      uploadedFileRef.current = file
      setRois([])
      setUploadedImage(null)

      const snapshotForm = new FormData()
      snapshotForm.append('file', file)
      fetch(`${apiBase}/api/roi/${TESTING_CAMERA_ID}/snapshot`, { method: 'POST', body: snapshotForm }).catch(() => {})

      fetch(`${apiBase}/api/roi/${TESTING_CAMERA_ID}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setRois(Array.isArray(data) ? data : []))
        .catch(() => {})

      const reader = new FileReader()
      reader.onload = (ev) => setUploadedImage(ev.target.result)
      reader.readAsDataURL(file)

      setStatus('Image ready — draw ROIs then click Test to analyze.')
      setTimeout(() => setStatus(''), 6000)
    }
  }

  const handleTest = async () => {
    const hasImage = !!uploadedImage && !!uploadedFileRef.current
    if (hasImage && rois.length === 0) {
      setStatus('No ROIs defined — click "Draw ROIs" to mark parking spots first.')
      setTimeout(() => setStatus(''), 5000)
      return
    }
    if (hasImage && rois.length > 0) {
      setStatus('Analyzing with ROIs...')
      setResultImage(null)
      setResultData(null)
      await saveRois(rois)
      const form = new FormData()
      form.append('file', uploadedFileRef.current)
      try {
        const res = await fetch(`${apiBase}/api/analyze-roi?camera_id=${TESTING_CAMERA_ID}`, {
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
      `/api/test-model/${selectedModel}`,
      `Testing ${MODELS.find(m => m.id === selectedModel)?.label}`
    )
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
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
          title="Switch to camera mode"
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
          value={selectedModel}
          onChange={e => { setSelectedModel(e.target.value); localStorage.setItem('selectedModel', e.target.value) }}
          className="panel-select"
          style={{ flex: 1 }}
        >
          {MODELS.map(({ id, label }) => (
            <option key={id} value={id}>{selectedModel === id ? '✓ ' : ''}{label}</option>
          ))}
        </select>
        <button
          className="btn btn-ghost btn-sm"
          onClick={mode === 'camera' ? handleActivateLive : handleTest}
          title={mode === 'camera' ? 'Activate on live feeds' : 'Run analysis on uploaded image'}
        >
          Activate
        </button>
      </div>

      {status && <div style={style.statusMsg}>{status}</div>}

      <div>
          <div style={style.divider} />

          {/* Upload zone */}
          <div className="section-title">Upload Parking Lot Image</div>
          <div
            style={{
              ...style.uploadZone,
              borderColor: dragging ? 'var(--accent-primary)' : 'var(--border-color)',
              background: dragging ? 'rgba(99,102,241,0.05)' : 'transparent',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            📁 Drop a parking lot image or video here
            <br />
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>
              Aerial views, Google Images, screenshots, etc.
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,.bmp,.mp4,.avi,.mov,.mkv,.webm"
              style={{ display: 'none' }}
              onChange={(e) => { handleUpload(e.target.files[0]); e.target.value = '' }}
            />
          </div>

          {/* Raw uploaded image + ROI controls */}
          {uploadedImage && !resultImage && (
            <div style={{ marginTop: 12 }}>
              <img src={uploadedImage} alt="Uploaded" style={style.resultImg} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setRoiModalOpen(true)}>
                  ✏️ Draw ROIs
                </button>
                {rois.length > 0 && (
                  <span className="badge badge-info">
                    {rois.length} ROI{rois.length !== 1 ? 's' : ''} defined
                  </span>
                )}
              </div>
              {roiMsg && (
                <div style={{
                  ...style.statusMsg,
                  color: roiMsg.startsWith('Error') ? 'var(--color-occupied)' : 'var(--color-vacant)',
                  background: roiMsg.startsWith('Error') ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
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
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 8, width: '100%' }}
                onClick={() => { setResultImage(null); setResultData(null) }}
              >
                ← Back to image
              </button>
            </div>
          )}
        </div>

      {/* ROI Editor Modal — fullscreen */}
      {roiModalOpen && uploadedImage && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.96)',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header bar */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 20px', borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-card)', flexShrink: 0,
          }}>
            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
              ROI Editor — click to add polygon points, double-click to close
            </span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => { await saveRois(rois); setRoiModalOpen(false) }}
              >
                Save & Close
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setRoiModalOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>

          {/* Image + canvas — fills all remaining space */}
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
