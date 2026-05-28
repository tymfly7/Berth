import { useRef, useEffect } from 'react'

const style = {
  container: { padding: '20px' },
  canvas: {
    width: '100%',
    height: 180,
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(0,0,0,0.2)',
  },
}

export default function AnalyticsChart({ history }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !history || history.length < 2) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const padding = { top: 20, right: 16, bottom: 30, left: 40 }
    const plotW = w - padding.left - padding.right
    const plotH = h - padding.top - padding.bottom

    // Clear
    ctx.clearRect(0, 0, w, h)

    // Get data
    const data = history.slice(-60)  // Last 60 data points
    const maxVal = Math.max(...data.map(d => d.occupied), ...data.map(d => d.available), 1)

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (plotH / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(w - padding.right, y)
      ctx.stroke()

      // Y axis labels
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = '10px Inter, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padding.left - 6, y + 3)
    }

    // Draw line function
    function drawLine(points, color, fill = false) {
      if (points.length < 2) return
      ctx.beginPath()
      points.forEach((p, i) => {
        const x = padding.left + (i / (points.length - 1)) * plotW
        const y = padding.top + plotH - (p / maxVal) * plotH
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })

      if (fill) {
        const lastX = padding.left + plotW
        ctx.lineTo(lastX, padding.top + plotH)
        ctx.lineTo(padding.left, padding.top + plotH)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + plotH)
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
    const occData = data.map(d => d.occupied)

    // Fill areas
    drawLine(availData, 'rgba(16,185,129,1)', true)
    drawLine(occData, 'rgba(244,63,94,1)', true)

    // Lines
    drawLine(availData, 'rgba(16,185,129,1)')
    drawLine(occData, 'rgba(244,63,94,1)')

    // Legend
    ctx.font = '10px Inter, sans-serif'
    const legendY = h - 8
    ctx.fillStyle = 'rgba(16,185,129,1)'
    ctx.fillRect(padding.left, legendY - 6, 12, 3)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.textAlign = 'left'
    ctx.fillText('Available', padding.left + 16, legendY)

    ctx.fillStyle = 'rgba(244,63,94,1)'
    ctx.fillRect(padding.left + 90, legendY - 6, 12, 3)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillText('Occupied', padding.left + 106, legendY)

  }, [history])

  return (
    <div className="glass-card" style={style.container}>
      <div className="section-title">📈 Occupancy Trend</div>
      {(!history || history.length < 2) ? (
        <div className="text-sm text-muted" style={{ textAlign: 'center', padding: '40px 0' }}>
          Chart will update with live data...
        </div>
      ) : (
        <canvas ref={canvasRef} style={style.canvas} />
      )}
    </div>
  )
}
