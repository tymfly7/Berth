import { useRef, useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../api'

const API_BASE = `http://${window.location.hostname}:8000`

const TABS = [
  { key: 'live',  label: 'Live' },
  { key: 'day',   label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
]

function drawChart(canvas, data) {
  if (!canvas || !data || data.length === 0) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const w = rect.width
  const h = rect.height
  const pad = { top: 20, right: 16, bottom: 30, left: 40 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  ctx.clearRect(0, 0, w, h)

  const maxVal = Math.max(...data.map(d => d.occupied), ...data.map(d => d.available), 1)

  // Grid lines + Y labels
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH / 4) * i
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(w - pad.right, y)
    ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = '10px Inter, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 6, y + 3)
  }

  function drawLine(points, color, fill) {
    if (points.length === 0) return
    // 1-point case: draw a flat horizontal line across the full plot width
    const getX = (i) => points.length === 1 ? pad.left + plotW / 2 : pad.left + (i / (points.length - 1)) * plotW
    ctx.beginPath()
    points.forEach((p, i) => {
      const x = points.length === 1 ? pad.left : getX(i)
      const y = pad.top + plotH - (p / maxVal) * plotH
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    if (points.length === 1) {
      // extend to a visible horizontal segment
      const y = pad.top + plotH - (points[0] / maxVal) * plotH
      ctx.moveTo(pad.left, y)
      ctx.lineTo(pad.left + plotW, y)
    }
    if (fill) {
      ctx.lineTo(pad.left + plotW, pad.top + plotH)
      ctx.lineTo(pad.left, pad.top + plotH)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH)
      grad.addColorStop(0, color.replace('1)', '0.15)'))
      grad.addColorStop(1, color.replace('1)', '0)'))
      ctx.fillStyle = grad
      ctx.fill()
    } else {
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  const availData = data.map(d => d.available)
  const occData   = data.map(d => d.occupied)

  drawLine(availData, 'rgba(16,185,129,1)', true)
  drawLine(occData,   'rgba(244,63,94,1)',  true)
  drawLine(availData, 'rgba(16,185,129,1)', false)
  drawLine(occData,   'rgba(244,63,94,1)',  false)

  // X-axis labels (first, middle, last)
  const labelIdxs = [0, Math.floor(data.length / 2), data.length - 1]
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = '9px Inter, sans-serif'
  ctx.textAlign = 'center'
  labelIdxs.forEach(i => {
    const raw = data[i]?.timestamp || ''
    const label = raw.length > 10
      ? raw.slice(11, 16)   // HH:MM — ISO or space-separated datetime
      : raw.slice(5, 10)    // MM-DD — date-only (month view)
    const x = pad.left + (i / (data.length - 1)) * plotW
    ctx.fillText(label, x, pad.top + plotH + 16)
  })

  // Legend
  const legendY = h - 8
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(16,185,129,1)'
  ctx.fillRect(pad.left, legendY - 6, 12, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.font = '10px Inter, sans-serif'
  ctx.fillText('Available', pad.left + 16, legendY)
  ctx.fillStyle = 'rgba(244,63,94,1)'
  ctx.fillRect(pad.left + 90, legendY - 6, 12, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText('Occupied', pad.left + 106, legendY)
}

export default function AnalyticsChart({ history }) {
  const canvasRef = useRef(null)
  const [tab, setTab] = useState('live')
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(false)

  const fetchTrend = useCallback(async (range) => {
    setLoading(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/trends?range=${range}`)
      if (res.ok) setTrendData(await res.json())
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    const range = tab === 'live' ? 'today' : tab
    fetchTrend(range)
    const id = setInterval(() => fetchTrend(range), tab === 'live' ? 30_000 : 60_000)
    return () => clearInterval(id)
  }, [tab, fetchTrend])

  const activeData = trendData ?? []

  useEffect(() => {
    drawChart(canvasRef.current, activeData)
  }, [activeData])

  const tabStyle = (key) => ({
    padding: '3px 12px',
    fontSize: '0.7rem',
    fontWeight: 500,
    letterSpacing: '0.4px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    background: tab === key ? 'var(--accent-primary)' : 'rgba(255,255,255,0.07)',
    color: tab === key ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s',
  })

  const isEmpty = activeData.length === 0

  return (
    <div className="glass-card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="section-title" style={{ margin: 0 }}>Occupancy Trend</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(t => (
            <button key={t.key} style={tabStyle(t.key)} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
          Loading...
        </div>
      ) : isEmpty ? (
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
          {tab === 'live' ? 'No data recorded today yet.' : 'No historical data yet — data accumulates over time.'}
        </div>
      ) : (
        <canvas ref={canvasRef} style={{ width: '100%', height: 180, borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)' }} />
      )}
    </div>
  )
}
