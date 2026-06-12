import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'

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

export default function ModelStatus({ modelInfo, fetchModelInfo, apiBase }) {
  const [expanded, setExpanded]     = useState(null)
  const [evalStatus, setEvalStatus] = useState(null)   // null | {status, message}
  const pollRef                     = useRef(null)

  // Clean up polling on unmount
  useEffect(() => () => clearTimeout(pollRef.current), [])

  if (!modelInfo) {
    return (
      <div className="loading-shimmer" style={{ marginTop: 18, height: 120 }}>
        <div className="section-title">Model Info</div>
      </div>
    )
  }

  const models = [
    { name: 'cnn_scratch',     label: 'CNN Scratch',      available: modelInfo.available_models?.cnn_scratch     },
    { name: 'resnet50',        label: 'ResNet-50',        available: modelInfo.available_models?.resnet50        },
    { name: 'mobilenetv4s',    label: 'MobileNetV4',      available: modelInfo.available_models?.mobilenetv4s    },
    { name: 'yolo26_classify', label: 'YOLO26 Classify',  available: modelInfo.available_models?.yolo26_classify },
    { name: 'yolo26',          label: 'YOLO26 Detect',    available: modelInfo.available_models?.yolo26          },
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
        if (data.status === 'done') {
          setTimeout(() => setEvalStatus(null), 5000)
        }
      }
    } catch {
      clearTimeout(pollRef.current)
    }
  }

  const handleEvaluateAll = async () => {
    setEvalStatus({ status: 'training', message: 'Starting evaluation…' })
    try {
      await apiFetch(`${apiBase}/api/evaluate/all`, { method: 'POST' })
      pollEvalStatus()
    } catch (e) {
      setEvalStatus({ status: 'error', message: String(e) })
    }
  }

  const handleDownloadExcel = async () => {
    try {
      const res = await apiFetch(`${apiBase}/api/evaluate/excel`)
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'model_comparison.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`Download failed: ${e.message}`)
    }
  }

  const isEvaluating  = evalStatus?.status === 'training'
  const hasComparison = modelInfo.comparison && modelInfo.comparison.length > 0
  const classRows     = modelInfo.comparison?.filter(r => r.type !== 'detection') ?? []
  const detectRows    = modelInfo.comparison?.filter(r => r.type === 'detection')  ?? []

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={style.container}>
      <div className="section-title">Model Info</div>

      <div style={{ ...style.modelRow, cursor: 'default' }}>
        <span className="text-muted">Dataset Ready</span>
        <span className={`badge ${modelInfo.dataset_ready ? 'badge-vacant' : 'badge-occupied'}`}>
          {modelInfo.dataset_ready ? `Yes (${modelInfo.dataset_count} images)` : 'No'}
        </span>
      </div>

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
                  {m.available ? 'Trained' : 'Not trained'}
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
                    <DetailRow label="Train Time"    value={details?.total_time_s != null ? `${Math.round(details.total_time_s)}s` : null} />
                    {/* From comparison evaluation */}
                    <DetailRow label={compResult?.type === 'detection' ? 'mAP@50' : 'Test Acc'} value={compResult?.test_accuracy  != null ? `${compResult.test_accuracy.toFixed(1)}%`  : null} highlight />
                    <DetailRow label="Precision"     value={compResult?.test_precision != null ? `${compResult.test_precision.toFixed(1)}%` : null} />
                    <DetailRow label="Recall"        value={compResult?.test_recall    != null ? `${compResult.test_recall.toFixed(1)}%`    : null} />
                    <DetailRow label="F1 Score"      value={compResult?.test_f1        != null ? `${compResult.test_f1.toFixed(1)}%`        : null} />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* ── Evaluate All + Excel ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        {hasComparison && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            onClick={handleDownloadExcel}
            title="Download results as Excel"
          >
            Excel
          </button>
        )}
        <button
          className="btn btn-ghost-blue btn-sm"
          style={{ fontSize: '0.72rem', padding: '3px 8px' }}
          disabled={isEvaluating}
          onClick={handleEvaluateAll}
        >
          {isEvaluating ? 'Evaluating…' : 'Evaluate All'}
        </button>
      </div>

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

      {/* ── Overall comparison table ────────────────────────────────────────── */}
      {hasComparison && (
        <div style={{ marginTop: 14, overflow: 'hidden' }}>
          <div className="section-title" style={{ marginBottom: 6 }}>Evaluation Results</div>
          <table style={style.compTable}>
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', background: 'rgba(99,102,241,0.06)' }}>
                <th style={{ textAlign: 'left',  padding: '5px 4px', borderBottom: '1px solid var(--border-color)' }}>Model</th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Acc</th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Prec</th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>Rec</th>
                <th style={{ textAlign: 'right', padding: '5px 2px', borderBottom: '1px solid var(--border-color)' }}>F1</th>
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
                    <td style={{ padding: '4px 4px', fontWeight: isActive ? 700 : 600, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0 }}
                        title={r.model}>
                      {r.model}
                      {isActive && <span className="badge badge-info" style={{ marginLeft: 4, fontSize: '0.6rem', padding: '1px 4px' }}>ACTIVE</span>}
                    </td>
                    <td style={{ padding: '4px 2px', textAlign: 'right', color: 'var(--color-vacant)', fontWeight: 600 }}>
                      {r.test_accuracy != null ? `${r.test_accuracy.toFixed(1)}%` : '—'}
                    </td>
                    {hasPRF ? (
                      <>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_precision != null ? `${r.test_precision.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_recall != null ? `${r.test_recall.toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '4px 2px', textAlign: 'right' }}>
                          {r.test_f1 != null ? `${r.test_f1.toFixed(1)}%` : '—'}
                        </td>
                      </>
                    ) : (
                      <td colSpan={3} style={{ padding: '4px 2px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.65rem', fontStyle: 'italic' }}>
                        top-1{r.epochs != null ? ` · ${r.epochs} ep` : ''}
                      </td>
                    )}
                    <td style={{ padding: '4px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {r.train_time != null ? `${Math.round(r.train_time)}s` : '—'}
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
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
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
                  <span style={{ color: 'var(--text-muted)' }}>{Math.round(r.train_time)}s</span>
                )}
              </div>
            </div>
          ))}

          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Classifiers: PKLot test set accuracy · YOLO26 Detect: mAP@50 on parking detection test split
          </div>
        </div>
      )}
    </div>
  )
}
