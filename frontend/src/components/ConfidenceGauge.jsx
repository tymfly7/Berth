const style = {
  container: { padding: '20px', textAlign: 'center' },
  gauge: {
    position: 'relative',
    width: 100,
    height: 60,
    margin: '10px auto',
  },
  value: {
    fontSize: '1.5rem',
    fontWeight: 800,
    marginTop: 8,
  },
  label: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
}

function getColor(conf) {
  if (conf >= 0.9) return 'var(--color-vacant)'
  if (conf >= 0.7) return 'var(--color-warning)'
  return 'var(--color-occupied)'
}

export default function ConfidenceGauge({ confidence }) {
  const pct = Math.round((confidence || 0) * 100)
  const color = getColor(confidence || 0)

  // SVG arc
  const radius = 40
  const circumference = Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="glass-card" style={style.container}>
      <div className="section-title">🎯 Model Confidence</div>

      <div style={style.gauge}>
        <svg viewBox="0 0 100 55" style={{ width: '100%', height: '100%' }}>
          {/* Background arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Filled arc */}
          <path
            d="M 10 50 A 40 40 0 0 1 90 50"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
      </div>

      <div style={{ ...style.value, color }}>{pct}%</div>
      <div style={style.label}>Average prediction confidence</div>
    </div>
  )
}
