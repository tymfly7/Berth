import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { API_BASE } from '../config'

// eslint-disable-next-line no-unused-vars -- retained heatmap colour helpers (currently unused)
function getColor(rate) {
  if (rate >= 80) return 'var(--color-occupied)'
  if (rate >= 50) return 'var(--color-warning)'
  return 'var(--color-vacant)'
}

// eslint-disable-next-line no-unused-vars -- retained heatmap colour helpers (currently unused)
function getOpacity(rate) {
  return 0.3 + (rate / 100) * 0.7
}

function formatTime(secs) {
  if (secs < 60) return `${Math.round(secs)}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ''}`
}

function Legend() {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      marginTop: 10, fontSize: '0.65rem', color: 'var(--text-muted)',
    }}>
      <span>🟢 Less time parked</span>
      <span>🟡 Medium</span>
      <span>🔴 More time parked</span>
    </div>
  )
}

function ArrowBtn({ side, onClick }) {
  return (
    <button onClick={onClick} style={{
      position: 'absolute', [side]: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
      background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)',
      color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
      padding: '4px 10px', cursor: 'pointer', fontSize: '1.1rem',
    }}>
      {side === 'left' ? '‹' : '›'}
    </button>
  )
}

export default function HeatmapView({ cameras = [] }) {
  const [camIdx, setCamIdx] = useState(0)
  const [heatmap, setHeatmap] = useState([])
  const [rois, setRois] = useState([])
  const canvasRef = useRef(null)

  const safeIdx = Math.min(camIdx, Math.max(0, cameras.length - 1))
  const cam = cameras[safeIdx] ?? null
  const multi = cameras.length > 1

  useEffect(() => {
    setCamIdx(i => Math.min(i, Math.max(0, cameras.length - 1)))
  }, [cameras.length])

  useEffect(() => {
    if (!cam) { setRois([]); return }
    const cameraId = cam.roi_camera_id || cam.id
    apiFetch(`${API_BASE}/api/roi/${cameraId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setRois(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [cam?.id])

  useEffect(() => {
    if (!cam) { setHeatmap([]); return }
    const load = () => {
      apiFetch(`${API_BASE}/api/heatmap/${cam.id}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => setHeatmap(Array.isArray(data) ? data : []))
        .catch(() => {})
    }
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [cam?.id])

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

    const isTimeFormat = heatmap.some(s => s.occupied_seconds !== undefined)
    const valMap = {}
    heatmap.forEach(slot => {
      valMap[String(slot.slot_id)] = isTimeFormat
        ? (slot.occupied_seconds ?? 0)
        : (slot.occupancy_rate ?? 0)
    })

    const maxVal = Math.max(...Object.values(valMap), 1)

    rois.forEach(roi => {
      const val = valMap[String(roi.id)] ?? 0
      const ratio = val / maxVal
      const hue = (1 - ratio) * 120
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
      ctx.fillText(isTimeFormat ? formatTime(val) : `${Math.round(val)}%`, cx, cy)
    })
  }, [rois, heatmap])

  const prev = () => setCamIdx(i => (i - 1 + cameras.length) % cameras.length)
  const next = () => setCamIdx(i => (i + 1) % cameras.length)
  const title = `🔥 Usage Heatmap${cam && multi ? ` — ${cam.name}` : ''}`

  if (rois.length === 0 || heatmap.length === 0) {
    return (
      <div className="glass-card" style={{ padding: '20px' }}>
        <div className="section-title">{title}</div>
        <div style={{ position: 'relative' }}>
          {multi && <ArrowBtn side="left" onClick={prev} />}
          {multi && <ArrowBtn side="right" onClick={next} />}
          <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '20px 0' }}>
            Heatmap data will appear during live analysis
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card" style={{ padding: '20px' }}>
      <div className="section-title">{title}</div>
      <div style={{ position: 'relative' }}>
        {multi && <ArrowBtn side="left" onClick={prev} />}
        {multi && <ArrowBtn side="right" onClick={next} />}
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: 200, display: 'block', borderRadius: 'var(--radius-sm)' }}
        />
      </div>
      <Legend />
    </div>
  )
}
