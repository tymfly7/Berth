import { useState, useEffect, useRef } from 'react'

const MODELS = [
  { id: 'cnn_scratch',     label: 'CNN Scratch'     },
  { id: 'resnet50',        label: 'ResNet-50'       },
  { id: 'mobilenetv4',     label: 'MobileNetV4'     },
  { id: 'yolo26_classify', label: 'YOLO26 Classify' },
  { id: 'yolo26_detect',   label: 'YOLO26 Detect'   },
]

const style = {
  container: { padding: '20px' },
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

export default function TrainingPanel({ apiAction, apiBase, modelInfo, fetchModelInfo }) {
  const [training, setTraining] = useState(null)
  const pollRef = useRef(null)
  const [occupiedFiles, setOccupiedFiles] = useState([])
  const [vacantFiles, setVacantFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [selectedModel, setSelectedModel] = useState('cnn_scratch')
  const msgTimer = useRef(null)

  const pollStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/api/train/status`)
      if (res.ok) {
        const data = await res.json()
        setTraining(data)
        if (data.status === 'training') {
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
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startTraining = async (modelName, compareAll = false) => {
    setTraining({ status: 'training', model_name: modelName })
    const endpoint = `/api/train/start?model_name=${modelName}&compare_all=${compareAll}`
    await apiAction(endpoint)
    pollStatus()
  }

  const generateSample = async () => {
    await apiAction('/api/dataset/prepare?generate_sample=true&sample_count=200')
  }

  const uploadZone = async (files, label) => {
    if (!files.length) return { saved: 0, skipped: 0 }
    const fd = new FormData()
    fd.append('label', label)
    files.forEach(f => fd.append('files', f))
    const res = await fetch(`${apiBase}/api/dataset/upload`, { method: 'POST', body: fd })
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

  const isActive = training?.status === 'training'
  const canUpload = (occupiedFiles.length > 0 || vacantFiles.length > 0) && !uploading

  return (
    <div className="glass-card" style={style.container}>
      <div className="section-title">🏋️ Training</div>

      {/* ── Training Dataset ─────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
          Training Dataset
        </div>

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

        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Dataset: {modelInfo?.occupied_count ?? '—'} occupied / {modelInfo?.vacant_count ?? '—'} vacant
        </div>
      </div>

      {/* ── Dataset prep ─────────────────────────────────── */}
      <div style={style.row}>
        <button className="btn btn-ghost btn-sm" onClick={generateSample}>
          📦 Generate Sample Data
        </button>
      </div>

      {/* ── Training controls ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
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
