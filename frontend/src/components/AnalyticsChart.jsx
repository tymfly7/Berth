import { useRef, useEffect, useState, useCallback } from 'react'
import { apiFetch } from '../api'
import { API_BASE } from '../config'

function aggregateByMonth(data) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const byDay = {}
  data.forEach(d => {
    const date = (d.timestamp || '').slice(0, 10)
    if (!date) return
    if (!byDay[date]) byDay[date] = { available: [], occupied: [] }
    byDay[date].available.push(d.available || 0)
    byDay[date].occupied.push(d.occupied || 0)
  })
  const result = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const vals = byDay[date]
    result.push({
      timestamp: date,
      available: vals ? Math.round(vals.available.reduce((s, v) => s + v, 0) / vals.available.length) : 0,
      occupied:  vals ? Math.round(vals.occupied.reduce((s, v) => s + v, 0) / vals.occupied.length) : 0,
    })
  }
  return result
}

function aggregateByDay(data, days = 7) {
  const byDay = {}
  data.forEach(d => {
    const date = (d.timestamp || '').slice(0, 10)
    if (!date) return
    if (!byDay[date]) byDay[date] = { available: [], occupied: [] }
    byDay[date].available.push(d.available || 0)
    byDay[date].occupied.push(d.occupied || 0)
  })
  const result = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    const vals = byDay[date]
    result.push({
      timestamp: date,
      available: vals ? Math.round(vals.available.reduce((s, v) => s + v, 0) / vals.available.length) : 0,
      occupied:  vals ? Math.round(vals.occupied.reduce((s, v) => s + v, 0) / vals.occupied.length) : 0,
    })
  }
  return result
}

function aggregateByMinutes(data, bucketMin) {
  // The live/day tabs are raw 60s snapshots (up to ~1440/day) — far too jagged as
  // a line. Average into fixed time buckets (live = 15 min, day = 60 min). Buckets
  // are epoch-based so they align regardless of timezone; timestamps stay ISO/UTC
  // to match the rest of the chart's HH:MM labelling.
  const bucketMs = bucketMin * 60_000
  const buckets = {}
  data.forEach(d => {
    const t = Date.parse(d.timestamp)
    if (Number.isNaN(t)) return
    const key = Math.floor(t / bucketMs) * bucketMs
    if (!buckets[key]) buckets[key] = { available: [], occupied: [] }
    buckets[key].available.push(d.available || 0)
    buckets[key].occupied.push(d.occupied || 0)
  })
  return Object.keys(buckets).map(Number).sort((a, b) => a - b).map(key => {
    const v = buckets[key]
    return {
      timestamp: new Date(key).toISOString(),
      available: Math.round(v.available.reduce((s, x) => s + x, 0) / v.available.length),
      occupied:  Math.round(v.occupied.reduce((s, x) => s + x, 0) / v.occupied.length),
    }
  })
}

