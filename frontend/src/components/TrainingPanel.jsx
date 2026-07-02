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

function fmtElapsed(sec) {
  if (sec == null) return '—'
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
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
}

export default function TrainingPanel({ apiAction, apiBase, modelInfo }) {
  const [training, setTraining] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const pollRef = useRef(null)
  const [selectedModel, setSelectedModel] = useState('cnn_scratch')

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
    }
  }, [])

  const startTraining = async (modelName, compareAll = false) => {
    setCancelling(false)
    setTraining({ status: 'training', model_name: modelName })
    const endpoint = `/api/train/start?model_name=${modelName}&compare_all=${compareAll}`
    await apiAction(endpoint)
    pollStatus()
  }

  const cancelTraining = async () => {
    if (!window.confirm('Stop the current training session? The best checkpoint so far is kept.')) return
    setCancelling(true)
    await apiAction('/api/train/cancel')
    pollStatus()
  }

  const isActive = training?.status === 'training'

  return (
    <div style={style.container}>
      <div className="section-title">Training</div>

      {/* ── Data Augmentation ────────────────────────────── */}
      <Collapsible label="Augmentation preview (geometric only)">
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
            Train
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
                <span>{fmtElapsed(training.elapsed)}</span>
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

              <button
                className="btn btn-sm btn-danger"
                style={{ marginTop: 8, width: '100%' }}
                disabled={cancelling}
                onClick={cancelTraining}
              >
                {cancelling ? 'Cancelling…' : 'Stop Training'}
              </button>
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
