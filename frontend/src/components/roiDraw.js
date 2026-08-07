import { ROI_COLOR, SPOT_TYPE_COLORS, hexToRgba, getCentroid, ptDistPx } from './roiGeometry'

// Auto-assigned names ("Slot 7", "Slot 7 copy") are just clutter over the handles
// while editing, so the canvas only draws a name the user typed themselves. The
// label is still stored and still shown everywhere else.
const drawnName = (label) => (!label || /^Slot \d+(?: copy)*$/.test(label) ? null : label)

// Render the full editor scene onto a 2D canvas context. Pure draw pass — every
// input comes in via `s`; nothing here reads component state or refs directly.
// `bgImg` is the loaded background Image (or null). `O`, `oGates`, `oFlow` are the
// orientation frame pieces.
export function drawScene(ctx, W, H, s) {
  const {
    bgImg, rois, proposals, selectedId, selectedProposalId, inProgress, livePoint,
    liveRect, mode, editPolygon, orientEnabled, layer, O, oGates, oFlow,
    perimDraft, flowStart, guide,
  } = s

  // View transform: image-normalised point → canvas pixel. Applied per coordinate
  // rather than via ctx.scale so handles, labels, and stroke widths keep their
  // screen size while the image zooms. ZW/ZH are the zoomed pixel spans, used
  // wherever a distance between two normalised points is compared against pixels.
  const { k = 1, ox = 0, oy = 0 } = s.view || {}
  const PX = x => (x * k + ox) * W
  const PY = y => (y * k + oy) * H
  const ZW = W * k
  const ZH = H * k

  ctx.clearRect(0, 0, W, H)

  if (bgImg) {
    ctx.drawImage(bgImg, PX(0), PY(0), ZW, ZH)
  }

  // Draw confirmed ROIs
  rois.forEach((roi) => {
    const isSelected = roi.id === selectedId
    const isDrawing = inProgress.length > 0
    const spotType = roi.spotType || 'normal'
    const typeColor = SPOT_TYPE_COLORS[spotType]
    const baseColor = typeColor || ROI_COLOR
    const color = isDrawing && !isSelected ? '#2ecc71' : baseColor
    const fillColor = isDrawing && !isSelected ? 'rgba(46,204,113,0.25)' : hexToRgba(color, 0.3)
    const poly = (isSelected && editPolygon) ? editPolygon : roi.polygon
    const pts = poly.map(([x, y]) => [PX(x), PY(y)])

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

    const name = drawnName(roi.label)
    if (spotType === 'normal') {
      if (name) {
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText(name, cx, cy)
      }
    } else {
      // name on top line, type badge on bottom line — badge centres alone when
      // the slot has no name of its own.
      if (name) {
        ctx.font = 'bold 11px sans-serif'
        ctx.fillText(name, cx, cy - 8)
      }
      ctx.font = spotType === 'handicap' ? 'bold 13px sans-serif' : 'bold 10px sans-serif'
      const badge = spotType === 'handicap'
        ? '♿'
        : (roi.owner ? roi.owner : 'RESERVED')
      ctx.fillText(badge, cx, name ? cy + 7 : cy)
    }
    ctx.shadowBlur = 0
  })

  // Draw proposed ROIs with ghost/dashed style
  proposals.forEach((prop) => {
    const isSelected = prop.id === selectedProposalId
    const pts = prop.polygon.map(([x, y]) => [PX(x), PY(y)])

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

    const name = drawnName(prop.label)
    if (name) {
      const [cx, cy] = getCentroid(pts)
      ctx.shadowColor = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur = 3
      ctx.fillStyle = isSelected ? '#64c8ff' : 'rgba(150,220,255,0.85)'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(`? ${name}`, cx, cy)
      ctx.shadowBlur = 0
    }
  })

  // Edit mode handles on selected ROI
  if (mode === 'edit' && selectedId) {
    const roi = rois.find(r => r.id === selectedId)
    if (roi) {
      const poly = editPolygon || roi.polygon
      const pts = poly.map(([x, y]) => [PX(x), PY(y)])

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
    const pts = inProgress.map(([x, y]) => [PX(x), PY(y)])
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
    if (livePoint) ctx.lineTo(PX(livePoint[0]), PY(livePoint[1]))
    ctx.setLineDash([5, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.setLineDash([])
    pts.forEach(([x, y], i) => {
      const isFirst = i === 0
      const nearClose = isFirst && livePoint && pts.length >= 3 && (() => {
        const dx = (livePoint[0] - inProgress[0][0]) * ZW
        const dy = (livePoint[1] - inProgress[0][1]) * ZH
        return Math.sqrt(dx * dx + dy * dy) < 15
      })()
      ctx.beginPath()
      ctx.arc(x, y, nearClose ? 8 : 4, 0, Math.PI * 2)
      ctx.fillStyle = nearClose ? '#2ecc71' : '#ffffff'
      ctx.fill()
    })
  }

  if (liveRect) {
    const x1 = PX(liveRect.x1), y1 = PY(liveRect.y1)
    const x2 = PX(liveRect.x2), y2 = PY(liveRect.y2)
    ctx.setLineDash([5, 3])
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
    ctx.setLineDash([])
  }

  // Drawing guides. Advisory marks only — the point goes wherever it is clicked.
  // A ring calls out the corner the cursor is near; the dashed lines mean the
  // cursor is level with a neighbouring corner's column or row.
  if (guide) {
    ctx.strokeStyle = 'rgba(250,204,21,0.55)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    if (guide.vx !== null) {
      const gx = PX(guide.vx)
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke()
    }
    if (guide.hy !== null) {
      const gy = PY(guide.hy)
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke()
    }
    ctx.setLineDash([])
    if (guide.corner) {
      ctx.beginPath()
      ctx.arc(PX(guide.corner[0]), PY(guide.corner[1]), 9, 0, Math.PI * 2)
      ctx.strokeStyle = '#facc15'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  // ── Orientation layer ── (dim in slots layer, full while editing it)
  if (orientEnabled) {
    const active = layer === 'orientation'
    const alpha = active ? 1 : 0.4
    const drawArrow = (x1, y1, x2, y2, color) => {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      const ang = Math.atan2(y2 - y1, x2 - x1), ah = 13
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 + ah * Math.cos(ang + Math.PI - 0.4), y2 + ah * Math.sin(ang + Math.PI - 0.4))
      ctx.lineTo(x2 + ah * Math.cos(ang + Math.PI + 0.4), y2 + ah * Math.sin(ang + Math.PI + 0.4))
      ctx.closePath(); ctx.fill()
    }

    // committed perimeters (containment areas)
    ;(Array.isArray(O.perimeters) ? O.perimeters : []).forEach(poly => {
      if (!Array.isArray(poly) || poly.length < 2) return
      ctx.beginPath()
      poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(PX(x), PY(y)) : ctx.lineTo(PX(x), PY(y))))
      ctx.closePath()
      ctx.setLineDash([10, 7])
      ctx.strokeStyle = `rgba(148,163,184,${alpha})`
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.setLineDash([])
    })
    // flow arrows
    oFlow.forEach(f => drawArrow(PX(f.from[0]), PY(f.from[1]), PX(f.to[0]), PY(f.to[1]), `rgba(56,189,248,${alpha})`))
    // gates
    oGates.forEach(g => {
      const gx = PX(g.x), gy = PY(g.y)
      const text = g.label || (g.kind === 'exit' ? 'Exit' : 'Entry')
      const bw = Math.max(38, text.length * 8 + 18)
      ctx.fillStyle = g.kind === 'exit' ? `rgba(244,63,94,${alpha})` : `rgba(16,185,129,${alpha})`
      ctx.beginPath(); ctx.roundRect(gx - bw / 2, gy - 12, bw, 24, 12); ctx.fill()
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.font = 'bold 12px system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(text, gx, gy)
    })
    // anchor
    if (O.anchor) {
      const ax = PX(O.anchor.x), ay = PY(O.anchor.y)
      ctx.beginPath(); ctx.arc(ax, ay, 9, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(250,204,21,${alpha})`
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 2
      ctx.fill(); ctx.stroke()
      ctx.fillStyle = `rgba(250,204,21,${alpha})`
      ctx.font = 'bold 11px system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(O.anchor.label || 'You are here', ax, ay + 22)
    }

    // in-progress perimeter draft + flow preview (only while editing)
    if (active) {
      if (perimDraft.length > 0) {
        const pts = perimDraft.map(([x, y]) => [PX(x), PY(y)])
        ctx.beginPath()
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
        if (livePoint) ctx.lineTo(PX(livePoint[0]), PY(livePoint[1]))
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5
        ctx.stroke(); ctx.setLineDash([])
        pts.forEach(([x, y], i) => {
          const near = i === 0 && livePoint && pts.length >= 3 &&
            ptDistPx(livePoint[0], livePoint[1], perimDraft[0][0], perimDraft[0][1], ZW, ZH) < 15
          ctx.beginPath(); ctx.arc(x, y, near ? 8 : 4, 0, Math.PI * 2)
          ctx.fillStyle = near ? '#2ecc71' : '#ffffff'; ctx.fill()
        })
      }
      if (flowStart && livePoint) {
        ctx.setLineDash([6, 4])
        drawArrow(PX(flowStart[0]), PY(flowStart[1]), PX(livePoint[0]), PY(livePoint[1]), 'rgba(56,189,248,0.8)')
        ctx.setLineDash([])
      }
    }
  }
}
