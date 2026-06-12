import { useState } from 'react'

const cardStyle = {
  padding: '12px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  position: 'relative',
  overflow: 'hidden',
  textAlign: 'center',
}

const iconWrap = {
  width: 24,
  height: 24,
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.85rem',
}

const bigNum = {
  fontSize: '1.9rem',
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: '-0.5px',
}

const labelStyle = {
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

function occupancyColor(pct) {
  const p = Math.min(100, Math.max(0, pct)) / 100
  const hue = 120 - p * 120        // 120 (green) → 0 (red)
  const sat = 65 + p * 35          // 65% → 100%
  const lit = 44 - p * 10          // 44% → 34% (darker = more intense)
  return `hsl(${hue}, ${sat}%, ${lit}%)`
}

function StreamCarousel({ streams }) {
  const [streamIdx, setStreamIdx] = useState(0)
  const safeIdx = streams.length > 0 ? streamIdx % streams.length : 0
  const s = streams[safeIdx]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
        <button
          onClick={() => setStreamIdx(prev => (prev - 1 + streams.length) % streams.length)}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 4px', flexShrink: 0 }}
        >‹</button>
        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.name}
          </div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: s.fps > 0 ? 'var(--color-vacant)' : 'var(--text-muted)' }}>
            {s.fps > 0 ? `${s.fps} fps` : '–'}
          </div>
        </div>
        <button
          onClick={() => setStreamIdx(prev => (prev + 1) % streams.length)}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 4px', flexShrink: 0 }}
        >›</button>
      </div>
      {streams.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
          {streams.map((_, i) => (
            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: i === safeIdx ? 'var(--color-vacant)' : 'rgba(255,255,255,0.18)' }} />
          ))}
        </div>
      )}
    </>
  )
}

const CARDS = [
  {
    key: 'total',
    label: 'Total Spots',
    icon: '🅿️',
    iconBg: 'rgba(99,102,241,0.15)',
    color: 'var(--accent-primary)',
    getValue: (m) => m.total,
  },
  {
    key: 'available',
    label: 'Available',
    icon: '✅',
    iconBg: 'var(--color-vacant-glow)',
    color: 'var(--color-vacant)',
    getValue: (m) => m.available,
  },
  {
    key: 'occupied',
    label: 'Occupied',
    icon: '🚗',
    iconBg: 'var(--color-occupied-glow)',
    color: 'var(--color-occupied)',
    getValue: (m) => m.occupied,
  },
  {
    key: 'occupancy',
    label: 'Occupancy',
    icon: '📊',
    iconBg: 'rgba(245,158,11,0.15)',
    color: 'var(--color-warning)',
    getValue: (m) => `${Math.round(m.occupancy_percent ?? 0)}%`,
  },
  {
    key: 'streams',
    label: 'Streams',
    icon: '📡',
    iconBg: 'rgba(16,185,129,0.15)',
    color: 'var(--color-vacant)',
    getValue: (_, s) => Array.isArray(s) ? s.length : '–',
  },
]

export default function MetricCards({ metrics, streams, showMisparked = true }) {
  return (
    <>
      {CARDS.filter(card => card.key !== 'streams' || Array.isArray(streams)).map((card, i) => (
        <div
          key={card.key}
          className="glass-card fade-in"
          style={{ ...cardStyle, animationDelay: `${i * 80}ms` }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={labelStyle}>{card.label}</span>
            <div style={{ ...iconWrap, background: card.iconBg }}>{card.icon}</div>
          </div>
          {card.key !== 'streams' && (
            <div className="count-animate" style={{ ...bigNum, color: card.color }}>
              {card.getValue(metrics, streams)}
            </div>
          )}
          {card.key === 'occupancy' && (
            <div className="progress-bar" style={{ marginTop: 4 }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${metrics.occupancy_percent ?? 0}%`,
                  background: occupancyColor(metrics.occupancy_percent ?? 0),
                }}
              />
            </div>
          )}
          {card.key === 'streams' && Array.isArray(streams) && streams.length > 0 && (
            <StreamCarousel streams={streams} />
          )}
        </div>
      ))}
      {showMisparked && metrics.anomaly_enabled && (
        <div className="glass-card fade-in" style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={labelStyle}>Misparked</span>
            <div style={{ ...iconWrap, background: 'rgba(251,146,60,0.15)' }}>⚠️</div>
          </div>
          <div className="count-animate" style={{ ...bigNum, color: '#f97316' }}>
            {metrics.misparked_count ?? 0}
          </div>
        </div>
      )}
    </>
  )
}
