const style = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: '6px',
    padding: '4px',
  },
  cell: {
    aspectRatio: '1',
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.65rem',
    fontWeight: 600,
    color: 'white',
    transition: 'all var(--transition-base)',
    cursor: 'default',
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.9)',
    color: 'white',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: '0.7rem',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    marginBottom: 4,
  },
}

function getColor(rate) {
  if (rate >= 80) return 'var(--color-occupied)'
  if (rate >= 50) return 'var(--color-warning)'
  return 'var(--color-vacant)'
}

function getOpacity(rate) {
  return 0.3 + (rate / 100) * 0.7
}

export default function HeatmapView({ heatmap }) {
  if (!heatmap || heatmap.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '20px' }}>
        <div className="section-title">🔥 Usage Heatmap</div>
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '20px 0' }}>
          Heatmap data will appear during live analysis
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card" style={{ padding: '20px' }}>
      <div className="section-title">🔥 Usage Heatmap</div>
      <div style={style.grid}>
        {heatmap.map((slot) => (
          <div
            key={slot.slot_id}
            style={{
              ...style.cell,
              background: getColor(slot.occupancy_rate),
              opacity: getOpacity(slot.occupancy_rate),
            }}
            title={`Slot #${slot.slot_id}: ${slot.occupancy_rate}% occupied`}
          >
            {slot.slot_id}
          </div>
        ))}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 10, fontSize: '0.65rem', color: 'var(--text-muted)',
      }}>
        <span>🟢 Low usage</span>
        <span>🟡 Medium</span>
        <span>🔴 High usage</span>
      </div>
    </div>
  )
}
