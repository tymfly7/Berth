const style = {
  container: { padding: '20px' },
  modelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid var(--border-color)',
    fontSize: '0.8rem',
  },
  available: {
    width: 8, height: 8, borderRadius: '50%',
    display: 'inline-block',
  },
  compTable: {
    width: '100%',
    fontSize: '0.72rem',
    borderCollapse: 'collapse',
    marginTop: 8,
  },
}

export default function ModelStatus({ modelInfo, apiAction }) {
  if (!modelInfo) {
    return (
      <div className="glass-card loading-shimmer" style={{ padding: '20px', height: 120 }}>
        <div className="section-title">🧠 Model Info</div>
      </div>
    )
  }

  const models = [
    { name: 'cnn_scratch', label: 'CNN (Scratch)', available: modelInfo.available_models?.cnn_scratch },
    { name: 'resnet18', label: 'ResNet18', available: modelInfo.available_models?.resnet18 },
    { name: 'mobilenetv2', label: 'MobileNetV2', available: modelInfo.available_models?.mobilenetv2 },
  ]

  return (
    <div className="glass-card" style={style.container}>
      <div className="section-title">🧠 Model Info</div>

      <div style={style.modelRow}>
        <span className="text-muted">Active Model</span>
        <span className="badge badge-info">{modelInfo.active_model}</span>
      </div>
      <div style={style.modelRow}>
        <span className="text-muted">Dataset Ready</span>
        <span className={`badge ${modelInfo.dataset_ready ? 'badge-vacant' : 'badge-occupied'}`}>
          {modelInfo.dataset_ready ? `Yes (${modelInfo.dataset_count} images)` : 'No'}
        </span>
      </div>

      {/* Model availability */}
      {models.map((m) => (
        <div key={m.name} style={style.modelRow}>
          <span>{m.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              ...style.available,
              background: m.available ? 'var(--color-vacant)' : 'var(--color-occupied)',
            }} />
            <span className="text-xs text-muted">
              {m.available ? 'Trained' : 'Not trained'}
            </span>
          </div>
        </div>
      ))}

      {/* Comparison results */}
      {modelInfo.comparison && modelInfo.comparison.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title" style={{ marginBottom: 6 }}>📊 Comparison</div>
          <table style={style.compTable}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th style={{ textAlign: 'left', padding: '4px' }}>Model</th>
                <th style={{ textAlign: 'right', padding: '4px' }}>Acc</th>
                <th style={{ textAlign: 'right', padding: '4px' }}>F1</th>
                <th style={{ textAlign: 'right', padding: '4px' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {modelInfo.comparison.map((r) => (
                <tr key={r.model} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '4px', fontWeight: 600 }}>{r.model}</td>
                  <td style={{ padding: '4px', textAlign: 'right', color: 'var(--color-vacant)' }}>
                    {r.test_accuracy?.toFixed(1)}%
                  </td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>
                    {r.test_f1?.toFixed(1)}%
                  </td>
                  <td style={{ padding: '4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {r.train_time?.toFixed(0)}s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
