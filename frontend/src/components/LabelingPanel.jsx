import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch } from '../api'

// Two pre-labelers. Classification crops each saved ROI and calls it occupied or
// vacant. Detection annotates whole frames, which is the only mode that can
// represent a vehicle parked outside the marked bays. The server picks its own
// detector checkpoint, so there is no weights field here.
const MODES = [
  { id: 'classify', label: 'Classification (CNN)' },
  { id: 'detect',   label: 'Detection (YOLO)'     },
]

// Auto-labeling uses the classifier as a pre-labeler — detector head excluded.
const MODELS = [
  { id: 'cnn_scratch',      label: 'CNN Scratch'      },
  { id: 'resnet18',         label: 'ResNet-18'        },
  { id: 'resnet50',         label: 'ResNet-50'        },
  { id: 'mobilenetv4s',     label: 'MobileNetV4-S'    },
  { id: 'mobilenetv4m',     label: 'MobileNetV4-M'    },
  { id: 'yolo26n_classify', label: 'YOLO26n Classify' },
  { id: 'yolo26s_classify', label: 'YOLO26s Classify' },
  { id: 'yolo26m_classify', label: 'YOLO26m Classify' },
]

const BUCKETS = [
  { id: 'occupied', label: 'Occupied', color: 'var(--text-occupied, #e05a5a)' },
  { id: 'vacant',   label: 'Vacant',   color: 'var(--text-vacant, #3fbf6f)'   },
  { id: 'review',   label: 'Review',   color: '#d6a73a' },
  { id: 'too_dark', label: 'Too Dark', color: 'var(--text-secondary)' },
]

const loadLotIds = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem('berth_test_lots') || '[]')
    return Array.isArray(parsed) ? parsed.map(l => l.id).filter(Boolean) : []
  } catch { return [] }
}