const TABS = [
  { key: 'live',  label: 'Live' },
  { key: 'day',   label: 'Day' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
]

function drawChart(canvas, data, tab = 'live') {
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
  const hasData = data.some(d => d.available > 0 || d.occupied > 0)

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

    const isSingle = points.length === 1
    const getX = (i) => pad.left + (i / (points.length - 1)) * plotW
    const getY = (v) => pad.top + plotH - (v / maxVal) * plotH

    if (fill) {
      ctx.beginPath()
      if (isSingle) {
        ctx.moveTo(pad.left, getY(points[0]))
        ctx.lineTo(pad.left + plotW, getY(points[0]))
      } else {
        points.forEach((p, i) => {
          i === 0 ? ctx.moveTo(getX(i), getY(p)) : ctx.lineTo(getX(i), getY(p))
        })
      }
      ctx.lineTo(pad.left + plotW, pad.top + plotH)
      ctx.lineTo(pad.left, pad.top + plotH)
      ctx.closePath()
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH)
      grad.addColorStop(0, color.replace('1)', '0.15)'))
      grad.addColorStop(1, color.replace('1)', '0)'))
      ctx.fillStyle = grad
      ctx.fill()
    } else {
      ctx.beginPath()
      if (isSingle) {
        ctx.moveTo(pad.left, getY(points[0]))
        ctx.lineTo(pad.left + plotW, getY(points[0]))
      } else {
        points.forEach((p, i) => {
          i === 0 ? ctx.moveTo(getX(i), getY(p)) : ctx.lineTo(getX(i), getY(p))
        })
      }
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  const availData = data.map(d => d.available)
  const occData   = data.map(d => d.occupied)
  const isBars = tab === 'week' || tab === 'month'

  if (!hasData) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.font = '12px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No data available for this period', w / 2, pad.top + plotH / 2)
  } else if (isBars) {
    const groupW = plotW / data.length
    const barPad = Math.max(2, groupW * 0.1)
    const gap    = Math.max(1, groupW * 0.05)
    const barW   = Math.max(2, (groupW - barPad * 2 - gap) / 2)
    data.forEach((d, i) => {
      const x0 = pad.left + i * groupW + barPad
      const availH = maxVal > 0 ? (d.available / maxVal) * plotH : 0
      ctx.fillStyle = 'rgba(16,185,129,0.85)'
      ctx.fillRect(x0, pad.top + plotH - availH, barW, availH)
      const occH = maxVal > 0 ? (d.occupied / maxVal) * plotH : 0
      ctx.fillStyle = 'rgba(244,63,94,0.85)'
      ctx.fillRect(x0 + barW + gap, pad.top + plotH - occH, barW, occH)
    })
  } else {
    drawLine(availData, 'rgba(16,185,129,1)', true)
    drawLine(occData,   'rgba(244,63,94,1)',  true)
    drawLine(availData, 'rgba(16,185,129,1)', false)
    drawLine(occData,   'rgba(244,63,94,1)',  false)
  }

  // X-axis labels
  let labelIdxs
  if (tab === 'month') {
    labelIdxs = []
    for (let i = 0; i < data.length; i += 5) labelIdxs.push(i)
    if (labelIdxs[labelIdxs.length - 1] !== data.length - 1) labelIdxs.push(data.length - 1)
  } else {
    const maxLabels = tab === 'week' ? Math.min(7, data.length) : Math.max(2, Math.min(data.length, Math.floor(plotW / 58)))
    labelIdxs = maxLabels === 1
      ? [0]
      : Array.from({ length: maxLabels }, (_, i) => Math.round(i * (data.length - 1) / (maxLabels - 1)))
  }
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = '9px Inter, sans-serif'
  ctx.textAlign = 'center'
  labelIdxs.forEach(i => {
    const raw = data[i]?.timestamp || ''
    let label
    if (tab === 'week') {
      const [y, m, day] = raw.slice(0, 10).split('-').map(Number)
      const d = new Date(y, m - 1, day)
      label = isNaN(d) ? raw.slice(5, 10) : d.toLocaleDateString('en-US', { weekday: 'short' })
    } else if (raw.length > 10) {
      label = raw.slice(11, 16)   // HH:MM
    } else {
      label = raw.slice(5, 10)    // MM-DD
    }
    const x = isBars
      ? pad.left + i * (plotW / data.length) + (plotW / data.length) / 2
      : data.length === 1 ? pad.left + plotW / 2 : pad.left + (i / (data.length - 1)) * plotW
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

export default function AnalyticsChart({ connected = false, cameras = [] }) {
  const canvasRef = useRef(null)
  const chartDataRef = useRef({ data: [], tab: 'live' })
  const [tab, setTab] = useState('live')
  const [selectedCamId, setSelectedCamId] = useState(null)
  const [trendData, setTrendData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, label: '', available: 0, occupied: 0 })

  // Auto-reset to Unified if the selected camera is removed
  useEffect(() => {
    if (selectedCamId && !cameras.find(c => c.id === selectedCamId)) {
      setSelectedCamId(null)
    }
  }, [cameras, selectedCamId])

  const fetchTrend = useCallback(async (range, camId) => {
    setLoading(true)
    setFetchError(false)
    try {
      const camParam = camId ? `&camera_id=${camId}` : ''
      const res = await apiFetch(`${API_BASE}/api/trends?range=${range}${camParam}`)
      if (res.ok) {
        setTrendData(await res.json())
      } else {
        setFetchError(true)
      }
    } catch {
      setFetchError(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const range = tab === 'live' ? 'today' : tab
    fetchTrend(range, selectedCamId)
    const id = setInterval(() => fetchTrend(range, selectedCamId), tab === 'live' ? 30_000 : 60_000)
    return () => clearInterval(id)
  }, [tab, selectedCamId, fetchTrend])

  const activeData = trendData ?? []

  useEffect(() => {
    const now = new Date().toISOString()
    const zeros = [{ timestamp: now, available: 0, occupied: 0 }, { timestamp: now, available: 0, occupied: 0 }]
    let data = activeData.length > 0 ? activeData : zeros
    if (tab === 'live') data = aggregateByMinutes(data, 15)
    if (tab === 'day')  data = aggregateByMinutes(data, 15)
    if (tab === 'week') data = aggregateByDay(data, 7)
    if (tab === 'month') data = aggregateByMonth(data)
    data = data.map(d => ({ ...d, available: Math.round(d.available || 0), occupied: Math.round(d.occupied || 0) }))
    chartDataRef.current = { data, tab }
    drawChart(canvasRef.current, data, tab)
  }, [activeData, tab, connected])

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { data, tab: currentTab } = chartDataRef.current
    if (!data || data.length === 0) return

    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const pad = { top: 20, right: 16, bottom: 30, left: 40 }
    const plotW = rect.width - pad.left - pad.right
    const plotH = rect.height - pad.top - pad.bottom

    if (mx < pad.left || mx > rect.width - pad.right || my < pad.top || my > pad.top + plotH) {
      setTooltip(t => ({ ...t, visible: false }))
      return
    }

    const isBars = currentTab === 'week' || currentTab === 'month'
    let idx
    if (isBars) {
      idx = Math.max(0, Math.min(data.length - 1, Math.floor((mx - pad.left) / (plotW / data.length))))
    } else {
      idx = data.length === 1 ? 0 : Math.max(0, Math.min(data.length - 1, Math.round((mx - pad.left) / plotW * (data.length - 1))))
    }

    const d = data[idx]
    if (!d) return
    const raw = d.timestamp || ''
    let label
    if (currentTab === 'week') {
      const [y, m, day] = raw.slice(0, 10).split('-').map(Number)
      const dt = new Date(y, m - 1, day)
      label = isNaN(dt.getTime()) ? raw.slice(5, 10) : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    } else if (raw.length > 10) {
      label = raw.slice(11, 16)
    } else {
      label = raw.slice(5, 10)
    }

    const tx = Math.min(mx + 12, rect.width - 115)
    const ty = Math.max(my - 50, 4)
    setTooltip({ visible: true, x: tx, y: ty, label, available: d.available, occupied: d.occupied })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setTooltip(t => ({ ...t, visible: false }))
  }, [])

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

  const camTabStyle = (id) => ({
    padding: '2px 10px',
    fontSize: '0.68rem',
    fontWeight: 500,
    letterSpacing: '0.3px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    background: selectedCamId === id ? 'rgba(99,102,241,0.85)' : 'rgba(255,255,255,0.06)',
    color: selectedCamId === id ? '#fff' : 'var(--text-muted)',
    transition: 'background 0.15s',
  })

  const chartH = tab === 'month' ? 180 : 240

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

      {cameras.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {cameras.map(c => (
            <button key={c.id} style={camTabStyle(c.id)} onClick={() => setSelectedCamId(c.id)}>
              {c.name}
            </button>
          ))}
          <button style={camTabStyle(null)} onClick={() => setSelectedCamId(null)}>
            Unified
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
          Loading...
        </div>
      ) : fetchError ? (
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
          Could not load trend data. Retrying…
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{ width: '100%', height: chartH, borderRadius: 'var(--radius-sm)', background: 'rgba(0,0,0,0.2)', display: 'block' }}
          />
          {tooltip.visible && (
            <div style={{
              position: 'absolute', left: tooltip.x, top: tooltip.y,
              background: 'rgba(12,18,32,0.95)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '6px 10px', pointerEvents: 'none',
              fontSize: '0.72rem', color: '#fff', lineHeight: 1.7, zIndex: 10, minWidth: 105,
            }}>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.68rem', marginBottom: 2 }}>{tooltip.label}</div>
              <div><span style={{ color: 'rgba(16,185,129,1)' }}>&#9646;</span> Available: <strong>{tooltip.available}</strong></div>
              <div><span style={{ color: 'rgba(244,63,94,1)' }}>&#9646;</span> Occupied: <strong>{tooltip.occupied}</strong></div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
