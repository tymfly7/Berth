import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'

function fmtDuration(sec) {
  if (sec == null) return '—'
  sec = Math.round(sec)
  const s = sec % 60
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const style = {
  container: { marginTop: 18 },
  modelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.8rem',
    cursor: 'pointer',
    userSelect: 'none',
  },
  dot: {
    width: 8, height: 8, borderRadius: '50%',
    display: 'inline-block', flexShrink: 0,
  },
  accordion: {
    padding: '8px 10px 10px',
    background: 'rgba(99,102,241,0.05)',
    borderRadius: '0 0 4px 4px',
    marginTop: -1,
    marginBottom: 2,
    fontSize: '0.75rem',
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    rowGap: 4,
    columnGap: 12,
  },
  compTable: {
    width: '100%',
    tableLayout: 'fixed',
    fontSize: '0.72rem',
    borderCollapse: 'collapse',
    marginTop: 8,
  },
  evalStatus: {
    marginTop: 8,
    padding: '6px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(99,102,241,0.1)',
    color: 'var(--accent-primary)',
    fontSize: '0.78rem',
  },
  progressBar: {
    height: 4,
    borderRadius: 2,
    background: 'var(--border-color)',
    marginTop: 6,
    overflow: 'hidden',
  },
  // "%" rendered on its own line beneath a metric header, so all columns align.
  pctSub: { display: 'block', fontWeight: 400, opacity: 0.6 },
}

