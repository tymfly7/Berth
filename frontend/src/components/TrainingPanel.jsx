import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import DataAugmentPanel from './DataAugmentPanel'

const MODELS = [
  { id: 'cnn_scratch',     label: 'CNN Scratch'     },
  { id: 'resnet50',        label: 'ResNet-50'       },
  { id: 'mobilenetv4s',    label: 'MobileNetV4'     },
  { id: 'yolo26_classify', label: 'YOLO26 Classify' },
  { id: 'yolo26_detect',   label: 'YOLO26 Detect'   },
]

function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span style={{
          position: 'absolute',
          bottom: '130%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15,15,20,0.97)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px 10px',
          fontSize: '0.72rem',
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-line',
          width: 260,
          zIndex: 999,
          pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}>
          {text}
          <span style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            border: '5px solid transparent',
            borderTopColor: 'var(--border-color)',
          }} />
        </span>
      )}
    </span>
  )
}

function Collapsible({ label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: 'transparent', border: 'none', padding: '8px 12px', textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <span>{label}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  )
}

const style = {
  container: {},
  row: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  logBox: {
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    maxHeight: 150,
    overflow: 'auto',
    fontFamily: 'monospace',
    fontSize: '0.72rem',
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
  },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: '0.8rem',
    borderBottom: '1px solid var(--border-color)',
  },
  dropZoneRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 10,
  },
  dropZone: (dragOver) => ({
    flex: 1,
    minHeight: 96,
    border: `2px ${dragOver ? 'solid' : 'dashed'} var(--border-color)`,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    cursor: 'pointer',
    padding: '12px 8px',
    transition: 'border 0.15s, background 0.15s',
    background: dragOver ? 'rgba(255,255,255,0.05)' : 'transparent',
    userSelect: 'none',
  }),
}

function DropZone({ label, files, onFiles, onClear }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (dropped.length) onFiles(prev => [...prev, ...dropped])
  }

  const handleChange = (e) => {
    const picked = Array.from(e.target.files)
    if (picked.length) onFiles(prev => [...prev, ...picked])
    e.target.value = ''
  }

  const icon = label === 'Occupied' ? '🚗' : '🟢'

  return (
    <div
      style={style.dropZone(dragOver)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <span style={{ fontSize: '1.4rem' }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{label}</span>
      {files.length > 0 ? (
        <>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {files.length} file{files.length !== 1 ? 's' : ''} ready
          </span>
          <span
            style={{ fontSize: '0.72rem', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}
            onClick={(e) => { e.stopPropagation(); onClear() }}
          >
            Clear
          </span>
        </>
      ) : (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
          Drop images or click
        </span>
      )}
    </div>
  )
}

function YoloImagesZone({ files, onFiles, onClear }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (dropped.length) onFiles(prev => [...prev, ...dropped])
  }

  const handleChange = (e) => {
    const picked = Array.from(e.target.files).filter(f => f.type.startsWith('image/'))
    if (picked.length) onFiles(prev => [...prev, ...picked])
    e.target.value = ''
  }

  return (
    <div
      style={style.dropZone(dragOver)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleChange} />
      <span style={{ fontSize: '1.4rem' }}>🖼️</span>
      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>Parking Images</span>
      {files.length > 0 ? (
        <>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{files.length} image{files.length !== 1 ? 's' : ''} ready</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }} onClick={(e) => { e.stopPropagation(); onClear() }}>Clear</span>
        </>
      ) : (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Full-scene lot images</span>
      )}
    </div>
  )
}

function YoloAnnotationZone({ file, onFile, onClear }) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = Array.from(e.dataTransfer.files).find(f => f.name.endsWith('.json'))
    if (f) onFile(f)
  }

  const handleChange = (e) => {
    const f = e.target.files[0]
    if (f) onFile(f)
    e.target.value = ''
  }

  return (
    <div
      style={style.dropZone(dragOver)}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleChange} />
      <span style={{ fontSize: '1.4rem' }}>📋</span>
      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>annotations.json</span>
      {file ? (
        <>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{file.name}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }} onClick={(e) => { e.stopPropagation(); onClear() }}>Clear</span>
        </>
      ) : (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Drop annotations.json</span>
      )}
    </div>
  )
}

