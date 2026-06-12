import { useState, useEffect, useRef, useCallback } from 'react'

const ROI_COLOR = '#10b981'
const SPOT_TYPE_COLORS = { normal: null, reserved: '#e6a817', handicap: '#1a7fc1' }
const HIT_PX = 10

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

function ptDistPx(ax, ay, bx, by, W, H) {
  const dx = (ax - bx) * W
  const dy = (ay - by) * H
  return Math.sqrt(dx * dx + dy * dy)
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
  const dragRef = useRef(null)
  const didDragRef = useRef(false)
  const [mode, setMode] = useState('polygon')
  const [selectedId, setSelectedId] = useState(null)
  const [selectedProposalId, setSelectedProposalId] = useState(null)
  const [inProgress, setInProgress] = useState([])
  const [livePoint, setLivePoint] = useState(null)
  const [rectStart, setRectStart] = useState(null)
  const [liveRect, setLiveRect] = useState(null)
  const [editPolygon, setEditPolygon] = useState(null)
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
    rois.forEach((roi, _idx) => {
      const isSelected = roi.id === selectedId
      const isDrawing = inProgress.length > 0
      const spotType = roi.spotType || 'normal'
      const typeColor = SPOT_TYPE_COLORS[spotType]
      const baseColor = typeColor || ROI_COLOR
      const color = isDrawing && !isSelected ? '#2ecc71' : baseColor
      const fillColor = isDrawing && !isSelected ? 'rgba(46,204,113,0.25)' : hexToRgba(color, 0.3)
      const poly = (isSelected && editPolygon) ? editPolygon : roi.polygon
      const pts = poly.map(([x, y]) => [x * W, y * H])

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
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      if (spotType === 'normal') {
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText(roi.label, cx, cy)
      } else {
        // label on top line, type badge on bottom line
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText(roi.label, cx, cy - 8)
        ctx.font = spotType === 'handicap' ? 'bold 13px sans-serif' : 'bold 10px sans-serif'
        const badge = spotType === 'handicap'
          ? '♿'
          : (roi.owner ? roi.owner : 'RESERVED')
        ctx.fillText(badge, cx, cy + 7)
      }
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

    // Edit mode handles on selected ROI
    if (mode === 'edit' && selectedId) {
      const roi = rois.find(r => r.id === selectedId)
      if (roi) {
        const poly = editPolygon || roi.polygon
        const pts = poly.map(([x, y]) => [x * W, y * H])

        // vertex handles
        pts.forEach(([x, y]) => {
          ctx.beginPath()
          ctx.arc(x, y, 6, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fill()
          ctx.strokeStyle = '#3498db'
          ctx.lineWidth = 2
          ctx.stroke()
        })

        // edge midpoint handles
        pts.forEach(([x, y], i) => {
          const [nx, ny] = pts[(i + 1) % pts.length]
          const mx = (x + nx) / 2
          const my = (y + ny) / 2
          ctx.beginPath()
          ctx.rect(mx - 4, my - 4, 8, 8)
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.fill()
          ctx.strokeStyle = '#3498db'
          ctx.lineWidth = 1.5
          ctx.stroke()
        })
      }
    }

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
  }, [rois, proposals, selectedId, selectedProposalId, inProgress, livePoint, liveRect, mode, editPolygon])

  const syncSize = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const w = container.clientWidth
    const h = overlay ? container.clientHeight : Math.max(container.clientHeight, 300)
    if (w > 0 && h > 0) { canvas.width = w; canvas.height = h }
  }, [overlay])

  useEffect(() => {
    if (!backgroundImage) {
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
    const raf = requestAnimationFrame(() => { syncSize(); redraw() })
    return () => { window.removeEventListener('resize', handleResize); cancelAnimationFrame(raf) }
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
        if (dragRef.current) { dragRef.current = null; setEditPolygon(null) }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' && selectedId &&
                 !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        commitChange(rois.filter(r => r.id !== selectedId))
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, selectedId, rois, commitChange])

  useEffect(() => { redraw() }, [redraw])

  const makeRoi = useCallback((polygon) => {
    commitChange([...rois, {
      id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: `Slot ${rois.length + 1}`,
      polygon,
      color: ROI_COLOR,
      spotType: 'normal',
      owner: '',
    }])
  }, [rois, commitChange, idPrefix])

  const acceptProposal = useCallback((propId) => {
    if (!onProposalsChange) return
    const prop = proposals.find(p => p.id === propId)
    if (!prop) return
    const { proposed: _omit, ...base } = prop
    commitChange([...rois, { ...base, color: ROI_COLOR }])
    onProposalsChange(proposals.filter(p => p.id !== propId))
    setSelectedProposalId(null)
  }, [proposals, rois, commitChange, onProposalsChange])

  const acceptAllProposals = useCallback(() => {
    if (!onProposalsChange || proposals.length === 0) return
    const newRois = proposals.map((prop, _i) => {
      const { proposed: _omit, ...base } = prop
      return { ...base, color: ROI_COLOR }
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

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return
    const roi = rois.find(r => r.id === selectedId)
    if (!roi) return
    const OFFSET = 0.02
    commitChange([...rois, {
      ...roi,
      id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: `${roi.label} copy`,
      polygon: roi.polygon.map(([x, y]) => [Math.min(1, x + OFFSET), Math.min(1, y + OFFSET)]),
      color: ROI_COLOR,
    }])
  }, [selectedId, rois, commitChange, idPrefix])

  const scaleSelected = useCallback((factor) => {
    if (!selectedId) return
    const roi = rois.find(r => r.id === selectedId)
    if (!roi) return
    const [cx, cy] = getCentroid(roi.polygon)
    commitChange(rois.map(r =>
      r.id === selectedId
        ? {
            ...r, polygon: r.polygon.map(([x, y]) => [
              Math.max(0, Math.min(1, cx + (x - cx) * factor)),
              Math.max(0, Math.min(1, cy + (y - cy) * factor)),
            ])
          }
        : r
    ))
  }, [selectedId, rois, commitChange])

  const setSpotType = useCallback((type) => {
    if (!selectedId) return
    commitChange(rois.map(r => r.id === selectedId ? { ...r, spotType: type } : r))
  }, [selectedId, rois, commitChange])

  const setOwner = useCallback(() => {
    if (!selectedId) return
    const roi = rois.find(r => r.id === selectedId)
    if (!roi) return
    const name = window.prompt('Enter owner / reservation name (blank to clear):', roi.owner || '')
    if (name === null) return
    commitChange(rois.map(r => r.id === selectedId ? { ...r, owner: name.trim() } : r))
  }, [selectedId, rois, commitChange])

  const handleClick = useCallback((e) => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    const pt = getPoint(e)

    if (mode === 'edit') {
      if (proposals.length > 0) {
        const hitProp = [...proposals].reverse().find(p => pointInPolygon(pt[0], pt[1], p.polygon))
        if (hitProp) { setSelectedProposalId(hitProp.id); setSelectedId(null); return }
      }
      const hit = [...rois].reverse().find(r => pointInPolygon(pt[0], pt[1], r.polygon))
      setSelectedId(hit ? hit.id : null)
      setSelectedProposalId(null)
      return
    }

    if (mode === 'polygon') {
      if (inProgress.length === 0) {
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

    if (mode === 'edit' && dragRef.current) {
      const { type, vertexIdx, origPolygon, startPt } = dragRef.current
      if (type === 'vertex') {
        const cx = Math.max(0, Math.min(1, pt[0]))
        const cy = Math.max(0, Math.min(1, pt[1]))
        setEditPolygon(origPolygon.map((v, i) => i === vertexIdx ? [cx, cy] : v))
      } else if (type === 'polygon') {
        const dx = pt[0] - startPt[0]
        const dy = pt[1] - startPt[1]
        setEditPolygon(origPolygon.map(([x, y]) => [
          Math.max(0, Math.min(1, x + dx)),
          Math.max(0, Math.min(1, y + dy)),
        ]))
      }
      return
    }

    if (mode === 'polygon') {
      setLivePoint(pt)
    } else if (mode === 'rect' && rectStart) {
      setLiveRect({ x1: rectStart[0], y1: rectStart[1], x2: pt[0], y2: pt[1] })
    }
  }, [mode, rectStart, getPoint])

  const handleMouseDown = useCallback((e) => {
    if (mode === 'edit') {
      const pt = getPoint(e)
      const roi = selectedId ? rois.find(r => r.id === selectedId) : null
      if (roi) {
        const canvas = canvasRef.current
        const W = canvas ? canvas.width : 1
        const H = canvas ? canvas.height : 1
        const poly = roi.polygon

        // vertex handle hit
        for (let i = 0; i < poly.length; i++) {
          if (ptDistPx(pt[0], pt[1], poly[i][0], poly[i][1], W, H) < HIT_PX) {
            dragRef.current = { type: 'vertex', roiId: selectedId, vertexIdx: i, origPolygon: poly }
            setEditPolygon([...poly])
            didDragRef.current = true
            return
          }
        }

        // edge midpoint handle hit → insert vertex and drag it
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length
          const mx = (poly[i][0] + poly[j][0]) / 2
          const my = (poly[i][1] + poly[j][1]) / 2
          if (ptDistPx(pt[0], pt[1], mx, my, W, H) < HIT_PX) {
            const newPoly = [...poly.slice(0, j), [mx, my], ...poly.slice(j)]
            dragRef.current = { type: 'vertex', roiId: selectedId, vertexIdx: j, origPolygon: newPoly }
            setEditPolygon(newPoly)
            didDragRef.current = true
            return
          }
        }

        // polygon body → move whole polygon
        if (pointInPolygon(pt[0], pt[1], poly)) {
          dragRef.current = { type: 'polygon', roiId: selectedId, origPolygon: poly, startPt: pt }
          setEditPolygon([...poly])
          didDragRef.current = true
          return
        }
      }
      return
    }

    if (mode !== 'rect') return
    setRectStart(getPoint(e))
    setLiveRect(null)
  }, [mode, selectedId, rois, getPoint])

  const handleMouseUp = useCallback((e) => {
    if (mode === 'edit' && dragRef.current) {
      if (editPolygon) {
        const { roiId } = dragRef.current
        commitChange(rois.map(r => r.id === roiId ? { ...r, polygon: editPolygon } : r))
      }
      setEditPolygon(null)
      dragRef.current = null
      return
    }

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
  }, [mode, rectStart, rois, proposals, makeRoi, getPoint, editPolygon, commitChange])

  const changeMode = (m) => {
    setMode(m)
    setInProgress([])
    setRectStart(null)
    setLiveRect(null)
    setLivePoint(null)
    setEditPolygon(null)
    dragRef.current = null
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
  const selectedRoi = selectedId ? rois.find(r => r.id === selectedId) : null
  const selectedSpotType = selectedRoi?.spotType || 'normal'
  const typeBtnStyle = (active, accent) => ({
    padding: '4px 10px',
    borderRadius: 4,
    border: `1px solid ${active ? accent : 'rgba(255,255,255,0.18)'}`,
    background: active ? `${accent}22` : 'rgba(255,255,255,0.04)',
    color: active ? accent : 'var(--text-muted,#aaa)',
    cursor: 'pointer',
    fontSize: '0.76rem',
    fontWeight: active ? 700 : 400,
  })

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
        <button style={btnStyle(mode === 'edit')} onClick={() => changeMode('edit')}
          title="Select and drag vertices, edges, or whole polygons">
          Edit
        </button>
        <button
          style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
          disabled={!selectedId}
          onClick={duplicateSelected}
          title="Duplicate selected ROI with a small offset"
        >
          Duplicate
        </button>
        <button
          style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
          disabled={!selectedId}
          onClick={() => scaleSelected(1.1)}
          title="Scale selected ROI up 10%"
        >
          Scale +
        </button>
        <button
          style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
          disabled={!selectedId}
          onClick={() => scaleSelected(0.9)}
          title="Scale selected ROI down 10%"
        >
          Scale −
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

      {/* ── Spot type toolbar (visible when a ROI is selected) ── */}
      {selectedRoi && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
          marginBottom: overlay ? 0 : 6,
          padding: '5px 8px',
          background: overlay ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.04)',
          borderRadius: overlay ? 0 : 4,
          border: overlay ? 'none' : '1px solid rgba(255,255,255,0.1)',
          backdropFilter: overlay ? 'blur(4px)' : undefined,
        }}>
          <input
            value={selectedRoi.label}
            onChange={e => commitChange(rois.map(r => r.id === selectedId ? { ...r, label: e.target.value } : r))}
            style={{
              padding: '3px 7px', borderRadius: 4, fontSize: '0.76rem',
              border: '1px solid rgba(255,255,255,0.22)',
              background: 'rgba(255,255,255,0.07)', color: '#fff',
              width: 80, outline: 'none',
            }}
            title="Rename this spot (e.g. A1, B3)"
          />
          <span style={{ fontSize: '0.73rem', color: 'var(--text-muted,#aaa)', margin: '0 2px' }}>type:</span>
          <button style={typeBtnStyle(selectedSpotType === 'normal', '#2ecc71')} onClick={() => setSpotType('normal')}>Normal</button>
          <button style={typeBtnStyle(selectedSpotType === 'reserved', '#e6a817')} onClick={() => setSpotType('reserved')}>Reserved</button>
          <button style={typeBtnStyle(selectedSpotType === 'handicap', '#1a7fc1')} onClick={() => setSpotType('handicap')}>♿ Handicap</button>
          {selectedSpotType === 'reserved' && (
            <button
              style={{ ...typeBtnStyle(false, '#e6a817'), borderColor: 'rgba(230,168,23,0.4)', color: '#e6a817' }}
              onClick={setOwner}
              title="Set owner / reservation name shown on the spot"
            >
              {selectedRoi.owner ? `Owner: ${selectedRoi.owner}` : 'Set Owner…'}
            </button>
          )}
        </div>
      )}

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

      {/* ── Edit mode hint ── */}
      {mode === 'edit' && (
        <div style={{ fontSize: '0.72rem', color: 'rgba(100,200,255,0.8)', marginBottom: 8, paddingLeft: 2 }}>
          Edit mode — click to select, drag a vertex (circle) or edge midpoint (square) to reshape, drag inside to move. Delete key removes selected.
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
            cursor: mode === 'edit' ? 'default' : 'crosshair',
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
