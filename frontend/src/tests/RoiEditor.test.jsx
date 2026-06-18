import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RoiEditor, { divideQuad, smoothRois, regularizeRows } from '../components/RoiEditor'

// 1×1 transparent PNG data URL — component requires a truthy backgroundImage to render
const BLANK_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('RoiEditor', () => {
  it('renders canvas element', () => {
    render(
      <RoiEditor
        backgroundImage={BLANK_IMAGE}
        rois={[]}
        onRoisChange={vi.fn()}
      />
    )
    expect(document.querySelector('canvas')).toBeTruthy()
  })

  it('renders Polygon and Rectangle toolbar buttons', () => {
    render(
      <RoiEditor
        backgroundImage={BLANK_IMAGE}
        rois={[]}
        onRoisChange={vi.fn()}
      />
    )
    expect(screen.getByText('Polygon')).toBeTruthy()
    expect(screen.getByText('Rectangle')).toBeTruthy()
  })
})

describe('divideQuad', () => {
  // axis-aligned 1x1 box, wider than tall along x via aspect
  const box = [[0, 0], [1, 0], [1, 1], [0, 1]]

  it('returns null for non-quads or n < 2', () => {
    expect(divideQuad([[0, 0], [1, 0], [1, 1]], 3)).toBeNull()
    expect(divideQuad(box, 1)).toBeNull()
  })

  it('splits a box into n contiguous stalls along the long axis', () => {
    // aspect < 1 makes the x edges the longer pair, so stalls cut across x
    const stalls = divideQuad(box, 4, 0.25)
    expect(stalls).toHaveLength(4)
    // first stall starts at x=0, last ends at x=1
    expect(stalls[0][0][0]).toBeCloseTo(0)
    expect(stalls[3][1][0]).toBeCloseTo(1)
    // dividers are contiguous: stall i's right edge == stall i+1's left edge
    for (let i = 0; i < 3; i++) {
      expect(stalls[i][1][0]).toBeCloseTo(stalls[i + 1][0][0])
    }
    // each stall spans the full short axis (y: 0 -> 1)
    expect(stalls[0][0][1]).toBeCloseTo(0)
    expect(stalls[0][3][1]).toBeCloseTo(1)
  })

  it('keeps even widths on a trapezoid (perspective)', () => {
    // wide row: top edge shorter than bottom, short slanted depth edges ->
    // long axis is the top/bottom pair, dividers fall at even edge fractions
    const trap = [[0.2, 0.4], [0.8, 0.4], [1, 0.6], [0, 0.6]]
    const stalls = divideQuad(trap, 2, 1)
    // midpoint of top edge is 0.5; first stall's top-right x should be there
    expect(stalls[0][1][0]).toBeCloseTo(0.5)
    // midpoint of bottom edge is also 0.5
    expect(stalls[0][2][0]).toBeCloseTo(0.5)
  })
})

describe('smoothRois', () => {
  it('welds near corners of adjacent boxes to a shared point', () => {
    const a = { id: 'a', polygon: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]] }
    const b = { id: 'b', polygon: [[0.51, 0.01], [1, 0], [1, 1], [0.49, 0.99]] }
    const out = smoothRois([a, b], 0.05, 1)
    expect(out).not.toBeNull()
    // a's top-right corner and b's top-left corner now coincide
    expect(out[0].polygon[1][0]).toBeCloseTo(out[1].polygon[0][0])
    expect(out[0].polygon[1][1]).toBeCloseTo(out[1].polygon[0][1])
    // ...and bottom shared corner too
    expect(out[0].polygon[2][0]).toBeCloseTo(out[1].polygon[3][0])
  })

  it('returns null when nothing is close enough', () => {
    const a = { id: 'a', polygon: [[0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2]] }
    const b = { id: 'b', polygon: [[0.8, 0.8], [1, 0.8], [1, 1], [0.8, 1]] }
    expect(smoothRois([a, b], 0.015, 1)).toBeNull()
  })

  it('never welds corners that belong to the same polygon', () => {
    // a's own corners are within thresh, but b is far away → no cross-ROI weld
    const a = { id: 'a', polygon: [[0, 0], [0.01, 0], [0.01, 1], [0, 1]] }
    const b = { id: 'b', polygon: [[0.5, 0], [0.6, 0], [0.6, 1], [0.5, 1]] }
    expect(smoothRois([a, b], 0.02, 1)).toBeNull()
  })
})

describe('regularizeRows', () => {
  // helper: axis-aligned quad from center-x, top-y, bottom-y, half-width
  const mk = (id, cx, top, bot, halfw) => ({
    id, label: id, proposed: true,
    polygon: [[cx - halfw, top], [cx + halfw, top], [cx + halfw, bot], [cx - halfw, bot]],
  })

  it('aligns a jittered row to common baselines, keeping each stall width', () => {
    const items = [
      mk('a', 0.2, 0.40, 0.60, 0.06),
      mk('b', 0.5, 0.42, 0.62, 0.08),
      mk('c', 0.8, 0.39, 0.59, 0.05),
    ]
    const out = regularizeRows(items, 1)
    expect(out).not.toBeNull()
    // top corners now lie on one near-horizontal line
    const topYs = out.map(o => o.polygon[0][1])
    expect(Math.max(...topYs) - Math.min(...topYs)).toBeLessThan(0.02)
    // each stall keeps its own (differing) width — not forced uniform
    const width = o => Math.hypot(
      o.polygon[1][0] - o.polygon[0][0], o.polygon[1][1] - o.polygon[0][1])
    expect(width(out[0])).toBeCloseTo(0.12, 2)
    expect(width(out[1])).toBeCloseTo(0.16, 2)
    expect(width(out[2])).toBeCloseTo(0.10, 2)
    // id / order / extra fields preserved
    expect(out.map(o => o.id)).toEqual(['a', 'b', 'c'])
    expect(out[0].proposed).toBe(true)
  })

  it('preserves each divider slant on an angled row (no flattening)', () => {
    // two adjacent slanted stalls sharing an edge; bottoms shifted right of tops
    const slant = (id, tl, tr) => ({
      id, label: id, proposed: true,
      polygon: [[tl, 0.40], [tr, 0.40], [tr + 0.05, 0.60], [tl + 0.05, 0.60]],
    })
    const items = [slant('a', 0.20, 0.40), slant('b', 0.40, 0.60)]
    const out = regularizeRows(items, 1)
    expect(out).not.toBeNull()
    // tops aligned on one line
    expect(out[0].polygon[0][1]).toBeCloseTo(out[1].polygon[1][1], 3)
    // slant kept: each stall's top-left x differs from its bottom-left x
    expect(Math.abs(out[0].polygon[0][0] - out[0].polygon[3][0])).toBeGreaterThan(0.02)
    expect(Math.abs(out[1].polygon[0][0] - out[1].polygon[3][0])).toBeGreaterThan(0.02)
  })

  it('keeps detected gaps (no fill): stall centers stay put', () => {
    const items = [mk('a', 0.2, 0.4, 0.6, 0.06), mk('b', 0.8, 0.4, 0.6, 0.06)]
    const out = regularizeRows(items, 1)
    const cx = o => (o.polygon[0][0] + o.polygon[1][0]) / 2
    expect(cx(out[0])).toBeCloseTo(0.2, 2)
    expect(cx(out[1])).toBeCloseTo(0.8, 2)
  })

  it('returns null for fewer than 2 items', () => {
    expect(regularizeRows([mk('a', 0.5, 0.4, 0.6, 0.06)], 1)).toBeNull()
  })
})
