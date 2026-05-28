import { useState, useEffect, useRef } from 'react'

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
}

export default function TrainingPanel({ apiAction, apiBase }) {
  const [training, setTraining] = useState(null)
  const pollRef = useRef(null)

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
    return () => clearTimeout(pollRef.current)
  }, [])

  const startTraining = async (modelName, compareAll = false) => {
    const endpoint = `/api/train/start?model_name=${modelName}&compare_all=${compareAll}`
    await apiAction(endpoint)
    pollStatus()
  }

  const generateSample = async () => {
    await apiAction('/api/dataset/prepare?generate_sample=true&sample_count=200')
  }

  const isActive = training?.status === 'training'

  return (
    <div className="glass-card" style={style.container}>
      <div className="section-title">🏋️ Training</div>

      {/* Dataset prep */}
      <div style={style.row}>
        <button className="btn btn-ghost btn-sm" onClick={generateSample}>
          📦 Generate Sample Data
        </button>
      </div>

      {/* Training controls */}
      <div style={style.row}>
        <button className="btn btn-primary btn-sm" disabled={isActive}
                onClick={() => startTraining('cnn_scratch')}>
          Train CNN
        </button>
        <button className="btn btn-ghost btn-sm" disabled={isActive}
                onClick={() => startTraining('resnet18')}>
          Train ResNet
        </button>
        <button className="btn btn-ghost btn-sm" disabled={isActive}
                onClick={() => startTraining('mobilenetv2')}>
          Train MobileNet
        </button>
        <button className="btn btn-success btn-sm" disabled={isActive}
                onClick={() => startTraining('cnn_scratch', true)}>
          ⚡ Compare All
        </button>
      </div>

      {/* Training status */}
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

              {/* Progress bar */}
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