function fmtTs(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// Derive the accordion summary fields from a raw per-epoch training history
// (mirrors backend src/reports/model_report.py). Accuracies are stored in %.
function summarizeHistory(h) {
  if (!h) return null
  const ta = h.train_acc || [], va = h.val_acc || []
  const tl = h.train_loss || [], vl = h.val_loss || []
  const et = h.epoch_times || []
  const last = (a) => (a.length ? a[a.length - 1] : null)
  return {
    epochs:           ta.length || va.length || null,
    final_train_acc:  last(ta),
    final_val_acc:    last(va),
    best_val_acc:     va.length ? Math.max(...va) : null,
    final_train_loss: last(tl),
    final_val_loss:   last(vl),
    total_time_s:     et.length ? et.reduce((s, x) => s + x, 0) : null,
  }
}

function DetailRow({ label, value, highlight }) {
  if (value == null) return null
  return (
    <>
      <span className="text-muted">{label}</span>
      <span style={highlight ? { color: 'var(--color-vacant)', fontWeight: 600 } : {}}>{value}</span>
    </>
  )
}

// Compact per-model results table, shared by the live benchmark view and the
// historical run view.
function CompResultsTable({ rows }) {
  const th = { textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }
  return (
    <table style={style.compTable}>
      <colgroup>
        <col style={{ width: '34%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <thead>
        <tr style={{ color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.06)', verticalAlign: 'top' }}>
          <th style={{ ...th, textAlign: 'left', padding: '5px 4px' }}>Model</th>
          <th style={th}>Acc/mAP<span style={style.pctSub}>%</span></th>
          <th style={th}>Prec<span style={style.pctSub}>%</span></th>
          <th style={th}>Rec<span style={style.pctSub}>%</span></th>
          <th style={{ ...th, padding: '5px 4px' }}>F1<span style={style.pctSub}>%</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.model} style={{ borderBottom: '1px solid var(--border-color)' }}>
            <td style={{ padding: '4px 4px', fontWeight: 600, fontSize: '0.72rem', overflowWrap: 'anywhere', lineHeight: 1.25 }} title={r.model}>{r.model}</td>
            <td style={{ padding: '4px 2px', textAlign: 'right', color: 'var(--color-vacant)', fontWeight: 600 }}>{r.test_accuracy != null ? r.test_accuracy.toFixed(1) : '—'}</td>
            <td style={{ padding: '4px 2px', textAlign: 'right' }}>{r.test_precision != null ? r.test_precision.toFixed(1) : '—'}</td>
            <td style={{ padding: '4px 2px', textAlign: 'right' }}>{r.test_recall != null ? r.test_recall.toFixed(1) : '—'}</td>
            <td style={{ padding: '4px 4px', textAlign: 'right' }}>{r.test_f1 != null ? r.test_f1.toFixed(1) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Vehicle detector results: baseline, confidence sweep, per-luminance bands.
// Its own table because these are mAP over boxes, not per-crop accuracy.
function DetectorResults({ result }) {
  const th = { textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }
  const td = { padding: '4px 2px', textAlign: 'right' }
  const num = (v) => (v != null ? v.toFixed(2) : '—')
  const b = result.baseline
  return (
    <div style={{ marginTop: 14, overflow: 'hidden' }}>
      <div className="section-title" style={{ marginBottom: 6 }}>
        Vehicle Detector — {result.label}
      </div>

      <div style={{ fontSize: '0.72rem', marginBottom: 6 }}>
        <span className="text-muted">Baseline (raw model output) </span>
        <span style={{ color: 'var(--color-vacant)', fontWeight: 600 }}>mAP@50 {num(b.map50)}%</span>
        <span className="text-muted"> · mAP@50-95 </span>{num(b.map50_95)}%
        <span className="text-muted"> · P </span>{num(b.precision)}%
        <span className="text-muted"> · R </span>{num(b.recall)}%
        <span className="text-muted"> · {result.images} frames, imgsz {result.imgsz}</span>
      </div>

      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Confidence sweep — post-filter. The baseline above is raw model output; the sweep
        applies the deployed path's minimum-area and maximum-aspect-ratio checks, so the two
        do not agree. The gap is the phantom detections those checks remove off painted bay
        markings, not a bug.
      </div>
      <table style={style.compTable}>
        <thead>
          <tr style={{ color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.06)', verticalAlign: 'top' }}>
            <th style={{ ...th, textAlign: 'left', padding: '5px 4px' }}>Conf</th>
            <th style={th}>Prec<span style={style.pctSub}>%</span></th>
            <th style={th}>Rec<span style={style.pctSub}>%</span></th>
            <th style={{ ...th, padding: '5px 4px' }}>F1<span style={style.pctSub}>%</span></th>
          </tr>
        </thead>
        <tbody>
          {result.sweep.points.map(p => {
            const isBest = p.conf === result.sweep.best_conf
            const isCfg  = p.conf === result.sweep.config_conf
            return (
              <tr key={p.conf} style={{
                borderBottom: '1px solid var(--border-color)',
                background: isBest ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <td style={{ padding: '4px 4px', fontWeight: isBest ? 700 : 400 }}>
                  {p.conf.toFixed(2)}
                  {isCfg && <span className="badge badge-info" style={{ marginLeft: 4, fontSize: '0.6rem', padding: '1px 4px' }}>CONFIG</span>}
                  {isBest && <span className="badge badge-vacant" style={{ marginLeft: 4, fontSize: '0.6rem', padding: '1px 4px' }}>BEST F1</span>}
                </td>
                <td style={td}>{num(p.precision)}</td>
                <td style={td}>{num(p.recall)}</td>
                <td style={{ ...td, padding: '4px 4px' }}>{num(p.f1)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 8 }}>
        Per luminance band (mean grayscale). Night is the hard case and a pooled mAP hides it.
      </div>
      <table style={style.compTable}>
        <thead>
          <tr style={{ color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.06)', verticalAlign: 'top' }}>
            <th style={{ ...th, textAlign: 'left', padding: '5px 4px' }}>Band</th>
            <th style={th}>Frames</th>
            <th style={th}>Boxes</th>
            <th style={th}>mAP@50<span style={style.pctSub}>%</span></th>
            <th style={{ ...th, padding: '5px 4px' }}>mAP@50-95<span style={style.pctSub}>%</span></th>
          </tr>
        </thead>
        <tbody>
          {result.bands.map(r => (
            <tr key={r.band} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td style={{ padding: '4px 4px', fontWeight: 600 }}>{r.band}</td>
              <td style={td}>{r.images}</td>
              <td style={td}>{r.instances}</td>
              <td style={{ ...td, color: 'var(--color-vacant)', fontWeight: 600 }}>{num(r.map50)}</td>
              <td style={{ ...td, padding: '4px 4px' }}>{num(r.map50_95)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ModelStatus({ modelInfo, fetchModelInfo, apiBase }) {
  const [expanded, setExpanded]     = useState(null)
  const [evalStatus, setEvalStatus] = useState(null)   // null | {status, message}
  const [exportStatus, setExportStatus] = useState(null)   // null | {status, message}
  const pollRef                     = useRef(null)
  const exportPollRef               = useRef(null)

  // Dataset to evaluate against: the internal split or an external benchmark.
  const [datasets, setDatasets]             = useState([{ id: 'standard', label: 'Standard split' }])
  const [selectedDataset, setSelectedDataset] = useState('standard')
  const [benchResult, setBenchResult]       = useState(null)   // null | { label, rows }

  // Vehicle detector evaluation — its own dataset list (single-class vehicle
  // datasets only) and its own results, kept out of the classifier comparison.
  const [detDatasets, setDetDatasets]         = useState([])
  const [selectedDetDataset, setSelectedDetDataset] = useState('standard')
  const [detBusy, setDetBusy]                 = useState(false)
  const [detResult, setDetResult]             = useState(null)   // null | {label, ...run()}
  const [detError, setDetError]               = useState(null)

  // Past-run history for the selected dataset.
  const [historySnapshots, setHistorySnapshots] = useState([])   // [{file, timestamp, count}]
  const [selectedRun, setSelectedRun]           = useState('')   // '' = Latest
  const [historyView, setHistoryView]           = useState(null) // null | {label, timestamp, rows}

  // Past training runs for whichever model accordion is expanded.
  const [trainHistory, setTrainHistory]         = useState([])   // [{file, timestamp, count}]
  const [selectedTrainRun, setSelectedTrainRun] = useState('')   // '' = none
  const [trainRunView, setTrainRunView]         = useState(null) // null | {timestamp, details}

  // Clean up polling on unmount
  useEffect(() => () => {
    clearTimeout(pollRef.current)
    clearTimeout(exportPollRef.current)
  }, [])

  // Load the list of evaluatable datasets (internal split + external benchmarks)
  useEffect(() => {
    let alive = true
    apiFetch(`${apiBase}/api/eval/datasets`)
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.datasets)) setDatasets(d.datasets) })
      .catch(() => {})
    return () => { alive = false }
  }, [apiBase])

  // Load the datasets the vehicle detector may be scored against.
  useEffect(() => {
    let alive = true
    apiFetch(`${apiBase}/api/eval/detector/datasets`)
      .then(r => r.json())
      .then(d => { if (alive && Array.isArray(d.datasets)) setDetDatasets(d.datasets) })
      .catch(() => {})
    return () => { alive = false }
  }, [apiBase])

  const refreshHistory = (dsId) =>
    apiFetch(`${apiBase}/api/eval/history?dataset=${encodeURIComponent(dsId)}`)
      .then(r => r.json())
      .then(d => setHistorySnapshots(Array.isArray(d.snapshots) ? d.snapshots : []))
      .catch(() => setHistorySnapshots([]))

  // Refresh the past-run list whenever the selected dataset changes; reset any
  // historical view back to "Latest".
  useEffect(() => {
    setSelectedRun('')
    setHistoryView(null)
    setBenchResult(null)   // the benchmark box belongs to a specific dataset
    refreshHistory(selectedDataset)
  }, [selectedDataset, apiBase])

  // Load a chosen past run ('' = Latest → clear the historical view).
  useEffect(() => {
    if (!selectedRun) { setHistoryView(null); return }
    let alive = true
    apiFetch(`${apiBase}/api/eval/history/item?file=${encodeURIComponent(selectedRun)}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return
        const ds = datasets.find(x => x.id === selectedDataset)
        setHistoryView({ label: ds?.label || selectedDataset, timestamp: d.timestamp, rows: d.results || [] })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [selectedRun])

  // Load archived training runs for whichever model accordion is expanded, and
  // reset any previously-selected run. Only torch classifiers archive these, so
  // the list stays empty (and the picker hidden) for YOLO classify models.
  useEffect(() => {
    setSelectedTrainRun('')
    setTrainRunView(null)
    if (!expanded) { setTrainHistory([]); return }
    let alive = true
    apiFetch(`${apiBase}/api/train/history?model=${encodeURIComponent(expanded)}`)
      .then(r => r.json())
      .then(d => { if (alive) setTrainHistory(Array.isArray(d.snapshots) ? d.snapshots : []) })
      .catch(() => { if (alive) setTrainHistory([]) })
    return () => { alive = false }
  }, [expanded, apiBase])

  // Load a chosen past training run ('' = none) and derive its summary.
  useEffect(() => {
    if (!selectedTrainRun) { setTrainRunView(null); return }
    let alive = true
    apiFetch(`${apiBase}/api/train/history/item?file=${encodeURIComponent(selectedTrainRun)}`)
      .then(r => r.json())
      .then(d => { if (alive) setTrainRunView({ timestamp: d.timestamp, details: summarizeHistory(d.history) }) })
      .catch(() => {})
    return () => { alive = false }
  }, [selectedTrainRun])

  if (!modelInfo) {
    return (
      <div className="loading-shimmer" style={{ marginTop: 18, height: 120 }}>
        <div className="section-title">Model Info</div>
      </div>
    )
  }

  const isEdge = modelInfo.deployment_profile === 'edge'

  const models = [
    { name: 'cnn_scratch',      label: 'CNN Scratch',       available: modelInfo.available_models?.cnn_scratch      },
    { name: 'resnet18',         label: 'ResNet-18',         available: modelInfo.available_models?.resnet18         },
    { name: 'resnet50',         label: 'ResNet-50',         available: modelInfo.available_models?.resnet50         },
    { name: 'mobilenetv4s',     label: 'MobileNetV4-S',     available: modelInfo.available_models?.mobilenetv4s     },
    { name: 'mobilenetv4m',     label: 'MobileNetV4-M',     available: modelInfo.available_models?.mobilenetv4m     },
    { name: 'yolo26n_classify', label: 'YOLO26n Classify',  available: modelInfo.available_models?.yolo26n_classify },
    { name: 'yolo26s_classify', label: 'YOLO26s Classify',  available: modelInfo.available_models?.yolo26s_classify },
    { name: 'yolo26m_classify', label: 'YOLO26m Classify',  available: modelInfo.available_models?.yolo26m_classify },
  ]

  const toggle = (name) => setExpanded(prev => prev === name ? null : name)

  // ── Evaluate All ────────────────────────────────────────────────────────────
  const pollEvalStatus = async () => {
    try {
      const res  = await apiFetch(`${apiBase}/api/train/status`)
      const data = await res.json()
      setEvalStatus(data)
      if (data.status === 'training') {
        pollRef.current = setTimeout(pollEvalStatus, 2000)
      } else {
        // Done or error — refresh model info so comparison table updates
        fetchModelInfo?.()
        // External benchmark results aren't written to the standard comparison,
        // so capture them from the live status for a dedicated results block.
        if (data.status === 'done' && selectedDataset !== 'standard' && Array.isArray(data.comparison)) {
          const ds = datasets.find(d => d.id === selectedDataset)
          setBenchResult({ label: ds?.label || selectedDataset, rows: data.comparison })
        }
        if (data.status === 'done') {
          refreshHistory(selectedDataset)   // the new run is now archived
          setTimeout(() => setEvalStatus(null), 5000)
        }
      }
    } catch {
      clearTimeout(pollRef.current)
    }
  }

  const handleEvaluateAll = async () => {
    setBenchResult(null)
    setEvalStatus({ status: 'training', message: 'Starting evaluation…' })
    try {
      await apiFetch(`${apiBase}/api/evaluate/all?dataset=${encodeURIComponent(selectedDataset)}`, { method: 'POST' })
      pollEvalStatus()
    } catch (e) {
      setEvalStatus({ status: 'error', message: String(e) })
    }
  }

  // ── Evaluate Detector ───────────────────────────────────────────────────────
  // Runs synchronously on the server (a val pass plus one per luminance band),
  // so the button simply waits for the response.
  const handleEvaluateDetector = async () => {
    setDetBusy(true)
    setDetError(null)
    setDetResult(null)
    try {
      const res = await apiFetch(
        `${apiBase}/api/evaluate/detector?dataset=${encodeURIComponent(selectedDetDataset)}`,
        { method: 'POST' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`)
      const ds = detDatasets.find(d => d.id === selectedDetDataset)
      setDetResult({ label: ds?.label || selectedDetDataset, ...data })
    } catch (e) {
      setDetError(String(e.message || e))
    } finally {
      setDetBusy(false)
    }
  }

  // ── Export NCNN ─────────────────────────────────────────────────────────────
  const pollExportStatus = async () => {
    try {
      const res  = await apiFetch(`${apiBase}/api/export/status`)
      const data = await res.json()
      setExportStatus(data)
      if (data.status === 'running') {
        exportPollRef.current = setTimeout(pollExportStatus, 2000)
      } else {
        // Done or error — refresh model info so 'Deployed' badges update
        fetchModelInfo?.()
        if (data.status === 'done') {
          setTimeout(() => setExportStatus(null), 5000)
        }
      }
    } catch {
      clearTimeout(exportPollRef.current)
    }
  }

  const handleExportNcnn = async () => {
    setExportStatus({ status: 'running', message: 'Starting export…' })
    try {
      await apiFetch(`${apiBase}/api/export/ncnn`, { method: 'POST' })
      pollExportStatus()
    } catch (e) {
      setExportStatus({ status: 'error', message: String(e) })
    }
  }

  const handleDownloadExcel = async () => {
    try {
      // A chosen past run exports that snapshot; "Latest" exports the canonical file.
      const qs = selectedRun
        ? `file=${encodeURIComponent(selectedRun)}`
        : `dataset=${encodeURIComponent(selectedDataset)}`
      const res = await apiFetch(`${apiBase}/api/evaluate/excel?${qs}`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = selectedRun
        ? `model_comparison_${selectedRun.replace(/\.json$/, '')}.xlsx`
        : (selectedDataset === 'standard' ? 'model_comparison.xlsx' : `model_comparison_${selectedDataset}.xlsx`)
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Download failed: ${e.message}`)
    }
  }

  const isEvaluating  = evalStatus?.status === 'training'
  const isExporting   = exportStatus?.status === 'running'
  const hasComparison = modelInfo.comparison && modelInfo.comparison.length > 0
  // A loaded past run is always exportable; otherwise the standard split uses the
  // canonical comparison and an external dataset needs its benchmark box showing.
  const canDownloadExcel = !!historyView || (selectedDataset === 'standard' ? hasComparison : !!benchResult)
  const classRows     = modelInfo.comparison?.filter(r => r.type !== 'detection') ?? []
  const detectRows    = modelInfo.comparison?.filter(r => r.type === 'detection')  ?? []

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={style.container}>
      <div className="section-title">Model Info</div>

      {!isEdge && (
        <div style={{ ...style.modelRow, cursor: 'default' }}>
          <span className="text-muted">Dataset Ready</span>
          <span className={`badge ${modelInfo.dataset_ready ? 'badge-vacant' : 'badge-occupied'}`}>
            {modelInfo.dataset_ready ? `Yes (${modelInfo.dataset_count} images)` : 'No'}
          </span>
        </div>
      )}

      {/* Per-model rows */}
      {models.map((m) => {
        const isActive   = modelInfo.active_model === m.name
        const isOpen     = expanded === m.name
        const details    = modelInfo.model_details?.[m.name]
        const compResult = modelInfo.comparison?.find(c => c.model === m.name)
        const hasDetails = details || compResult

        return (
          <div key={m.name}>
            <div
              style={{
                ...style.modelRow,
                background: isActive ? 'rgba(99,102,241,0.08)' : 'transparent',
                borderRadius: isActive && !isOpen ? 4 : 0,
                padding: isActive ? '8px 6px' : undefined,
              }}
              onClick={() => toggle(m.name)}
              title="Click for training details"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  ...style.dot,
                  background: m.available ? 'var(--color-vacant)' : 'var(--color-occupied)',
                }} />
                <span style={{ fontWeight: isActive ? 600 : 400 }}>{m.label}</span>
                {isActive && (
                  <span className="badge badge-info" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>Active</span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  className={`badge ${m.available ? 'badge-vacant' : 'badge-occupied'}`}
                  style={{ fontSize: '0.65rem', padding: '1px 6px' }}
                >
                  {m.available ? (isEdge ? 'Deployed' : 'Trained') : (isEdge ? 'Not deployed' : 'Not trained')}
                </span>
                {hasDetails && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', lineHeight: 1 }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                )}
              </div>
            </div>

            {/* Accordion */}
            {isOpen && (
              <div style={style.accordion}>
                {!hasDetails ? (
                  <span className="text-muted" style={{ fontSize: '0.72rem' }}>No training data available yet.</span>
                ) : (
                  <div style={style.detailGrid}>
                    <DetailRow label="Epochs"        value={details?.epochs} />
                    <DetailRow label="Train Acc"     value={details?.final_train_acc  != null ? `${details.final_train_acc.toFixed(1)}%`  : null} />
                    <DetailRow label="Val Acc"       value={details?.final_val_acc    != null ? `${details.final_val_acc.toFixed(1)}%`    : null} highlight />
                    <DetailRow label="Best Val Acc"  value={details?.best_val_acc     != null ? `${details.best_val_acc.toFixed(1)}%`     : null} highlight />
                    <DetailRow label="Train Loss"    value={details?.final_train_loss != null ? details.final_train_loss.toFixed(4)       : null} />
                    <DetailRow label="Val Loss"      value={details?.final_val_loss   != null ? details.final_val_loss.toFixed(4)         : null} />
                    {/* YOLO detect */}
                    <DetailRow label="mAP@50"        value={details?.map50      != null ? `${details.map50.toFixed(1)}%`      : null} highlight />
                    <DetailRow label="Precision"     value={details?.precision  != null ? `${details.precision.toFixed(1)}%`  : null} />
                    <DetailRow label="Recall"        value={details?.recall     != null ? `${details.recall.toFixed(1)}%`     : null} />
                    <DetailRow label="Train Time"    value={details?.total_time_s != null ? fmtDuration(details.total_time_s) : null} />
                    {/* From comparison evaluation */}
                    <DetailRow label={compResult?.type === 'detection' ? 'mAP@50' : 'Test Acc'} value={compResult?.test_accuracy  != null ? `${compResult.test_accuracy.toFixed(1)}%`  : null} highlight />
                    <DetailRow label="Precision"     value={compResult?.test_precision != null ? `${compResult.test_precision.toFixed(1)}%` : null} />
                    <DetailRow label="Recall"        value={compResult?.test_recall    != null ? `${compResult.test_recall.toFixed(1)}%`    : null} />
                    <DetailRow label="F1 Score"      value={compResult?.test_f1        != null ? `${compResult.test_f1.toFixed(1)}%`        : null} />
                  </div>
                )}

                {/* Past training runs — browse an archived curve by date/time */}
                {trainHistory.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Past training:</span>
                      <select
                        className="panel-select"
                        style={{ fontSize: '0.72rem', padding: '3px 8px' }}
                        value={selectedTrainRun}
                        onChange={e => setSelectedTrainRun(e.target.value)}
                        title="Browse a past training run"
                      >
                        <option value="">Latest</option>
                        {trainHistory.map(s => (
                          <option key={s.file} value={s.file}>{fmtTs(s.timestamp)}</option>
                        ))}
                      </select>
                    </div>
                    {trainRunView?.details && (
                      <div style={{ marginTop: 8 }}>
                        <div className="text-muted" style={{ fontSize: '0.68rem', marginBottom: 4 }}>
                          Training run — {fmtTs(trainRunView.timestamp)}
                        </div>
                        <div style={style.detailGrid}>
                          <DetailRow label="Epochs"        value={trainRunView.details.epochs} />
                          <DetailRow label="Train Acc"     value={trainRunView.details.final_train_acc  != null ? `${trainRunView.details.final_train_acc.toFixed(1)}%`  : null} />
                          <DetailRow label="Val Acc"       value={trainRunView.details.final_val_acc    != null ? `${trainRunView.details.final_val_acc.toFixed(1)}%`    : null} highlight />
                          <DetailRow label="Best Val Acc"  value={trainRunView.details.best_val_acc     != null ? `${trainRunView.details.best_val_acc.toFixed(1)}%`     : null} highlight />
                          <DetailRow label="Train Loss"    value={trainRunView.details.final_train_loss != null ? trainRunView.details.final_train_loss.toFixed(4)       : null} />
                          <DetailRow label="Val Loss"      value={trainRunView.details.final_val_loss   != null ? trainRunView.details.final_val_loss.toFixed(4)         : null} />
                          <DetailRow label="Train Time"    value={trainRunView.details.total_time_s     != null ? fmtDuration(trainRunView.details.total_time_s)          : null} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Export NCNN — own row, separate from evaluation controls ─────────── */}
      {!isEdge && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            disabled={isExporting}
            onClick={handleExportNcnn}
            title="Export trained models to NCNN for edge deployment"
          >
            {isExporting ? 'Exporting…' : 'Export NCNN'}
          </button>
        </div>
      )}

      {/* ── Evaluate All + Excel ────────────────────────────────────────────── */}
      {!isEdge && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
          {canDownloadExcel && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={handleDownloadExcel}
              title="Download results as Excel"
            >
              Excel
            </button>
          )}
          <select
            className="panel-select"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            value={selectedDataset}
            disabled={isEvaluating}
            onChange={e => setSelectedDataset(e.target.value)}
            title="Dataset to evaluate against"
          >
            {datasets.map(d => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <button
            className="btn btn-ghost-blue btn-sm"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            disabled={isEvaluating}
            onClick={handleEvaluateAll}
          >
            {isEvaluating ? 'Evaluating…' : 'Evaluate All'}
          </button>
        </div>
      )}

      {/* ── Evaluate Detector — separate from the classifier evaluation ──────── */}
      {!isEdge && detDatasets.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
          <select
            className="panel-select"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            value={selectedDetDataset}
            disabled={detBusy}
            onChange={e => setSelectedDetDataset(e.target.value)}
            title="Single-class vehicle detection dataset to score against"
          >
            {detDatasets.map(d => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <button
            className="btn btn-ghost-blue btn-sm"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            disabled={detBusy}
            onClick={handleEvaluateDetector}
            title="Baseline mAP, confidence sweep and per-luminance-band mAP for the vehicle detector"
          >
            {detBusy ? 'Evaluating…' : 'Evaluate Detector'}
          </button>
        </div>
      )}

      {detError && (
        <div style={{
          ...style.evalStatus,
          color: 'var(--color-occupied)',
          background: 'rgba(244,63,94,0.1)',
        }}>
          {detError}
        </div>
      )}

      {detResult && <DetectorResults result={detResult} />}

      {/* Export progress */}
      {exportStatus && (
        <div style={{
          ...style.evalStatus,
          color: exportStatus.status === 'error' ? 'var(--color-occupied)' : 'var(--accent-primary)',
          background: exportStatus.status === 'error' ? 'rgba(244,63,94,0.1)' : 'rgba(99,102,241,0.1)',
        }}>
          {exportStatus.message}
          {isExporting && (
            <div style={style.progressBar}>
              <div style={{
                width: '100%',
                height: '100%',
                background: 'var(--gradient-accent)',
                animation: 'indeterminate 1.4s infinite ease-in-out',
                transformOrigin: 'left',
              }} />
            </div>
          )}
        </div>
      )}

      {/* Evaluation progress */}
      {evalStatus && (
        <div style={{
          ...style.evalStatus,
          color: evalStatus.status === 'error' ? 'var(--color-occupied)' : 'var(--accent-primary)',
          background: evalStatus.status === 'error' ? 'rgba(244,63,94,0.1)' : 'rgba(99,102,241,0.1)',
        }}>
          {evalStatus.message}
          {isEvaluating && (
            <div style={style.progressBar}>
              <div style={{
                width: '100%',
                height: '100%',
                background: 'var(--gradient-accent)',
                animation: 'indeterminate 1.4s infinite ease-in-out',
                transformOrigin: 'left',
              }} />
            </div>
          )}
        </div>
      )}

      {/* ── Past-run history picker (date/time) ─────────────────────────────── */}
      {!isEdge && historySnapshots.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span className="text-muted" style={{ fontSize: '0.7rem' }}>Past runs:</span>
          <select
            className="panel-select"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            value={selectedRun}
            onChange={e => setSelectedRun(e.target.value)}
            title="Browse a past evaluation run"
          >
            <option value="">Latest</option>
            {historySnapshots.map(s => (
              <option key={s.file} value={s.file}>{fmtTs(s.timestamp)} · {s.count} models</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Historical run view (a past snapshot chosen above) ──────────────── */}
      {historyView && (
        <div style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Past run — {historyView.label} · {fmtTs(historyView.timestamp)}
          </div>
          <CompResultsTable rows={historyView.rows} />
        </div>
      )}

      {/* ── External benchmark results (kept separate from the standard split) ── */}
      {benchResult && (
        <div style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="section-title" style={{ marginBottom: 6 }}>
            Benchmark — {benchResult.label}
          </div>
          <CompResultsTable rows={benchResult.rows} />
        </div>
      )}

      {/* ── Overall comparison table ────────────────────────────────────────── */}
      {hasComparison && (
        <div style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="section-title" style={{ marginBottom: 6 }}>Evaluation Results</div>
          <table style={style.compTable}>
            <colgroup>
              <col style={{ width: '32%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.06)', verticalAlign: 'top' }}>
                <th style={{ textAlign: 'left',  padding: '5px 4px', borderBottom: '1px solid var(--border-color)' }}>Model</th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Acc<span style={style.pctSub}>%</span></th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Prec<span style={style.pctSub}>%</span></th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Rec<span style={style.pctSub}>%</span></th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>F1<span style={style.pctSub}>%</span></th>
                <th style={{ textAlign: 'right', padding: '5px 4px', borderBottom: '1px solid var(--border-color)' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {classRows.map((r) => {
                const isActive  = modelInfo.active_model === r.model
                const hasPRF    = r.test_precision != null || r.test_recall != null || r.test_f1 != null
                return (
                  <tr
                    key={r.model}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      background: isActive ? 'rgba(99,102,241,0.08)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '4px 4px', fontWeight: isActive ? 700 : 600, fontSize: '0.72rem', overflowWrap: 'anywhere', lineHeight: 1.25 }}
                        title={r.model}>
                      {r.model}
                      {isActive && <span className="badge badge-info" style={{ marginLeft: 4, fontSize: '0.6rem', padding: '1px 4px' }}>ACTIVE</span>}
                    </td>
                    <td style={{ padding: '4px 2px', textAlign: 'right', color: 'var(--color-vacant)', fontWeight: 600 }}>
                      {r.test_accuracy != null ? r.test_accuracy.toFixed(1) : '—'}
                    </td>
                    {hasPRF ? (
                      <>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_precision != null ? r.test_precision.toFixed(1) : '—'}
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_recall != null ? r.test_recall.toFixed(1) : '—'}
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_f1 != null ? r.test_f1.toFixed(1) : '—'}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} style={{ padding: '4px 2px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.65rem', fontStyle: 'italic' }}>
                        top-1{r.epochs != null ? ` · ${r.epochs} ep` : ''}
                      </td>
                    )}
                    <td style={{ padding: '4px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {fmtDuration(r.train_time)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* ── YOLO26 Detect — separate section (uses mAP@50, not classification accuracy) */}
          {detectRows.map(r => (
            <div key={r.model} style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'rgba(99,102,241,0.05)',
              borderRadius: 4,
              fontSize: '0.72rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>YOLO26 Detect</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>object detection model</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px' }}>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>mAP@50 </span>
                  <span style={{ color: 'var(--color-vacant)', fontWeight: 600 }}>
                    {r.test_accuracy != null ? `${r.test_accuracy.toFixed(1)}%` : '—'}
                  </span>
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>P </span>
                  {r.test_precision != null ? `${r.test_precision.toFixed(1)}%` : '—'}
                </span>
                <span>
                  <span style={{ color: 'var(--text-muted)' }}>R </span>
                  {r.test_recall != null ? `${r.test_recall.toFixed(1)}%` : '—'}
                </span>
                {r.train_time != null && (
                  <span style={{ color: 'var(--text-muted)' }}>{fmtDuration(r.train_time)}</span>
                )}
              </div>
            </div>
          ))}

          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Classifiers: test set accuracy · YOLO26 Detect: mAP@50 on parking detection test split
          </div>
        </div>
      )}
    </div>
  )
}