export default function TrainingPanel({ apiAction, apiBase, modelInfo, fetchModelInfo }) {
  const [training, setTraining] = useState(null)
  const pollRef = useRef(null)
  const [occupiedFiles, setOccupiedFiles] = useState([])
  const [vacantFiles, setVacantFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [yoloImages, setYoloImages] = useState([])
  const [yoloAnnotation, setYoloAnnotation] = useState(null)
  const [yoloUploading, setYoloUploading] = useState(false)
  const [yoloMsg, setYoloMsg] = useState(null)
  const [yoloError, setYoloError] = useState(null)
  const [selectedModel, setSelectedModel] = useState('cnn_scratch')
  const msgTimer = useRef(null)
  const yoloTimer = useRef(null)

  const pollStatus = async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/train/status`)
      if (res.ok) {
        const data = await res.json()
        setTraining(data)
        if (data.status === 'training') {
          if (data.model_name) setSelectedModel(data.model_name)
          pollRef.current = setTimeout(pollStatus, 2000)
        }
      }
    } catch { /* silent */ }
  }

  useEffect(() => {
    // Resume polling if training was already in progress before this page load
    pollStatus()
    return () => {
      clearTimeout(pollRef.current)
      clearTimeout(msgTimer.current)
      clearTimeout(yoloTimer.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startTraining = async (modelName, compareAll = false) => {
    setTraining({ status: 'training', model_name: modelName })
    const endpoint = `/api/train/start?model_name=${modelName}&compare_all=${compareAll}`
    await apiAction(endpoint)
    pollStatus()
  }

  const uploadZone = async (files, label) => {
    if (!files.length) return { saved: 0, skipped: 0 }
    const fd = new FormData()
    fd.append('label', label)
    files.forEach(f => fd.append('files', f))
    const res = await apiFetch(`${apiBase}/api/dataset/upload`, { method: 'POST', body: fd })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Upload failed')
    }
    return res.json()
  }

  const handleUpload = async () => {
    setUploading(true)
    setUploadMsg(null)
    setUploadError(null)
    try {
      const [occResult, vacResult] = await Promise.all([
        uploadZone(occupiedFiles, 'occupied'),
        uploadZone(vacantFiles, 'vacant'),
      ])
      setOccupiedFiles([])
      setVacantFiles([])
      setUploadMsg(`Saved ${occResult.saved} occupied, ${vacResult.saved} vacant images`)
      clearTimeout(msgTimer.current)
      msgTimer.current = setTimeout(() => setUploadMsg(null), 4000)
      if (fetchModelInfo) fetchModelInfo()
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleYoloUpload = async () => {
    if (!yoloImages.length || !yoloAnnotation) return
    setYoloUploading(true)
    setYoloMsg(null)
    setYoloError(null)
    try {
      const fd = new FormData()
      yoloImages.forEach(f => fd.append('images', f))
      fd.append('annotations', yoloAnnotation)
      const res = await apiFetch(`${apiBase}/api/dataset/upload-yolo`, { method: 'POST', body: fd })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Upload failed')
      }
      const data = await res.json()
      setYoloImages([])
      setYoloAnnotation(null)
      setYoloMsg(`Saved ${data.saved_images} images + annotations.json`)
      clearTimeout(yoloTimer.current)
      yoloTimer.current = setTimeout(() => setYoloMsg(null), 4000)
      if (fetchModelInfo) fetchModelInfo()
    } catch (e) {
      setYoloError(e.message)
    } finally {
      setYoloUploading(false)
    }
  }

  const isActive = training?.status === 'training'
  const canUpload = (occupiedFiles.length > 0 || vacantFiles.length > 0) && !uploading
  const canYoloUpload = yoloImages.length > 0 && yoloAnnotation !== null && !yoloUploading

  return (
    <div style={style.container}>
      <div className="section-title">🏋️ Training</div>

      {/* ── Classifier Images ────────────────────────────── */}
      <Collapsible label={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Classifier Images
          <Tooltip text={
            'Cropped images of individual parking spots.\n\nFor: CNN Scratch, ResNet-50, MobileNetV4, YOLO26 Classify\n\nExpected format:\n• One image per parking spot crop\n• Any common image format (jpg, png, bmp)\n• No minimum size — model resizes to 224×224\n\nDrop occupied and vacant crops separately into the two zones.'
          }>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'default', border: '1px solid var(--border-color)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>?</span>
          </Tooltip>
        </span>
      }>
        <div style={{ paddingTop: 8 }}>
          <div style={style.dropZoneRow}>
            <DropZone
              label="Occupied"
              files={occupiedFiles}
              onFiles={setOccupiedFiles}
              onClear={() => setOccupiedFiles([])}
            />
            <DropZone
              label="Vacant"
              files={vacantFiles}
              onFiles={setVacantFiles}
              onClear={() => setVacantFiles([])}
            />
          </div>

          <div style={style.row}>
            <button
              className="btn btn-primary btn-sm"
              disabled={!canUpload}
              onClick={handleUpload}
            >
              {uploading ? '⏳ Uploading…' : '⬆️ Upload'}
            </button>
          </div>

          {uploadMsg && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-vacant)', marginBottom: 6 }}>
              ✓ {uploadMsg}
            </div>
          )}
          {uploadError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-occupied)', marginBottom: 6 }}>
              ✗ {uploadError}
            </div>
          )}

          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            Dataset: {modelInfo?.occupied_count ?? '—'} occupied / {modelInfo?.vacant_count ?? '—'} vacant
          </div>
        </div>
      </Collapsible>

      {/* ── YOLO Detect Dataset ──────────────────────────── */}
      <Collapsible label={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          YOLO Detect Dataset
          <Tooltip text={
            'Full-scene parking lot images + annotation file.\n\nFor: YOLO26 Detect only\n\nExpected format:\n• images: full parking lot frames (jpg/png)\n• annotations.json — must contain "train", "valid", "test" splits, each with:\n  - file_names: [str, ...]\n  - rois_list: [[[x,y]×4], ...] (normalized quad polygons)\n  - occupancy_list: [[bool, ...], ...]\n\nImages are saved to:\n  data/yolo_data/parking_rois_gopro/images/\nAnnotations saved to:\n  data/yolo_data/parking_rois_gopro/annotations.json'
          }>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', cursor: 'default', border: '1px solid var(--border-color)', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>?</span>
          </Tooltip>
        </span>
      }>
        <div style={{ paddingTop: 8 }}>
          <div style={style.dropZoneRow}>
            {/* Images drop zone */}
            <YoloImagesZone files={yoloImages} onFiles={setYoloImages} onClear={() => setYoloImages([])} />
            {/* annotations.json drop zone */}
            <YoloAnnotationZone file={yoloAnnotation} onFile={setYoloAnnotation} onClear={() => setYoloAnnotation(null)} />
          </div>

          <div style={style.row}>
            <button
              className="btn btn-primary btn-sm"
              disabled={!canYoloUpload}
              onClick={handleYoloUpload}
            >
              {yoloUploading ? '⏳ Uploading…' : '⬆️ Upload'}
            </button>
          </div>

          {yoloMsg && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-vacant)', marginBottom: 6 }}>
              ✓ {yoloMsg}
            </div>
          )}
          {yoloError && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-occupied)', marginBottom: 6 }}>
              ✗ {yoloError}
            </div>
          )}
        </div>
      </Collapsible>

      {/* ── Data Augmentation ────────────────────────────── */}
      <Collapsible label="Data Augmentation">
        <DataAugmentPanel apiBase={apiBase} />
      </Collapsible>

      {/* ── Training controls ────────────────────────────── */}
      <Collapsible label="Train Model">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8 }}>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            className="panel-select"
            disabled={isActive}
          >
            {MODELS.map(({ id, label }) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <button
            className={`btn btn-sm ${(isActive ? training?.model_name : modelInfo?.active_model) === selectedModel ? 'btn-primary' : 'btn-ghost'}`}
            disabled={isActive}
            onClick={() => startTraining(selectedModel)}
          >
            🏋️ Train
          </button>
        </div>
      </Collapsible>

      {/* ── Training status ──────────────────────────────── */}
      {training && training.status !== 'idle' && (
        <div style={{ marginTop: 8 }}>
          <div style={style.stat}>
            <span>Status</span>
            <span className={`badge badge-${training.status === 'training' ? 'warning' : training.status === 'done' ? 'vacant' : 'occupied'}`}>
              {training.status}
            </span>
          </div>
          {isActive && (
            <>
              <div style={style.stat}>
                <span>Model</span>
                <span className="font-semibold">{training.model_name}</span>
              </div>
              <div style={style.stat}>
                <span>Epoch</span>
                <span>{training.epoch} / {training.total_epochs}</span>
              </div>
              <div style={style.stat}>
                <span>Val Accuracy</span>
                <span className="text-vacant font-bold">{training.val_acc}%</span>
              </div>
              <div style={style.stat}>
                <span>Val Loss</span>
                <span>{training.val_loss}</span>
              </div>
              <div style={style.stat}>
                <span>Elapsed</span>
                <span>{training.elapsed}s</span>
              </div>

              <div className="progress-bar" style={{ marginTop: 8 }}>
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${training.total_epochs ? (training.epoch / training.total_epochs * 100) : 0}%`,
                    background: 'var(--gradient-accent)',
                  }}
                />
              </div>
            </>
          )}
          <div style={{ ...style.logBox, marginTop: 8 }}>
            {training.message || 'Waiting...'}
          </div>
        </div>
      )}
    </div>
  )
}
