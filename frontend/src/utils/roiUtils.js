const CANVAS_W = 1000
const CANVAS_H = 600

export function roiToSlot(roi) {
  const pts = roi.polygon.map(([nx, ny]) => [nx * CANVAS_W, ny * CANVAS_H])
  const xs = pts.map(p => p[0])
  const ys = pts.map(p => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const w = Math.max(...xs) - x
  const h = Math.max(...ys) - y
  return {
    id: roi.id,
    label: roi.label,
    status: null,
    bbox: [x, y, w, h],
    polygon: pts,
    spotType: roi.spotType || 'normal',
    owner: roi.owner || '',
  }
}