// Crop endpoints require auth, so a plain <img src> 401s (no header). Fetch the
// blob with apiFetch (attaches the Bearer token) and render it via object URL.
function AuthedImg({ src, alt, onClick, style }) {
  const [objUrl, setObjUrl] = useState(null)
  useEffect(() => {
    let url = null, cancelled = false
    apiFetch(src)
      .then(r => (r.ok ? r.blob() : null))
      .then(blob => { if (blob && !cancelled) { url = URL.createObjectURL(blob); setObjUrl(url) } })
      .catch(() => {})
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [src])
  if (!objUrl) return <div style={{ ...style, background: 'var(--border-color)' }} />
  return <img src={objUrl} alt={alt} onClick={onClick} style={style} />
}

const labelStyle = { fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }
const fieldStyle = { width: '100%', padding: '6px 8px', fontSize: '0.8rem', marginBottom: 10,
  background: 'var(--bg-secondary, #1a1a1a)', color: 'var(--text-primary)',
  border: '1px solid var(--border-color)', borderRadius: 4 }

export default function LabelingPanel({ apiBase }) {
  const [mode, setMode] = useState('classify')
  const [lotId, setLotId] = useState('lot-t10lot')
  const [imageDir, setImageDir] = useState('')
  const [model, setModel] = useState('mobilenetv4s')
  const [conf, setConf] = useState(0.7)
  const [brightness, setBrightness] = useState(50)
  const [dateGlob, setDateGlob] = useState('2026-*')
  // Typed fields, so these hold strings while being edited and are coerced on submit.
  const [nFrames, setNFrames] = useState('200')
  const [detConf, setDetConf] = useState('0.25')
  const [vreport, setVreport] = useState(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState(null)
  const [calib, setCalib] = useState(null)
  const [calibLoading, setCalibLoading] = useState(false)
  const [manifest, setManifest] = useState(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [enlarged, setEnlarged] = useState(null)
  const pollRef = useRef(null)
  const knownLots = loadLotIds()

  const cropUrl = useCallback(
    (cropId) => `${apiBase}/api/label-batch/${lotId}/crop/${cropId}`,
    [apiBase, lotId],
  )

  const fetchManifest = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/manifest`)
      if (res.ok) setManifest(await res.json())
    } catch { /* none yet */ }
  }, [apiBase, lotId])

  const fetchVreport = useCallback(async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/vehicle-report`
        + `?image_dir=${encodeURIComponent(imageDir)}`)
      setVreport(res.ok ? await res.json() : null)
    } catch { setVreport(null) }
  }, [apiBase, lotId, imageDir])

  useEffect(() => { fetchManifest() }, [fetchManifest])
  useEffect(() => { fetchVreport() }, [fetchVreport])
  useEffect(() => () => clearInterval(pollRef.current), [])

  const poll = useCallback(() => {
    clearInterval(pollRef.current)  // idempotent: never stack two intervals
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`${apiBase}/api/status`)
        if (!res.ok) return
        const { operations } = await res.json()
        const op = operations.find(o => o.type === 'label_batch' && o.lot_id === lotId)
        if (op) {
          setProgress(op.progress || 0)
        } else {
          clearInterval(pollRef.current)
          setRunning(false)
          setProgress(1)
          // The op leaves /api/status whether the worker succeeded or crashed, so
          // confirm the outcome before declaring success.
          try {
            const lr = await apiFetch(`${apiBase}/api/label-batch/${lotId}/last-run`)
            const { ok, error } = lr.ok ? await lr.json() : {}
            if (ok === false) { setStatus(`✗ Labeling failed: ${error || 'unknown error'}`); return }
          } catch { /* fall through to success */ }
          fetchManifest()
          fetchVreport()
          setStatus('Labeling complete.')
        }
      } catch { /* keep polling */ }
    }, 1500)
  }, [apiBase, lotId, fetchManifest, fetchVreport])

  // Re-attach to a labeling run already in flight server-side (e.g. after a page
  // reload). The backend thread keeps running regardless of the browser and the
  // op stays in /api/status, so on mount we check for it and resume the progress
  // UI — mirroring TrainingPanel's resume-on-mount behavior.
  useEffect(() => {
    let cancelled = false
    apiFetch(`${apiBase}/api/status`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const op = data?.operations?.find(o => o.type === 'label_batch' && o.lot_id === lotId)
        if (op && !cancelled) {
          setRunning(true)
          setProgress(op.progress || 0)
          setStatus('Resuming in-progress labeling…')
          poll()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
    // Mount-only: reattach is about surviving a reload, not lotId changes.
  }, [])

  const runCalibrate = async () => {
    setCalibLoading(true); setStatus(null); setCalib(null)
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/calibrate?date_glob=${encodeURIComponent(dateGlob)}&sample=200&image_dir=${encodeURIComponent(imageDir)}`)
      const data = await res.json()
      if (!res.ok) { setStatus(`✗ ${data.detail || 'Calibration failed'}`); return }
      setCalib(data)
    } catch (e) { setStatus(`✗ ${e.message}`) }
    finally { setCalibLoading(false) }
  }

  const runBatch = async () => {
    setStatus(null); setProgress(0)
    const qs = `model_name=${model}&conf_threshold=${conf}&brightness_threshold=${brightness}&date_glob=${encodeURIComponent(dateGlob)}&image_dir=${encodeURIComponent(imageDir)}`
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}?${qs}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setStatus(`✗ ${data.detail || 'Failed to start'}`); return }
      setRunning(true)
      setStatus(`Running on ${data.image_count} images × ${data.roi_count} ROIs…`)
      poll()
    } catch (e) { setStatus(`✗ ${e.message}`) }
  }

  const runBootstrap = async () => {
    setStatus(null); setProgress(0)
    const n = Math.max(1, parseInt(nFrames, 10) || 200)
    const c = parseFloat(detConf) || 0.25
    const qs = `n_frames=${n}&conf=${c}&date_glob=${encodeURIComponent(dateGlob)}`
      + `&image_dir=${encodeURIComponent(imageDir)}`
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/bootstrap-vehicles?${qs}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setStatus(`✗ ${data.detail || 'Failed to start'}`); return }
      setRunning(true)
      setStatus(`Sampling ${data.sample_target} of ${data.image_count} frames…`)
      poll()
    } catch (e) { setStatus(`✗ ${e.message}`) }
  }

  const exportDetector = async () => {
    setStatus('Exporting detector dataset…')
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/export-detector`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setStatus(`✗ ${data.detail || 'Export failed'}`); return }
      const c = data.counts
      setStatus(`✓ Exported ${c.total_images} imgs (train ${c.train}/val ${c.valid}/test ${c.test}), ${c.total_labels} labels → ${data.dataset_yaml}`)
    } catch (e) { setStatus(`✗ ${e.message}`) }
  }

  const deleteCrop = async (cropId) => {
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/crop/${cropId}`, { method: 'DELETE' })
      if (res.ok) setManifest(m => ({ ...m, crops: m.crops.filter(c => c.crop_id !== cropId) }))
    } catch { /* ignore */ }
  }

  const reassignCrop = async (cropId, newStatus) => {
    try {
      const res = await apiFetch(`${apiBase}/api/label-batch/${lotId}/crop/${cropId}/reassign?status=${newStatus}`, { method: 'POST' })
      if (res.ok) setManifest(m => ({
        ...m,
        crops: m.crops.map(c => c.crop_id === cropId ? { ...c, bucket: newStatus, status: newStatus } : c),
      }))
    } catch { /* ignore */ }
  }

  const counts = manifest
    ? BUCKETS.reduce((acc, b) => ({ ...acc, [b.id]: manifest.crops.filter(c => c.bucket === b.id).length }), {})
    : {}
  const totalCrops = manifest ? manifest.crops.length : 0

  return (
    <div>
      <label style={labelStyle}>Pre-labeler</label>
      <select style={fieldStyle} value={mode} onChange={e => setMode(e.target.value)}>
        {MODES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>

      <label style={labelStyle}>{mode === 'classify'
        ? 'Lot ID (ROI set + output name)'
        : 'Lot ID (run label, and source folder if Image folder is blank)'}</label>
      <input style={fieldStyle} list="labeling-lots" value={lotId}
        onChange={e => setLotId(e.target.value)} placeholder="lot-t10lot" />
      <datalist id="labeling-lots">
        {knownLots.map(id => <option key={id} value={id} />)}
      </datalist>

      <label style={labelStyle}>Image folder (absolute path — blank = data/&lt;lotId&gt;)</label>
      <input style={fieldStyle} value={imageDir} onChange={e => setImageDir(e.target.value)}
        placeholder="D:\Documents\School Project\backend\data\t10lot" />

      {mode === 'classify' ? (
        <>
          <label style={labelStyle}>Classifier</label>
          <select style={fieldStyle} value={model} onChange={e => setModel(e.target.value)}>
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <label style={labelStyle}>Confidence threshold: {conf.toFixed(2)} (below → review)</label>
          <input type="range" min="0.5" max="0.99" step="0.01" value={conf}
            onChange={e => setConf(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: 12 }} />

          <label style={labelStyle}>Brightness threshold: {brightness} (below → too_dark)</label>
          <input type="range" min="10" max="120" step="1" value={brightness}
            onChange={e => setBrightness(parseInt(e.target.value))} style={{ width: '100%', marginBottom: 12 }} />
        </>
      ) : (
        <>
          <label style={labelStyle}>Frames to sample (capped at what the folder holds)</label>
          <input style={fieldStyle} type="number" min="1" step="10" value={nFrames}
            onChange={e => setNFrames(e.target.value)} placeholder="200" />

          <label style={labelStyle}>Confidence threshold (low = recall biased)</label>
          <input style={fieldStyle} type="number" min="0.01" max="0.95" step="0.05" value={detConf}
            onChange={e => setDetConf(e.target.value)} placeholder="0.25" />
        </>
      )}

      <label style={labelStyle}>Date filter (glob, matches subfolders only — loose files in the folder are always included)</label>
      <input style={fieldStyle} value={dateGlob} onChange={e => setDateGlob(e.target.value)} placeholder="2026-*" />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10,
        justifyContent: mode === 'classify' ? 'stretch' : 'center' }}>
        {mode === 'classify' && (
          <button className="btn btn-ghost btn-sm" onClick={runCalibrate}
            disabled={calibLoading || running} style={{ flex: 1 }}>
            {calibLoading ? 'Calibrating…' : 'Calibrate'}
          </button>
        )}
        <button className="btn btn-primary btn-sm"
          onClick={mode === 'classify' ? runBatch : runBootstrap}
          disabled={running}
          style={mode === 'classify' ? { flex: 1 } : { padding: '6px 20px' }}>
          {running ? `Running ${Math.round(progress * 100)}%`
            : mode === 'classify' ? 'Run labeling' : 'Run bootstrap'}
        </button>
      </div>

      {running && (
        <div style={{ height: 6, background: 'var(--border-color)', borderRadius: 3, marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`,
            background: 'var(--accent-primary)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
      )}

      {calib && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 10,
          padding: 8, border: '1px solid var(--border-color)', borderRadius: 4 }}>
          <div>ROI-area luminance (n={calib.sampled}/{calib.total_images}):
            min {calib.min} · p10 {calib.p10} · median {calib.median} · max {calib.max}</div>
          <div style={{ marginTop: 4 }}>too_dark count by threshold:&nbsp;
            {Object.entries(calib.below).map(([t, n]) => `<${t}:${n}`).join('  ')}</div>
          {calib.darkest_thumbnails?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {calib.darkest_thumbnails.map((t, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  <img src={t.image} alt="" style={{ height: 48, borderRadius: 3 }} />
                  <div>{t.brightness}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status && (
        <div style={{ fontSize: '0.74rem', marginBottom: 10, wordBreak: 'break-all',
          color: status.startsWith('✗') ? 'var(--text-occupied)' : 'var(--text-secondary)' }}>
          {status}
        </div>
      )}

      {mode === 'detect' && vreport && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 10,
          padding: 8, border: '1px solid var(--border-color)', borderRadius: 4 }}>
          <div>{vreport.n_selected} frames of {vreport.n_available} ·&nbsp;
            {Object.keys(vreport.day_hist).length} of {vreport.n_days} capture days ·&nbsp;
            train {vreport.split_counts.train || 0}/val {vreport.split_counts.val || 0}</div>
          <div style={{ marginTop: 4 }}>{vreport.total_boxes} boxes · mean {vreport.mean_boxes} per frame</div>
          <div style={{ marginTop: 4 }}>Frames per hour:&nbsp;
            {Object.entries(vreport.hour_hist)
              .sort((a, b) => a[0] - b[0])
              .map(([h, n]) => `${h.padStart(2, '0')}:${n}`).join('  ')}</div>
          {vreport.zero_detection.length > 0 && (
            <div style={{ marginTop: 4, color: '#d6a73a' }}>
              {vreport.zero_detection.length} frames with zero detections — empty lot or a
              detector failure, check each one.
            </div>
          )}
          <div style={{ marginTop: 4, wordBreak: 'break-all' }}>
            Frames and labels: <code>{vreport.out_root}</code>
          </div>
        </div>
      )}

      {mode === 'classify' && manifest && totalCrops > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: '0.72rem', marginBottom: 8 }}>
            {BUCKETS.map(b => (
              <span key={b.id} style={{ color: b.color }}>{b.label}: <b>{counts[b.id] || 0}</b></span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
              onClick={() => setGalleryOpen(true)}>Review gallery</button>
            <button className="btn btn-ghost btn-sm" style={{ flex: 1 }}
              onClick={exportDetector}>Export detector</button>
          </div>
        </>
      )}

      {galleryOpen && manifest && createPortal(
        <div onClick={() => setGalleryOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999,
            overflow: 'auto', padding: 20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ maxWidth: 1100, margin: '0 auto', background: 'var(--bg-primary, #111)',
              borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Review — {lotId} ({totalCrops} crops)</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setGalleryOpen(false)}>✕ Close</button>
            </div>
            {BUCKETS.map(b => {
              const items = manifest.crops.filter(c => c.bucket === b.id)
              if (!items.length) return null
              return (
                <div key={b.id} style={{ marginBottom: 24 }}>
                  <h4 style={{ color: b.color, marginBottom: 8 }}>{b.label} — {items.length}</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                    {items.slice(0, 400).map(c => (
                      <div key={c.crop_id} style={{ border: '1px solid var(--border-color)', borderRadius: 4, padding: 4 }}>
                        <AuthedImg src={cropUrl(c.crop_id)} alt={c.roi_label}
                          onClick={() => setEnlarged(cropUrl(c.crop_id))}
                          style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 3, cursor: 'pointer' }} />
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                          {c.roi_label}{c.confidence != null ? ` · ${Math.round(c.confidence * 100)}%` : ''}
                        </div>
                        <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
                          {b.id === 'review' && (
                            <>
                              <button title="Confirm occupied" onClick={() => reassignCrop(c.crop_id, 'occupied')}
                                style={{ flex: 1, fontSize: '0.6rem', cursor: 'pointer' }}>Occ</button>
                              <button title="Confirm vacant" onClick={() => reassignCrop(c.crop_id, 'vacant')}
                                style={{ flex: 1, fontSize: '0.6rem', cursor: 'pointer' }}>Vac</button>
                            </>
                          )}
                          <button title="Delete" onClick={() => deleteCrop(c.crop_id)}
                            style={{ flex: 1, fontSize: '0.6rem', cursor: 'pointer', color: 'var(--text-occupied)' }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {items.length > 400 && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                      Showing first 400 of {items.length}.
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {enlarged && (
            <div onClick={(e) => { e.stopPropagation(); setEnlarged(null) }}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 10000,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AuthedImg src={enlarged} alt="" style={{ maxWidth: '90%', maxHeight: '90%' }} />
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
