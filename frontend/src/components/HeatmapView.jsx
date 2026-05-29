import { useState, useEffect, useRef } from 'react'

const API_BASE = `http://${window.location.hostname}:8000`

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
}

function getColor(rate) {
  if (rate >= 80) return 'var(--color-occupied)'
  if (rate >= 50) return 'var(--color-warning)'
  return 'var(--color-vacant)'
}

function getOpacity(rate) {
  return 0.3 + (rate / 100) * 0.7
}

function getLegend() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      marginTop: 10, fontSize: '0.65rem', color: 'var(--text-muted)',
    }}>
      <span>🟢 Low usage</span>
      <span>🟡 Medium</span>
      <span>🔴 High usage</span>
    </div>
  )
}

export default function HeatmapView({ heatmap }) {
  const [rois, setRois] = useState([])
  const canvasRef = useRef(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/roi/default`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (rois.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return

    const W = canvas.offsetWidth || canvas.parentElement?.clientWidth || 400
    canvas.width = W
    canvas.height = 200

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, 200)
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(0, 0, W, 200)

    const occupancyMap = {}
    heatmap.forEach(slot => { occupancyMap[String(slot.slot_id)] = slot.occupancy_rate })

    rois.forEach(roi => {
      const rate = occupancyMap[String(roi.id)] ?? 0
      const hue = (1 - rate / 100) * 120
      const pts = roi.polygon.map(([x, y]) => [x * W, y * 200])

      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.7)`
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 1.5
      ctx.stroke()

      const cx = pts.reduce((s, [x]) => s + x, 0) / pts.length
      const cy = pts.reduce((s, [, y]) => s + y, 0) / pts.length
      ctx.fillStyle = '#fff'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(roi.label, cx, cy)
    })
  }, [rois, heatmap])

  if (rois.length > 0) {
    return (
      <div className="glass-card" style={{ padding: '20px' }}>
        <div className="section-title">🔥 Usage Heatmap</div>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 200, display: 'block', borderRadius: 'var(--radius-sm)' }}
        />
        {getLegend()}
      </div>
    )
  }

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
      {getLegend()}
    </div>
  )
}
