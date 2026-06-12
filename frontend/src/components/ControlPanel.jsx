import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../api'
import RoiEditor from './RoiEditor'

const MODELS = [
  { id: 'cnn_scratch',     label: 'CNN Scratch'      },
  { id: 'resnet50',        label: 'ResNet-50'        },
  { id: 'mobilenetv4s',    label: 'MobileNetV4'      },
  { id: 'yolo26_classify', label: 'YOLO26 Classify'  },
  { id: 'yolo26',          label: 'YOLO26 Detect'    },
]

const LOTS_KEY = 'berth_test_lots'

const DEFAULT_LOTS = []

const slugify = (name) =>
  'lot-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function rotateImageDataUrl(dataUrl, degrees) {
  const img = new Image()
  img.src = dataUrl
  await new Promise(res => { img.onload = res })
  const swap = Math.abs(degrees % 180) === 90
  const canvas = document.createElement('canvas')
  canvas.width = swap ? img.height : img.width
  canvas.height = swap ? img.width : img.height
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(img, -img.width / 2, -img.height / 2)
  return canvas.toDataURL('image/jpeg', 0.92)
}

// Downscale an uploaded image before POSTing — classification crops run at 64px,
// so full-resolution photos only inflate upload + server decode. ROIs are stored
// normalised (0–1), so resizing does not affect their mapping.
async function downscaleForUpload(file, maxDim = 1600) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    if (scale === 1) { bitmap.close?.(); return file }  // already small enough
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9))
    return blob || file
  } catch {
    return file  // any failure → fall back to the original file
  }
}

