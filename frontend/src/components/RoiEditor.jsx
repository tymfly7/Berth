import { useState, useEffect, useRef, useCallback } from 'react'

const COLORS = ["#2ecc71", "#e74c3c", "#3498db", "#f39c12", "#9b59b6"]

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function pointInPolygon(px, py, polygon) {
  let inside = false
  const n = polygon.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

function getCentroid(pts) {
  return [
    pts.reduce((s, [x]) => s + x, 0) / pts.length,
    pts.reduce((s, [, y]) => s + y, 0) / pts.length,
  ]
}

export default function RoiEditor({ backgroundImage, rois, onRoisChange }) {
  const imgRef = useRef(null)
  const canvasRef = useRef(null)
  const [mode, setMode] = useState('polygon')
  const [selectedId, setSelectedId] = useState(null)
  const [inProgress, setInProgress] = useState([])
  const [livePoint, setLivePoint] = useState(null)
  const [rectStart, setRectStart] = useState(null)
  const [liveRect, setLiveRect] = useState(null)
  const [past, setPast] = useState([])
  const [future, setFuture] = useState([])

  const getPoint = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    const rect = canvas.getBoundingClientRect()
    return [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ]
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    rois.forEach((roi, idx) => {
      const color = roi.color || COLORS[idx % COLORS.length]
      const pts = roi.polygon.map(([x, y]) => [x * W, y * H])
      const isSelected = roi.id === selectedId

      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = hexToRgba(color, 0.3)
      ctx.fill()
      ctx.strokeStyle = isSelected ? '#ffffff' : color
      ctx.lineWidth = isSelected ? 3 : 2
      ctx.stroke()

      const [cx, cy] = getCentroid(pts)
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 3
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(roi.label, cx, cy)
      ctx.shadowBlur = 0
    })

    if (inProgress.length > 0) {
      const pts = inProgress.map(([x, y]) => [x * W, y * H])
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      if (livePoint) ctx.lineTo(livePoint[0] * W, livePoint[1] * H)
      ctx.setLineDash([5, 3])
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.setLineDash([])
      pts.forEach(([x, y], i) => {
        const isFirst = i === 0
        const nearClose = isFirst && livePoint && pts.length >= 3 && (() => {
          const dx = (livePoint[0] - inProgress[0][0]) * W
          const dy = (livePoint[1] - inProgress[0][1]) * H
          return Math.sqrt(dx * dx + dy * dy) < 15
        })()
        ctx.beginPath()
        ctx.arc(x, y, nearClose ? 8 : 4, 0, Math.PI * 2)
        ctx.fillStyle = nearClose ? '#2ecc71' : '#ffffff'
        ctx.fill()
      })
    }

    if (liveRect) {
      const x1 = liveRect.x1 * W, y1 = liveRect.y1 * H
      const x2 = liveRect.x2 * W, y2 = liveRect.y2 * H
      ctx.setLineDash([5, 3])
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      ctx.setLineDash([])
    }
  }, [rois, selectedId, inProgress, livePoint, liveRect])

  const syncSize = useCallback(() => {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    canvas.width = img.clientWidth
    canvas.height = img.clientHeight
  }, [])

  useEffect(() => {
    syncSize()
    redraw()
  }, [backgroundImage, syncSize, redraw])

  useEffect(() => {
    const handleResize = () => { syncSize(); redraw() }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [syncSize, redraw])

  const commitChange = useCallback((newRois) => {
    setPast(p => [...p, rois])
    setFuture([])
    onRoisChange(newRois)
  }, [rois, onRoisChange])

  const undo = useCallback(() => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    setFuture(f => [rois, ...f])
    onRoisChange(prev)
  }, [past, rois, onRoisChange])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setPast(p => [...p, rois])
    onRoisChange(next)
  }, [future, rois, onRoisChange])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setInProgress([])
        setLivePoint(null)
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo])

  useEffect(() => { redraw() }, [redraw])

  const makeRoi = useCallback((polygon) => {
    commitChange([...rois, {
      id: `roi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: `Slot ${rois.length + 1}`,
      polygon,
      color: COLORS[rois.length % COLORS.length],
    }])
  }, [rois, commitChange])

  const handleClick = useCallback((e) => {
    const pt = getPoint(e)
    if (mode === 'polygon') {
      if (inProgress.length === 0) {
        const hit = [...rois].reverse().find(r => pointInPolygon(pt[0], pt[1], r.polygon))
        if (hit) { setSelectedId(hit.id); return }
      }

      if (inProgress.length >= 3) {
        const canvas = canvasRef.current
        const W = canvas ? canvas.width : 1
        const H = canvas ? canvas.height : 1
        const [fx, fy] = inProgress[0]
        const dx = (pt[0] - fx) * W
        const dy = (pt[1] - fy) * H
        if (Math.sqrt(dx * dx + dy * dy) < 15) {
          makeRoi(inProgress)
          setInProgress([])
          setLivePoint(null)
          return
        }
      }

      setInProgress(prev => [...prev, pt])
    }
  }, [mode, inProgress, rois, getPoint, makeRoi])

  const handleDblClick = useCallback((e) => {
    if (mode !== 'polygon') return
    e.preventDefault()
    const pts = inProgress.length > 0 ? inProgress.slice(0, -1) : inProgress
    if (pts.length >= 3) makeRoi(pts)
    setInProgress([])
  }, [mode, inProgress, makeRoi])

  const handleMouseMove = useCallback((e) => {
    const pt = getPoint(e)
    if (mode === 'polygon') {
      setLivePoint(pt)
    } else if (mode === 'rect' && rectStart) {
      setLiveRect({ x1: rectStart[0], y1: rectStart[1], x2: pt[0], y2: pt[1] })
    }
  }, [mode, rectStart, getPoint])

  const handleMouseDown = useCallback((e) => {
    if (mode !== 'rect') return
    setRectStart(getPoint(e))
    setLiveRect(null)
  }, [mode, getPoint])

  const handleMouseUp = useCallback((e) => {
    if (mode !== 'rect' || !rectStart) return
    const pt = getPoint(e)
    const dx = Math.abs(pt[0] - rectStart[0])
    const dy = Math.abs(pt[1] - rectStart[1])
    if (dx > 0.01 || dy > 0.01) {
      const minX = Math.min(rectStart[0], pt[0]), maxX = Math.max(rectStart[0], pt[0])
      const minY = Math.min(rectStart[1], pt[1]), maxY = Math.max(rectStart[1], pt[1])
      makeRoi([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]])
    } else {
      const hit = [...rois].reverse().find(r => pointInPolygon(pt[0], pt[1], r.polygon))
      setSelectedId(hit ? hit.id : null)
    }
    setRectStart(null)
    setLiveRect(null)
  }, [mode, rectStart, rois, makeRoi, getPoint])

  const changeMode = (m) => {
    setMode(m)
    setInProgress([])
    setRectStart(null)
    setLiveRect(null)
    setLivePoint(null)
  }

  const btnStyle = (active) => ({
    padding: '5px 11px',
    borderRadius: 4,
    border: '1px solid rgba(255,255,255,0.2)',
    background: active ? 'var(--color-primary, #3498db)' : 'rgba(255,255,255,0.05)',
    color: active ? '#fff' : 'var(--text-muted, #aaa)',
    cursor: 'pointer',
    fontSize: '0.78rem',
  })

  if (!backgroundImage) return null

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <button style={btnStyle(mode === 'polygon')} onClick={() => changeMode('polygon')}>
          Polygon
        </button>
        <button style={btnStyle(mode === 'rect')} onClick={() => changeMode('rect')}>
          Rectangle
        </button>
        <button
          style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
          disabled={!selectedId}
          onClick={() => {
            commitChange(rois.filter(r => r.id !== selectedId))
            setSelectedId(null)
          }}
        >
          Delete Selected
        </button>
        <button
          style={btnStyle(false)}
          onClick={() => { commitChange([]); setSelectedId(null); setInProgress([]) }}
        >
          Clear All
        </button>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        <img
          ref={imgRef}
          src={backgroundImage}
          alt="reference"
          draggable={false}
          style={{ width: '100%', display: 'block', borderRadius: 4 }}
          onLoad={() => { syncSize(); redraw() }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%',
            cursor: 'crosshair',
          }}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        />
      </div>
    </div>
  )
}
