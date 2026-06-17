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

// Split a 4-corner quad into n stalls along its longer axis. Returns an array
// of n polygons, or null if the input isn't a quad / n < 2. Interpolating along
// the drawn edges keeps dividers converging toward the vanishing point, so
// stalls stay even on an oblique (trapezoidal) row. `aspect` is canvas H/W, used
// only to compare edge lengths in pixel space (normalized x/y scale differently).
export function divideQuad(polygon, n, aspect = 1) {
  if (!polygon || polygon.length !== 4 || n < 2) return null
  const len = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * aspect)
  const [p0, p1, p2, p3] = polygon
  // opposite-edge pairs: X = (p0-p1, p2-p3), Y = (p1-p2, p3-p0)
  const pairX = len(p0, p1) + len(p2, p3)
  const pairY = len(p1, p2) + len(p3, p0)
  // rotate so the long axis is the a0->a1 / a3->a2 pair
  const [a0, a1, a2, a3] = pairX >= pairY ? [p0, p1, p2, p3] : [p1, p2, p3, p0]
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const A = (t) => lerp(a0, a1, t)
  const B = (t) => lerp(a3, a2, t)
  const stalls = []
  for (let i = 0; i < n; i++) {
    const t0 = i / n
    const t1 = (i + 1) / n
    stalls.push([A(t0), A(t1), B(t1), B(t0)])
  }
  return stalls
}

// "Magic smooth": weld corners of *different* ROIs that sit within `thresh` of
// each other to their shared average, so adjacent stalls end up sharing one clean
// straight edge (like Divide output). `thresh` is a fraction of image width;
// `aspect` (canvas H/W) corrects the y distance. Returns a new rois array, or
// null if nothing was close enough to change.
export function smoothRois(rois, thresh = 0.015, aspect = 1) {
  const nodes = []
  rois.forEach((roi, ri) => roi.polygon.forEach((p, vi) => nodes.push({ ri, vi, x: p[0], y: p[1] })))
  const dist = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * aspect)

  const parent = nodes.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].ri === nodes[j].ri) continue // never weld a polygon to itself
      if (dist(nodes[i], nodes[j]) <= thresh) parent[find(i)] = find(j)
    }
  }

  const groups = new Map()
  nodes.forEach((_, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  })

  const newPolys = rois.map(r => r.polygon.map(p => [...p]))
  let changed = false
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    const counts = {}
    idxs.forEach(i => { counts[nodes[i].ri] = (counts[nodes[i].ri] || 0) + 1 })
    const rois_ = Object.keys(counts)
    // require >1 ROI and skip clusters that would collapse an edge of one ROI
    if (rois_.length < 2 || rois_.some(r => counts[r] > 1)) continue
    const cx = idxs.reduce((s, i) => s + nodes[i].x, 0) / idxs.length
    const cy = idxs.reduce((s, i) => s + nodes[i].y, 0) / idxs.length
    idxs.forEach(i => { newPolys[nodes[i].ri][nodes[i].vi] = [cx, cy] })
    changed = true
  }
  return changed ? rois.map((r, i) => ({ ...r, polygon: newPolys[i] })) : null
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const n = s.length
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

// Least-squares fit v = a*u + b over [u,v] points. Well-conditioned because the
// baselines run roughly along u (the row direction), so v varies slowly with u.
function fitLine(pts) {
  const n = pts.length
  let su = 0, sv = 0, suu = 0, suv = 0
  for (const [u, v] of pts) { su += u; sv += v; suu += u * u; suv += u * v }
  const denom = n * suu - su * su
  if (Math.abs(denom) < 1e-12) return [0, sv / n]
  const a = (n * suv - su * sv) / denom
  return [a, (sv - a * su) / n]
}

