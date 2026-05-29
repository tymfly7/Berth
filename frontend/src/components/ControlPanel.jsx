import { useState, useRef } from 'react'

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
  },
}

export default function ControlPanel({ apiAction, apiBase }) {
  const [status, setStatus] = useState('')
  const [dragging, setDragging] = useState(false)
  const [resultImage, setResultImage] = useState(null)
  const [resultData, setResultData] = useState(null)
  const fileRef = useRef(null)

  const handleAction = async (endpoint, label) => {
    setStatus(`${label}...`)
    const res = await apiAction(endpoint)
    setStatus(res?.message || 'Done')
    setResultImage(null)
    setResultData(null)
    setTimeout(() => setStatus(''), 4000)
  }

  const handleUpload = async (file) => {
    if (!file) return
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
      // Use analyze-lot for full parking lot analysis
      setStatus('Analyzing parking lot image...')
      const form = new FormData()
      form.append('file', file)

      try {
        const res = await fetch(`${apiBase}/api/analyze-lot?rows=3&cols=6`, {
          method: 'POST',
          body: form,
        })
        const data = await res.json()

        if (data.annotated_image) {
          setResultImage(data.annotated_image)
          setResultData(data)
          setStatus(
            `Analyzed ${data.total} zones: ${data.available} available, ` +
            `${data.occupied} occupied (${data.occupancy_percent}%)`
          )
        } else if (data.detail) {
          setStatus(`Error: ${data.detail}`)
        } else {
          setStatus(data.status ? `${data.status} (${(data.confidence * 100).toFixed(0)}% conf)` : 'Done')
        }
      } catch (e) {
        setStatus('Analysis failed')
      }
      setTimeout(() => setStatus(''), 15000)
    }
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleUpload(file)
  }

  return (
    <div className="glass-card" style={style.section}>
      <div className="section-title">Controls</div>

      {/* Mode buttons */}
      <div style={style.row}>
        <button className="btn btn-primary btn-sm"
                onClick={() => handleAction('/api/use-demo', 'Switching to demo')}>
          🎮 Demo
        </button>
        <button className="btn btn-ghost btn-sm"
                onClick={() => handleAction('/api/use-camera', 'Switching to camera')}>
          📷 Camera
        </button>
      </div>

      {/* Model selection */}
      <div className="section-title" style={{ marginTop: 4 }}>Model</div>
      <div style={style.row}>
        {['cnn_scratch', 'resnet18', 'mobilenetv2'].map((m) => (
          <div key={m} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => handleAction(`/api/use-model/${m}`, `Loading ${m}`)}>
              🧠 {m}
            </button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.72rem', padding: '4px 8px' }}
              onClick={() => handleAction(`/api/test-model/${m}`, `Testing ${m}`)}>
              Test
            </button>
          </div>
        ))}
      </div>

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
        📁 Drop any parking lot image here to analyze
        <br />
        <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>
          Works with aerial views, Google Images, screenshots, etc.
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.bmp,.mp4,.avi,.mov,.mkv,.webm"
          style={{ display: 'none' }}
          onChange={(e) => { handleUpload(e.target.files[0]); e.target.value = '' }}
        />
      </div>

      {status && <div style={style.statusMsg}>{status}</div>}

      {/* Annotated result image */}
      {resultImage && (
        <div style={{ marginTop: 12 }}>
          <img
            src={`data:image/jpeg;base64,${resultImage}`}
            alt="Analyzed parking lot"
            style={style.resultImg}
          />
          {resultData && (
            <div style={style.resultStats}>
              <span className="badge badge-vacant">🟢 {resultData.available} Available</span>
              <span className="badge badge-occupied">🔴 {resultData.occupied} Occupied</span>
              <span className="badge badge-info">📊 {resultData.occupancy_percent}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
