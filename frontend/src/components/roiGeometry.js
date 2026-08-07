export const ROI_COLOR = '#10b981'
export const SPOT_TYPE_COLORS = { normal: null, reserved: '#e6a817', handicap: '#1a7fc1' }
export const HIT_PX = 10

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function pointInPolygon(px, py, polygon) {
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

export function getCentroid(pts) {
  return [
    pts.reduce((s, [x]) => s + x, 0) / pts.length,
    pts.reduce((s, [, y]) => s + y, 0) / pts.length,
  ]
}

export function ptDistPx(ax, ay, bx, by, W, H) {
  const dx = (ax - bx) * W
  const dy = (ay - by) * H
  return Math.sqrt(dx * dx + dy * dy)
}

// Drawing aids for (x,y) against the corners of `polys`: the corner it is closest
// to, and the corner columns/rows it currently lines up with. Purely advisory —
// nothing here moves the point, the cursor stays where the user put it. Returns
// null when there is nothing to show. Thresholds are screen pixels, so pass the
// zoomed canvas span to keep the guides consistent at any zoom.
export function cornerGuides(x, y, polys, W, H, nearPx = 18, alignPx = 5) {
  let corner = null, bestD = nearPx
  let vx = null, bestVx = alignPx
  let hy = null, bestHy = alignPx
  for (const poly of polys) {
    for (const [px, py] of poly) {
      const d = ptDistPx(x, y, px, py, W, H)
      if (d < bestD) { bestD = d; corner = [px, py] }
      const dx = Math.abs(x - px) * W
      if (dx < bestVx) { bestVx = dx; vx = px }
      const dy = Math.abs(y - py) * H
      if (dy < bestHy) { bestHy = dy; hy = py }
    }
  }
  return (corner || vx !== null || hy !== null) ? { corner, vx, hy } : null
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

// Regularize roughly-drawn / detected stalls into clean rows while keeping the
// perspective fan. We estimate a row direction (PCA over centers), split items
// into depth-rows by their cross-row offset, then per row fit the two long curb
// lines and snap every top corner onto the front curb and every bottom corner
// onto the back curb. Each stall keeps its own width and each divider keeps its
// own slope, so an oblique lot's converging stalls are aligned, not flattened
// into parallel rectangles. Same id/label kept; only polygons change. Returns
// null if no row had >= 2 items to align. `aspect` = canvas H/W (y is scaled so
// distances are pixel-proportional). No gaps are filled — one stall per item.
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
      cv: dot(centers[i], v),
      depth: Math.max(...vs) - Math.min(...vs),
      us, vs,
    }
  })
  const medianDepth = median(meta.map(m => m.depth))

  // cluster into depth-rows by cross-row offset: sort by v, split on a gap. Two
  // depth-rows of a lot share their middle curb, so their depths overlap and their
  // centers sit only ~half a depth apart — split on half-depth, not full depth.
  const sorted = [...meta].sort((a, b) => a.cv - b.cv)
  const rows = [[sorted[0]]]
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].cv - sorted[k - 1].cv > medianDepth * 0.5) rows.push([])
    rows[rows.length - 1].push(sorted[k])
  }

  const newPolys = items.map(it => it.polygon)
  let changed = false
  for (const row of rows) {
    if (row.length < 2) continue
    // per stall, split its corners into a top half (low v) and a bottom half
    // (high v); record each side seam's along-row position at top and at bottom.
    const topPts = [], botPts = []
    const seams = []
    for (const m of row) {
      const order = m.vs.map((vv, k) => [vv, k]).sort((a, b) => a[0] - b[0]).map(p => p[1])
      const half = Math.max(1, Math.floor(order.length / 2))
      const topK = order.slice(0, half), botK = order.slice(order.length - half)
      topK.forEach(k => topPts.push([m.us[k], m.vs[k]]))
      botK.forEach(k => botPts.push([m.us[k], m.vs[k]]))
      const topU = topK.map(k => m.us[k]), botU = botK.map(k => m.us[k])
      seams.push({
        i: m.i,
        uTL: Math.min(...topU), uTR: Math.max(...topU),
        uBL: Math.min(...botU), uBR: Math.max(...botU),
      })
    }
    // fit the row's two long curbs; snap every top corner onto the front curb and
    // every bottom corner onto the back curb, keeping each stall's own width and
    // each divider's own slope (uTL != uBL stays slanted -> perspective fan kept).
    const [at, bt] = fitLine(topPts)
    const [ab, bb] = fitLine(botPts)
    for (const s of seams) {
      const quadUV = [
        [s.uTL, at * s.uTL + bt], [s.uTR, at * s.uTR + bt],
        [s.uBR, ab * s.uBR + bb], [s.uBL, ab * s.uBL + bb],
      ]
      newPolys[s.i] = quadUV.map(([uu, vv]) => [
        clamp(uu * u[0] + vv * v[0]),
        clamp((uu * u[1] + vv * v[1]) / aspect),
      ])
      changed = true
    }
  }
  return changed ? items.map((it, i) => ({ ...it, polygon: newPolys[i] })) : null
}
