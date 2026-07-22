import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ROI_COLOR, HIT_PX,
  pointInPolygon, getCentroid, ptDistPx,
  divideQuad, smoothRois, regularizeRows,
} from './roiGeometry'
import { drawScene } from './roiDraw'
import RoiToolbar from './RoiToolbar'

// Re-exported so existing importers (and the test suite) keep pulling these from
// this module; the implementations live in roiGeometry.
export { divideQuad, smoothRois, regularizeRows }

export default function RoiEditor({
  backgroundImage = null,
  rois,
  onRoisChange,
  proposals = [],
  onProposalsChange = null,
  overlay = false,
  idPrefix = 'roi',
  orientation = null,
  onOrientationChange = null,
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
  // ── Orientation layer (display-only frame: perimeter, gates, flow, anchor) ──
  const orientEnabled = !!onOrientationChange
  const [layer, setLayer] = useState('slots')            // 'slots' | 'orientation'
  const [orientTool, setOrientTool] = useState('perimeter')
  const [perimDraft, setPerimDraft] = useState([])       // perimeter points being drawn
  const [flowStart, setFlowStart] = useState(null)       // first click of a flow arrow
  const [orientPast, setOrientPast] = useState([])       // undo/redo stacks for the frame
  const [orientFuture, setOrientFuture] = useState([])
  const O = orientation || {}
  const oPerims = O.perimeters || []
  const oGates = O.gates || []
  const oFlow = O.flow || []

  const getPoint = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    const rect = canvas.getBoundingClientRect()
    // Touch events carry coords on touches/changedTouches; mouse falls through to e.
    const src = e.touches?.[0] || e.changedTouches?.[0] || e
    return [
      (src.clientX - rect.left) / rect.width,
      (src.clientY - rect.top) / rect.height,
    ]
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    drawScene(ctx, canvas.width, canvas.height, {
      bgImg: bgImgRef.current,
      rois, proposals, selectedId, selectedProposalId, inProgress, livePoint,
      liveRect, mode, editPolygon, orientEnabled, layer, O, oGates, oFlow,
      perimDraft, flowStart,
    })
  }, [rois, proposals, selectedId, selectedProposalId, inProgress, livePoint, liveRect, mode, editPolygon,
      orientEnabled, layer, orientation, perimDraft, flowStart, oPerims, O.anchor, oGates, oFlow])

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
    // The toolbar band grows/shrinks (e.g. spot-type row on selection), which
    // resizes the flex:1 canvas area in overlay mode — keep the canvas in sync.
    let ro
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(handleResize)
      ro.observe(containerRef.current)
    }
    return () => { window.removeEventListener('resize', handleResize); cancelAnimationFrame(raf); ro?.disconnect() }
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

  // ── Orientation-frame undo/redo (defined before the keydown effect that lists
  // them in its deps — otherwise the deps array hits the const's temporal dead
  // zone on every render and RoiEditor throws). ──
  const commitOrient = useCallback((patch) => {
    setOrientPast(p => [...p, orientation])
    setOrientFuture([])
    onOrientationChange?.({
      perimeters: oPerims, gates: oGates, flow: oFlow, anchor: O.anchor || null,
      ...patch,
    })
  }, [onOrientationChange, orientation, oPerims, O.anchor, oGates, oFlow])

  const undoOrient = useCallback(() => {
    if (orientPast.length === 0) return
    const prev = orientPast[orientPast.length - 1]
    setOrientPast(p => p.slice(0, -1))
    setOrientFuture(f => [orientation, ...f])
    onOrientationChange?.(prev)
  }, [orientPast, orientation, onOrientationChange])

  const redoOrient = useCallback(() => {
    if (orientFuture.length === 0) return
    const next = orientFuture[0]
    setOrientFuture(f => f.slice(1))
    setOrientPast(p => [...p, orientation])
    onOrientationChange?.(next)
  }, [orientFuture, orientation, onOrientationChange])

  useEffect(() => {
    const handleKeyDown = (e) => {
      const orienting = orientEnabled && layer === 'orientation'
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (e.key === 'Escape') {
        // Cancel any in-progress drawing (slot polygon or perimeter/flow draft).
        setInProgress([])
        setLivePoint(null)
        setPerimDraft([])
        setFlowStart(null)
        if (dragRef.current) { dragRef.current = null; setEditPolygon(null) }
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        orienting ? undoOrient() : undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault()
        orienting ? redoOrient() : redo()
      } else if (e.key === 'Delete' && !typing) {
        if (orienting) {
          // While drawing, drop the last perimeter point; otherwise remove the
          // most recently committed perimeter (undoable).
          if (perimDraft.length > 0) setPerimDraft(d => d.slice(0, -1))
          else if (oPerims.length) commitOrient({ perimeters: oPerims.slice(0, -1) })
        } else if (selectedId) {
          commitChange(rois.filter(r => r.id !== selectedId))
          setSelectedId(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, selectedId, rois, commitChange,
      orientEnabled, layer, undoOrient, redoOrient, perimDraft, oPerims, commitOrient])

  useEffect(() => { redraw() }, [redraw])

  const makeRoi = useCallback((polygon) => {
    const newRoi = {
      id: `${idPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: `Slot ${rois.length + 1}`,
      polygon,
      color: ROI_COLOR,
      spotType: 'normal',
      owner: '',
    }
    commitChange([...rois, newRoi])
    setSelectedId(newRoi.id)   // auto-select so Divide activates on a freshly drawn box
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

  // ── Orientation authoring ──
  const handleOrientClick = useCallback((pt) => {
    const [x, y] = pt
    const canvas = canvasRef.current
    const W = canvas ? canvas.width : 1
    const H = canvas ? canvas.height : 1
    const oid = () => `o_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const near = (ax, ay) => ptDistPx(x, y, ax, ay, W, H) < 16

    if (orientTool === 'perimeter') {
      if (perimDraft.length >= 3 && ptDistPx(x, y, perimDraft[0][0], perimDraft[0][1], W, H) < 15) {
        commitOrient({ perimeters: [...oPerims, perimDraft] })
        setPerimDraft([]); setLivePoint(null)
        return
      }
      setPerimDraft(prev => [...prev, pt])
    } else if (orientTool === 'entry' || orientTool === 'exit') {
      commitOrient({ gates: [...oGates, { id: oid(), x, y, kind: orientTool, label: orientTool === 'exit' ? 'Exit' : 'Entry' }] })
    } else if (orientTool === 'flow') {
      if (!flowStart) setFlowStart(pt)
      else { commitOrient({ flow: [...oFlow, { id: oid(), from: flowStart, to: pt }] }); setFlowStart(null) }
    } else if (orientTool === 'anchor') {
      commitOrient({ anchor: { x, y, label: 'You are here' } })
    } else if (orientTool === 'erase') {
      const gi = oGates.findIndex(g => near(g.x, g.y))
      if (gi >= 0) { commitOrient({ gates: oGates.filter((_, i) => i !== gi) }); return }
      if (O.anchor && near(O.anchor.x, O.anchor.y)) { commitOrient({ anchor: null }); return }
      const fi = oFlow.findIndex(f =>
        near(f.from[0], f.from[1]) || near(f.to[0], f.to[1]) ||
        near((f.from[0] + f.to[0]) / 2, (f.from[1] + f.to[1]) / 2))
      if (fi >= 0) { commitOrient({ flow: oFlow.filter((_, i) => i !== fi) }); return }
      // Perimeter last (large area) so a gate/flow inside it wins the click.
      const pi = oPerims.findIndex(poly => Array.isArray(poly) && poly.length >= 3 && pointInPolygon(x, y, poly))
      if (pi >= 0) commitOrient({ perimeters: oPerims.filter((_, i) => i !== pi) })
    }
  }, [orientTool, perimDraft, flowStart, oPerims, oGates, oFlow, O.anchor, commitOrient])

  const changeLayer = useCallback((l) => {
    setLayer(l)
    setPerimDraft([]); setFlowStart(null); setLivePoint(null)
    setInProgress([]); setSelectedId(null); setSelectedProposalId(null)
  }, [])

  const handleClick = useCallback((e) => {
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    const pt = getPoint(e)

    if (layer === 'orientation') { handleOrientClick(pt); return }

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
  }, [mode, inProgress, rois, proposals, getPoint, makeRoi, layer, handleOrientClick])

  const handleDblClick = useCallback((e) => {
    if (layer === 'orientation') {
      e.preventDefault()
      if (orientTool === 'perimeter' && perimDraft.length >= 3) {
        commitOrient({ perimeters: [...oPerims, perimDraft] })
        setPerimDraft([]); setLivePoint(null)
      }
      return
    }
    if (mode !== 'polygon') return
    e.preventDefault()
    const pts = inProgress.length > 0 ? inProgress.slice(0, -1) : inProgress
    if (pts.length >= 3) makeRoi(pts)
    setInProgress([])
  }, [mode, inProgress, makeRoi, layer, orientTool, perimDraft, oPerims, commitOrient])

  const handleMouseMove = useCallback((e) => {
    const pt = getPoint(e)

    if (layer === 'orientation') { setLivePoint(pt); return }

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
  }, [mode, rectStart, getPoint, layer])

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

  // Touch → mouse bridge: reuse the pointer logic so drawing/editing works with a
  // finger. touch-action:none on the canvas keeps a drag from scrolling the page.
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) handleMouseDown(e)
  }, [handleMouseDown])

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1) handleMouseMove(e)
  }, [handleMouseMove])

  const handleTouchEnd = useCallback((e) => {
    // Finish any drag, then register the tap as a click. preventDefault suppresses
    // the browser's emulated click so a polygon point isn't added twice per tap.
    e.preventDefault()
    handleMouseUp(e)
    handleClick(e)
  }, [handleMouseUp, handleClick])

  const changeMode = (m) => {
    setMode(m)
    setInProgress([])
    setRectStart(null)
    setLiveRect(null)
    setLivePoint(null)
    setEditPolygon(null)
    dragRef.current = null
  }

  const hasProposals = proposals.length > 0
  const selProp = selectedProposalId ? proposals.find(p => p.id === selectedProposalId) : null
  const selectedRoi = selectedId ? rois.find(r => r.id === selectedId) : null
  const selectedSpotType = selectedRoi?.spotType || 'normal'
  const canDivide = selectedRoi?.polygon.length === 4

  return (
    <div style={overlay ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' } : {}}>
      {/* ── Toolbar layer: in overlay it stacks above the canvas (flex column)
          so it never covers the image. ── */}
      <RoiToolbar
        overlay={overlay}
        mode={mode}
        changeMode={changeMode}
        selectedId={selectedId}
        duplicateSelected={duplicateSelected}
        scaleSelected={scaleSelected}
        divideN={divideN}
        setDivideN={setDivideN}
        canDivide={canDivide}
        divideSelected={divideSelected}
        commitChange={commitChange}
        rois={rois}
        setSelectedId={setSelectedId}
        setInProgress={setInProgress}
        smoothAll={smoothAll}
        selectedRoi={selectedRoi}
        selectedSpotType={selectedSpotType}
        setSpotType={setSpotType}
        setOwner={setOwner}
        hasProposals={hasProposals}
        proposals={proposals}
        smoothProposals={smoothProposals}
        selProp={selProp}
        acceptProposal={acceptProposal}
        acceptAllProposals={acceptAllProposals}
        discardProposal={discardProposal}
        discardAllProposals={discardAllProposals}
        orient={{
          orientEnabled, layer, changeLayer,
          orientTool, setOrientTool, flowStart, setFlowStart,
          commitOrient, setPerimDraft,
        }}
      />
      {/* ── Canvas ── */}
      <div ref={containerRef} style={overlay
        ? { position: 'relative', flex: 1, minHeight: 0, zIndex: 1 }
        : { position: 'relative', width: '100%', minHeight: 300, background: 'rgba(0,0,0,0.25)', borderRadius: 4 }
      }>
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: overlay ? '100%' : undefined,
            cursor: mode === 'edit' ? 'default' : 'crosshair',
            touchAction: 'none',
          }}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      </div>
    </div>
  )
}