const loadLots = () => {
  try {
    const raw = localStorage.getItem(LOTS_KEY)
    if (raw === null) {
      localStorage.setItem(LOTS_KEY, JSON.stringify(DEFAULT_LOTS))
      return [...DEFAULT_LOTS]
    }
    return JSON.parse(raw) || []
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
  const [modalLotName, setModalLotName] = useState('')
  const [roiMsg, setRoiMsg]           = useState(null)
  const [videoUploaded, setVideoUploaded] = useState(false)
  const [roiEditorBg, setRoiEditorBg] = useState(null)
  const fileRef                       = useRef(null)
  const uploadedFileRef               = useRef(null)

  const [mode, setMode] = useState('camera')

  // Named ROI lots — separate from live camera ROIs
  const [lots, setLots]               = useState(loadLots)
  const [newLotName, setNewLotName]   = useState('')
  const [selectedLotId, setSelectedLotId] = useState(() => loadLots()[0]?.id || DEFAULT_LOTS[0]?.id || null)

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

  const showStatus = (msg, delay = 4000) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), delay)
  }

  const showRoiMsg = (msg) => {
    setRoiMsg(msg)
    setTimeout(() => setRoiMsg(null), 3000)
  }

  const saveRoisToLot = async (lotId, roiList) => {
    const res = await apiFetch(`${apiBase}/api/roi/${lotId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rois: roiList }),
    })
    if (!res.ok) throw new Error('Save failed')
    return res.json()
  }

  const saveRois = async (roiList) => {
    if (!selectedLotId) return
    try {
      await saveRoisToLot(selectedLotId, roiList)
    } catch (e) {
      showRoiMsg(`Error: ${e.message}`)
    }
  }

  // eslint-disable-next-line no-unused-vars -- half-wired "create lot" handler, kept for now
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

  const openLotRoiEditor = async (lotId) => {
    setModalLotName(lots.find(l => l.id === lotId)?.name || '')
    try {
      const res = await apiFetch(`${apiBase}/api/roi/${lotId}`)
      const data = res.ok ? await res.json() : []
      setRois(Array.isArray(data) ? data : [])
    } catch {}

    if (uploadedImage) {
      setRoiEditorBg(uploadedImage)
      setRoiModalOpen(true)
      return
    }

    try {
      const res = await apiFetch(`${apiBase}/api/roi/${lotId}/snapshot`)
      if (res.ok) {
        const blob = await res.blob()
        const reader = new FileReader()
        reader.onload = (e) => { setRoiEditorBg(e.target.result); setRoiModalOpen(true) }
        reader.onerror = () => { setRoiEditorBg(null); setRoiModalOpen(true) }
        reader.readAsDataURL(blob)
        return
      }
    } catch {}
    setRoiEditorBg(null)
    setRoiModalOpen(true)
  }

  const handleAction = async (endpoint, label) => {
    setStatus(`${label}...`)
    const res = await apiAction(endpoint)
    fetchModelInfo?.()
    showStatus(res?.message || 'Done')
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
    setVideoUploaded(false)
    setRoiEditorBg(null)
  }

  const handleRotate = async (direction) => {
    if (!uploadedImage) return
    const degrees = direction === 'cw' ? 90 : -90
    const dataUrl = await rotateImageDataUrl(uploadedImage, degrees)
    setUploadedImage(dataUrl)
    const resp = await fetch(dataUrl)
    const blob = await resp.blob()
    uploadedFileRef.current = blob
  }

  const handleUpload = async (file) => {
    if (!file) return
    setMode('testing')
    setResultImage(null)
    setResultData(null)

    const isVideo = /\.(mp4|avi|mov|mkv|webm)$/i.test(file.name)
    const isImage = /\.(jpg|jpeg|png|bmp)$/i.test(file.name)

    if (isVideo) {
      setVideoUploaded(true)
      setStatus('Uploading video...')
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await apiFetch(`${apiBase}/api/upload-video`, { method: 'POST', body: form })
        const data = await res.json()
        showStatus(data.message || 'Uploaded', 6000)
      } catch { showStatus('Upload failed', 6000) }
      return
    }

    if (isImage) {
      uploadedFileRef.current = file
      setUploadedImage(null)
      setVideoUploaded(false)

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

      showStatus('Select a lot, draw ROIs, then Analyze.', 6000)
    }
  }

  const handleTest = async () => {
    const hasImage = !!uploadedImage && !!uploadedFileRef.current
    if (hasImage) {
      if (!selectedLotId) {
        showStatus('Select or create a lot first.')
        return
      }
      if (rois.length === 0) {
        showStatus('No ROIs defined — click "Draw ROIs" to mark parking spots first.', 5000)
        return
      }
      setStatus('Analyzing with ROIs...')
      setResultImage(null)
      setResultData(null)
      // Fire save in the background for persistence; pass ROIs inline so the
      // analysis doesn't have to wait for the save round-trip to finish.
      saveRois(rois)
      const uploadBlob = await downscaleForUpload(uploadedFileRef.current)
      const form = new FormData()
      form.append('file', uploadBlob, 'upload.jpg')
      form.append('rois_json', JSON.stringify(rois))
      try {
        const res = await apiFetch(`${apiBase}/api/analyze-roi?camera_id=${selectedLotId}&model_name=${testModel}`, {
          method: 'POST',
          body: form,
        })
        const data = await res.json()
        if (data.annotated_image) {
          setResultImage(data.annotated_image)
          setResultData(data)
          showStatus(
            `${data.total} ROIs: ${data.available} available, ` +
            `${data.occupied} occupied (${data.occupancy_percent}%)`,
            15000,
          )
        } else {
          showStatus(data.detail ? `Error: ${data.detail}` : 'Done')
        }
      } catch { showStatus('Analysis failed') }
      return
    }
    handleAction(
      `/api/test-model/${testModel}`,
      `Testing ${MODELS.find(m => m.id === testModel)?.label}`
    )
  }

  const [roiBtnHovered, setRoiBtnHovered] = useState(false)

  const roiIsError = roiMsg && (roiMsg.startsWith('Error') || roiMsg.startsWith('A lot'))

  return (
    <div>
      {/* Mode + model */}
      <div className="section-title">Mode</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
          style={{ flex: 1 }}
          onClick={() => setMode('camera')}
        >
          Camera
        </button>
        <button
          className={`btn ${mode === 'testing' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
          style={{ flex: 1 }}
          onClick={() => setMode('testing')}
        >
          Testing
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
          Upload
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
      {(uploadedImage || videoUploaded) && !resultImage && (
        <div style={{ marginTop: 12 }}>
          {uploadedImage && (
            <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
              <img src={uploadedImage} alt="Uploaded" style={style.resultImg} />
              <button
                onClick={handleClear}
                title="Clear image"
                style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                  color: '#fff', width: 24, height: 24, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.75rem', lineHeight: 1,
                }}
              >✕</button>
              <button
                onClick={() => handleRotate('ccw')}
                title="Rotate left 90°"
                style={{
                  position: 'absolute', top: 6, left: 6,
                  background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                  color: '#fff', width: 28, height: 28, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', lineHeight: 1,
                }}
              >↺</button>
              <button
                onClick={() => handleRotate('cw')}
                title="Rotate right 90°"
                style={{
                  position: 'absolute', top: 6, left: 40,
                  background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                  color: '#fff', width: 28, height: 28, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', lineHeight: 1,
                }}
              >↻</button>
            </div>
          )}

          {/* Lot selector + Draw ROIs — single row */}
          <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', flexShrink: 0 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRois([])
                  setModalLotName('')
                  setRoiEditorBg(uploadedImage)
                  setRoiModalOpen(true)
                }}
                onMouseEnter={() => setRoiBtnHovered(true)}
                onMouseLeave={() => setRoiBtnHovered(false)}
              >
                ROI
              </button>
              {roiBtnHovered && (
                <div style={{
                  position: 'absolute', bottom: '110%', left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.75)', color: '#fff',
                  fontSize: '0.7rem', whiteSpace: 'nowrap',
                  padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                  pointerEvents: 'none',
                }}>
                  Draw ROIs to test
                </div>
              )}
            </div>
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
              style={{ flexShrink: 0 }}
              title={`Edit ROIs for "${lots.find(l => l.id === selectedLotId)?.name}"`}
              onClick={() => selectedLotId && openLotRoiEditor(selectedLotId)}
              disabled={!selectedLotId}
            >
              ✎
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-occupied)', flexShrink: 0 }}
              title={`Delete "${lots.find(l => l.id === selectedLotId)?.name}" ROI set`}
              onClick={() => selectedLotId && handleDeleteLot(selectedLotId)}
              disabled={!selectedLotId}
            >
              ✕
            </button>
            {rois.length > 0 && (
              <span className="badge badge-info" style={{ flexShrink: 0 }}>
                {rois.length} ROI{rois.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {roiMsg && (
            <div style={{
              ...style.statusMsg,
              color: roiIsError ? 'var(--color-occupied)' : 'var(--color-vacant)',
              background: roiIsError ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)',
            }}>
              {roiMsg}
            </div>
          )}
        </div>
      )}

      {/* Annotated result image */}
      {resultImage && (
        <div style={{ marginTop: 12 }}>
          <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
            <img
              src={`data:image/jpeg;base64,${resultImage}`}
              alt="Analyzed"
              style={style.resultImg}
            />
            <button
              onClick={handleClear}
              title="Clear"
              style={{
                position: 'absolute', top: 6, right: 6,
                background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%',
                color: '#fff', width: 24, height: 24, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', lineHeight: 1,
              }}
            >✕</button>
          </div>
          {resultData && (
            <div style={style.resultStats}>
              <span className="badge badge-vacant">{resultData.available} Available</span>
              <span className="badge badge-occupied">{resultData.occupied} Occupied</span>
              <span className="badge badge-info">{resultData.occupancy_percent}%</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex: 1 }}
              onClick={() => { setResultImage(null); setResultData(null) }}
            >
              ← Back
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const a = document.createElement('a')
                a.href = `data:image/jpeg;base64,${resultImage}`
                a.download = 'analyzed.jpg'
                a.click()
              }}
            >
              ⬇ Save
            </button>
          </div>
        </div>
      )}

      {/* ROI Editor Modal — centered 770×433 dialog */}
      {roiModalOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 770,
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
            boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
            border: '1px solid var(--border-color)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              padding: '8px 12px', borderBottom: '1px solid var(--border-color)',
              flexShrink: 0, gap: 8,
            }}>
              <style>{`.roi-name-input::placeholder{color:rgba(200,210,225,0.6)}`}</style>
              <input
                type="text"
                className="roi-name-input"
                value={modalLotName}
                onChange={e => setModalLotName(e.target.value)}
                placeholder="ROI set name…"
                style={{
                  ...inputStyle,
                  flex: 1,
                  fontSize: '0.85rem',
                  fontWeight: 700,
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                style={{ flexShrink: 0 }}
                onClick={async () => {
                  const name = modalLotName.trim()
                  if (!name) { showRoiMsg('Enter a name for this ROI set'); return }
                  const existing = lots.find(l => l.name === name)
                  let targetId
                  if (existing) {
                    targetId = existing.id
                  } else {
                    targetId = slugify(name)
                    const updated = [...lots, { name, id: targetId }]
                    setLots(updated)
                    localStorage.setItem(LOTS_KEY, JSON.stringify(updated))
                  }
                  setSelectedLotId(targetId)
                  try {
                    await saveRoisToLot(targetId, rois)
                  } catch (e) {
                    showRoiMsg(`Error: ${e.message}`)
                  }
                  setRoiModalOpen(false)
                }}
              >
                Save
              </button>
              <button
                onClick={() => setRoiModalOpen(false)}
                title="Cancel"
                style={{
                  flexShrink: 0,
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-secondary)',
                  width: 30, height: 30,
                  cursor: 'pointer',
                  fontSize: '1rem', lineHeight: 1,
                }}
              >✕</button>
            </div>

            {/* Canvas area: fixed 770×433 */}
            <div style={{ position: 'relative', height: 433, background: '#000', flexShrink: 0 }}>
              {roiEditorBg && (
                <img
                  src={roiEditorBg}
                  alt="ROI background"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none', pointerEvents: 'none' }}
                />
              )}
              <div style={{ position: 'absolute', inset: 0 }}>
                <RoiEditor rois={rois} onRoisChange={setRois} idPrefix="test" overlay />
              </div>
            </div>

            {roiMsg && (
              <div style={{
                padding: '6px 16px', fontSize: '0.8rem', flexShrink: 0,
                color: roiIsError ? 'var(--color-occupied)' : 'var(--color-vacant)',
                borderTop: '1px solid var(--border-color)',
              }}>
                {roiMsg}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
