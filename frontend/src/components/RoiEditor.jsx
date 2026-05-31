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

export default function RoiEditor({
  backgroundImage = null,
  rois,
  onRoisChange,
  proposals = [],
  onProposalsChange = null,
  overlay = false,
  idPrefix = 'roi',
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const bgImgRef = useRef(null)
  const [mode, setMode] = useState('polygon')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedProposalId, setSelectedProposalId] = useState(null)
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

    if (!overlay && bgImgRef.current) {
      ctx.drawImage(bgImgRef.current, 0, 0, W, H)
    }

    // Draw confirmed ROIs
    rois.forEach((roi, idx) => {
      const isSelected = roi.id === selectedId
      const isDrawing = inProgress.length > 0
      const color = isDrawing && !isSelected ? '#2ecc71' : (roi.color || COLORS[idx % COLORS.length])
      const fillColor = isDrawing && !isSelected ? 'rgba(46,204,113,0.25)' : hexToRgba(color, 0.3)
      const pts = roi.polygon.map(([x, y]) => [x * W, y * H])

      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = fillColor
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

    // Draw proposed ROIs with ghost/dashed style
    proposals.forEach((prop) => {
      const isSelected = prop.id === selectedProposalId
      const pts = prop.polygon.map(([x, y]) => [x * W, y * H])

      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = isSelected ? 'rgba(100,200,255,0.25)' : 'rgba(100,200,255,0.12)'
      ctx.fill()
      ctx.setLineDash([7, 4])
      ctx.strokeStyle = isSelected ? '#64c8ff' : 'rgba(100,200,255,0.65)'
      ctx.lineWidth = isSelected ? 2.5 : 1.5
      ctx.stroke()
      ctx.setLineDash([])

      const [cx, cy] = getCentroid(pts)
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 3
      ctx.fillStyle = isSelected ? '#64c8ff' : 'rgba(150,220,255,0.85)'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`? ${prop.label}`, cx, cy)
      ctx.shadowBlur = 0
    })

    // In-progress polygon drawing
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
  }, [rois, proposals, selectedId, selectedProposalId, inProgress, livePoint, liveRect])

  const syncSize = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const w = container.clientWidth
    const h = overlay ? container.clientHeight : Math.max(container.clientHeight, 300)
    if (w > 0 && h > 0) { canvas.width = w; canvas.height = h }
  }, [overlay])

  useEffect(() => {
    if (overlay || !backgroundImage) {
      bgImgRef.current = null
      syncSize()
      redraw()
      return
    }
    const img = new Image()
    img.onload = () => { bgImgRef.current = img; syncSize(); redraw() }
    img.src = backgroundImage
  }, [backgroundImage, overlay, syncSize, redraw])

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
      id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: `Slot ${rois.length + 1}`,
      polygon,
      color: COLORS[rois.length % COLORS.length],
    }])
  }, [rois, commitChange, idPrefix])

  // Accept a single proposal: convert it to a confirmed ROI
  const acceptProposal = useCallback((propId) => {
    if (!onProposalsChange) return
    const prop = proposals.find(p => p.id === propId)
    if (!prop) return
    const { proposed: _omit, ...base } = prop
    commitChange([...rois, { ...base, color: COLORS[rois.length % COLORS.length] }])
    onProposalsChange(proposals.filter(p => p.id !== propId))
    setSelectedProposalId(null)
  }, [proposals, rois, commitChange, onProposalsChange])

  // Accept all proposals at once
  const acceptAllProposals = useCallback(() => {
    if (!onProposalsChange || proposals.length === 0) return
    const newRois = proposals.map((prop, i) => {
      const { proposed: _omit, ...base } = prop
      return { ...base, color: COLORS[(rois.length + i) % COLORS.length] }
    })
    commitChange([...rois, ...newRois])
    onProposalsChange([])
    setSelectedProposalId(null)
  }, [proposals, rois, commitChange, onProposalsChange])

  const discardProposal = useCallback((propId) => {
    if (!onProposalsChange) return
    onProposalsChange(proposals.filter(p => p.id !== propId))
    if (selectedProposalId === propId) setSelectedProposalId(null)
  }, [proposals, onProposalsChange, selectedProposalId])

  const discardAllProposals = useCallback(() => {
    if (!onProposalsChange) return
    onProposalsChange([])
    setSelectedProposalId(null)
  }, [onProposalsChange])

  const handleClick = useCallback((e) => {
    const pt = getPoint(e)
    if (mode === 'polygon') {
      if (inProgress.length === 0) {
        // Check proposals first (they're on top visually)
        if (proposals.length > 0) {
          const hitProp = [...proposals].reverse().find(p => pointInPolygon(pt[0], pt[1], p.polygon))
          if (hitProp) {
            setSelectedProposalId(hitProp.id)
            setSelectedId(null)
            return
          }
        }
        const hit = [...rois].reverse().find(r => pointInPolygon(pt[0], pt[1], r.polygon))
        if (hit) {
          setSelectedId(hit.id)
          setSelectedProposalId(null)
          return
        }
        setSelectedId(null)
        setSelectedProposalId(null)
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
  }, [mode, inProgress, rois, proposals, getPoint, makeRoi])

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
      const hitProp = proposals.length > 0
        ? [...proposals].reverse().find(p => pointInPolygon(pt[0], pt[1], p.polygon))
        : null
      if (hitProp) {
        setSelectedProposalId(hitProp.id)
        setSelectedId(null)
      } else {
        const hit = [...rois].reverse().find(r => pointInPolygon(pt[0], pt[1], r.polygon))
        setSelectedId(hit ? hit.id : null)
        setSelectedProposalId(null)
      }
    }
    setRectStart(null)
    setLiveRect(null)
  }, [mode, rectStart, rois, proposals, makeRoi, getPoint])

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

  const proposalBtnStyle = (disabled) => ({
    padding: '5px 11px',
    borderRadius: 4,
    border: '1px solid rgba(100,200,255,0.5)',
    background: 'rgba(100,200,255,0.08)',
    color: disabled ? 'rgba(100,200,255,0.35)' : '#64c8ff',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '0.78rem',
  })

  const hasProposals = proposals.length > 0
  const selProp = selectedProposalId ? proposals.find(p => p.id === selectedProposalId) : null

  return (
    <div style={overlay ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' } : {}}>
      {/* ── ROI drawing toolbar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', ...(overlay ? { padding: '6px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' } : {}) }}>
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

      {/* ── Proposals toolbar ── */}
      {hasProposals && (
        <div style={{
          display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', alignItems: 'center',
          padding: '7px 10px', borderRadius: overlay ? 0 : 5,
          border: overlay ? 'none' : '1px solid rgba(100,200,255,0.3)',
          background: overlay ? 'rgba(0,0,0,0.6)' : 'rgba(100,200,255,0.06)',
          backdropFilter: overlay ? 'blur(4px)' : undefined,
          borderBottom: overlay ? '1px solid rgba(100,200,255,0.2)' : undefined,
        }}>
          <span style={{ fontSize: '0.75rem', color: '#64c8ff', marginRight: 2 }}>
            {proposals.length} proposal{proposals.length > 1 ? 's' : ''} — dashed blue
          </span>
          <button
            style={proposalBtnStyle(!selProp)}
            disabled={!selProp}
            onClick={() => selProp && acceptProposal(selProp.id)}
            title="Accept selected proposal and add it as a confirmed ROI"
          >
            Accept Selected
          </button>
          <button
            style={proposalBtnStyle(false)}
            onClick={acceptAllProposals}
            title="Accept all proposals and add them as confirmed ROIs"
          >
            Accept All
          </button>
          <button
            style={{ ...proposalBtnStyle(!selProp), borderColor: 'rgba(255,255,255,0.2)', color: selProp ? 'var(--text-muted,#aaa)' : 'rgba(150,150,150,0.4)' }}
            disabled={!selProp}
            onClick={() => selProp && discardProposal(selProp.id)}
            title="Discard selected proposal"
          >
            Discard Selected
          </button>
          <button
            style={{ ...proposalBtnStyle(false), borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-muted,#aaa)' }}
            onClick={discardAllProposals}
            title="Discard all proposals"
          >
            Discard All
          </button>
        </div>
      )}

      {/* ── Proposals caveat ── */}
      {hasProposals && (
        <div style={{
          fontSize: '0.72rem', color: 'rgba(255,210,80,0.85)',
          marginBottom: 8, paddingLeft: 2,
        }}>
          Proposals cover <strong>occupied spots</strong> (vehicles detected). Empty spots may be
          missing. Click a dashed shape to select it, then accept or discard individually.
        </div>
      )}

      {/* ── Canvas ── */}
      <div ref={containerRef} style={overlay
        ? { flex: 1, position: 'relative' }
        : { position: 'relative', width: '100%', minHeight: 300, background: 'rgba(0,0,0,0.25)', borderRadius: 4 }
      }>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: overlay ? '100%' : undefined,
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
