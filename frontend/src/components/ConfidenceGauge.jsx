const style = {
  container: { padding: '20px', textAlign: 'center', position: 'relative' },
  nav: {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)',
    zIndex: 2, fontSize: '1.1rem', padding: '4px 10px',
  },
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
  tag: {
    marginLeft: 6,
    opacity: 0.7,
    fontStyle: 'italic',
  },
}

function getColor(conf) {
  if (conf >= 0.9) return 'var(--color-vacant)'
  if (conf >= 0.7) return 'var(--color-warning)'
  return 'var(--color-occupied)'
}

export default function ConfidenceGauge({ confidence, inferFps, inferMs, inferCap, showNav, onPrev, onNext }) {
  const hasData = (confidence || 0) > 0
  const pct = hasData ? Math.round(confidence * 100) : 0
  const color = hasData ? getColor(confidence) : 'rgba(255,255,255,0.18)'

  // SVG arc
  const radius = 40
  const circumference = Math.PI * radius
  const offset = hasData ? circumference - (pct / 100) * circumference : circumference

  return (
    <div className="glass-card" style={style.container}>
      {showNav && <>
        <button className="btn btn-ghost btn-sm" style={{ ...style.nav, left: 8 }} onClick={onPrev}>‹</button>
        <button className="btn btn-ghost btn-sm" style={{ ...style.nav, right: 8 }} onClick={onNext}>›</button>
      </>}
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

      <div style={{ ...style.value, color }}>{hasData ? `${pct}%` : '–'}</div>
      <div style={style.label}>{hasData ? 'Average prediction confidence' : 'No inference data'}</div>
      {(inferFps || 0) > 0 && (
        <div style={style.label}>
          {inferFps} inf/s · {inferMs} ms/frame
          {(inferCap || 0) > 0 && (
            <span style={style.tag}>{inferFps >= inferCap * 0.9 ? 'keeping up' : 'throttled'}</span>
          )}
        </div>
      )}
    </div>
  )
}
