const cardStyle = {
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  position: 'relative',
  overflow: 'hidden',
}

const iconWrap = {
  width: 40,
  height: 40,
  borderRadius: 'var(--radius-sm)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '1.2rem',
}

const bigNum = {
  fontSize: '2rem',
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: '-1px',
}

const label = {
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
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
    getValue: (m) => `${m.occupancy_percent}%`,
  },
]

export default function MetricCards({ metrics }) {
  return (
    <>
      {CARDS.map((card, i) => (
        <div
          key={card.key}
          className="glass-card fade-in"
          style={{ ...cardStyle, animationDelay: `${i * 80}ms` }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={label}>{card.label}</span>
            <div style={{ ...iconWrap, background: card.iconBg }}>{card.icon}</div>
          </div>
          <div className="count-animate" style={{ ...bigNum, color: card.color }}>
            {card.getValue(metrics)}
          </div>
          {/* Mini progress bar for occupancy */}
          {card.key === 'occupancy' && (
            <div className="progress-bar" style={{ marginTop: 4 }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${metrics.occupancy_percent}%`,
                  background:
                    metrics.occupancy_percent > 85
                      ? 'var(--color-occupied)'
                      : metrics.occupancy_percent > 60
                      ? 'var(--color-warning)'
                      : 'var(--color-vacant)',
                }}
              />
            </div>
          )}
        </div>
      ))}
    </>
  )
}