// Regularize auto-detected quads into clean rows. Each detected quad is sized to
// a car, not a stall, and neighbours don't share corners — so instead of welding
// we: estimate the row direction (PCA over centers), group items into rows by
// their cross-row offset, fit a top + bottom baseline per row, and rebuild each
// item as a uniform-width quad sitting between the baselines at its detected
// position. Same id/label kept; only polygons change. Returns null if no row had
// >= 2 items to align. `aspect` = canvas H/W (y is scaled so distances are
// pixel-proportional). No gaps are filled — one stall per detected item.
export function regularizeRows(items, aspect = 1) {
  if (!items || items.length < 2) return null
  const toP = ([x, y]) => [x, y * aspect]
  const clamp = (n) => Math.max(0, Math.min(1, n))
  const dot = (p, w) => p[0] * w[0] + p[1] * w[1]

  const centers = items.map(it => {
    const ps = it.polygon.map(toP)
    return [
      ps.reduce((s, p) => s + p[0], 0) / ps.length,
      ps.reduce((s, p) => s + p[1], 0) / ps.length,
    ]
  })

  // principal axis (row direction) via PCA over centers
  const mean = [
    centers.reduce((s, c) => s + c[0], 0) / centers.length,
    centers.reduce((s, c) => s + c[1], 0) / centers.length,
  ]
  let sxx = 0, sxy = 0, syy = 0
  for (const c of centers) {
    const dx = c[0] - mean[0], dy = c[1] - mean[1]
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const u = [Math.cos(theta), Math.sin(theta)]
  const v = [-Math.sin(theta), Math.cos(theta)]

  const meta = items.map((it, i) => {
    const ps = it.polygon.map(toP)
    const us = ps.map(p => dot(p, u))
    const vs = ps.map(p => dot(p, v))
    return {
      i,
      cu: dot(centers[i], u),
      cv: dot(centers[i], v),
      width: Math.max(...us) - Math.min(...us),
      depth: Math.max(...vs) - Math.min(...vs),
      us, vs,
    }
  })
  const medianDepth = median(meta.map(m => m.depth))

  // cluster into rows by cross-row offset: sort by v, split on a full-depth gap
  const sorted = [...meta].sort((a, b) => a.cv - b.cv)
  const rows = [[sorted[0]]]
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].cv - sorted[k - 1].cv > medianDepth) rows.push([])
    rows[rows.length - 1].push(sorted[k])
  }

  const newPolys = items.map(it => it.polygon)
  let changed = false
  for (const row of rows) {
    if (row.length < 2) continue
    const topPts = [], botPts = []
    for (const m of row) {
      const byV = m.vs.map((vv, k) => [vv, k]).sort((a, b) => a[0] - b[0]).map(p => p[1])
      ;[byV[0], byV[1]].forEach(k => topPts.push([m.us[k], m.vs[k]]))
      ;[byV[byV.length - 1], byV[byV.length - 2]].forEach(k => botPts.push([m.us[k], m.vs[k]]))
    }
    const [at, bt] = fitLine(topPts)
    const [ab, bb] = fitLine(botPts)
    const W = median(row.map(m => m.width))
    for (const m of row) {
      const uL = m.cu - W / 2, uR = m.cu + W / 2
      const quadUV = [
        [uL, at * uL + bt], [uR, at * uR + bt],
        [uR, ab * uR + bb], [uL, ab * uL + bb],
      ]
      newPolys[m.i] = quadUV.map(([uu, vv]) => [
        clamp(uu * u[0] + vv * v[0]),
        clamp((uu * u[1] + vv * v[1]) / aspect),
      ])
      changed = true
    }
  }
  return changed ? items.map((it, i) => ({ ...it, polygon: newPolys[i] })) : null
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
  const [divideN, setDivideN] = useState(4)

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

  const divideSelected = useCallback((n) => {
    if (!selectedId) return
    const roi = rois.find(r => r.id === selectedId)
    if (!roi) return
    const canvas = canvasRef.current
    const aspect = canvas && canvas.width ? canvas.height / canvas.width : 1
    const parts = divideQuad(roi.polygon, n, aspect)
    if (!parts) return
    const base = rois.length - 1 // the selected box is being replaced
    const stalls = parts.map((polygon, i) => ({
      id: `${idPrefix}_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      label: `Slot ${base + i + 1}`,
      polygon,
      color: ROI_COLOR,
      spotType: roi.spotType || 'normal',
      owner: roi.owner || '',
    }))
    commitChange([...rois.filter(r => r.id !== selectedId), ...stalls])
    setSelectedId(null)
  }, [selectedId, rois, commitChange, idPrefix])

  const smoothAll = useCallback(() => {
    const canvas = canvasRef.current
    const aspect = canvas && canvas.width ? canvas.height / canvas.width : 1
    const result = smoothRois(rois, 0.015, aspect)
    if (result) commitChange(result)
  }, [rois, commitChange])

  const smoothProposals = useCallback(() => {
    if (!onProposalsChange || proposals.length < 2) return
    const canvas = canvasRef.current
    const aspect = canvas && canvas.width ? canvas.height / canvas.width : 1
    const result = regularizeRows(proposals, aspect)
    if (result) onProposalsChange(result)
  }, [proposals, onProposalsChange])

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
  const canDivide = selectedRoi?.polygon.length === 4
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
    <div style={overlay ? { position: 'absolute', inset: 0 } : {}}>
      {/* ── Floating toolbar layer: in overlay it sits above the full-box canvas.
          pointerEvents:none lets clicks fall through to the canvas; each
          interactive toolbar re-enables pointerEvents on itself. ── */}
      <div style={overlay ? { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, pointerEvents: 'none' } : {}}>
      {/* ── ROI drawing toolbar ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', ...(overlay ? { padding: '6px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' } : {}) }}>
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
        <input
          type="number"
          min={2}
          value={divideN}
          onChange={e => setDivideN(Math.max(2, parseInt(e.target.value, 10) || 2))}
          style={{
            width: 42, padding: '4px 6px', borderRadius: 4, fontSize: '0.78rem',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted,#aaa)', outline: 'none',
          }}
          title="Number of stalls to split the selected box into"
        />
        <button
          style={{ ...btnStyle(false), opacity: canDivide ? 1 : 0.4 }}
          disabled={!canDivide}
          onClick={() => divideSelected(divideN)}
          title={canDivide
            ? 'Split the selected 4-corner box into N even stalls (perspective-aware)'
            : 'Select a 4-corner box (Rectangle, or a 4-point polygon) to divide'}
        >
          Divide
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
          style={{ ...btnStyle(false), opacity: rois.length >= 2 ? 1 : 0.4 }}
          disabled={rois.length < 2}
          onClick={smoothAll}
          title="Magic smooth — snap nearby corners of adjacent boxes together so shared edges line up cleanly"
        >
          ✨ Smooth
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
          pointerEvents: overlay ? 'auto' : undefined,
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
          pointerEvents: overlay ? 'auto' : undefined,
        }}>
          <span style={{ fontSize: '0.75rem', color: '#64c8ff', marginRight: 2 }}>
            {proposals.length} proposal{proposals.length > 1 ? 's' : ''} — dashed blue
          </span>
          <button
            style={proposalBtnStyle(proposals.length < 2)}
            disabled={proposals.length < 2}
            onClick={smoothProposals}
            title="Tidy auto-detected spots — align each row to clean baselines with a uniform stall size"
          >
            ✨ Tidy rows
          </button>
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

      </div>
      {/* ── Canvas ── */}
      <div ref={containerRef} style={overlay
        ? { position: 'absolute', inset: 0, zIndex: 1 }
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
