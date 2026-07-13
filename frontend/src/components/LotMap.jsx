import { CANVAS_W, CANVAS_H } from '../utils/roiUtils'

const GATE_STYLE = {
  entry: { fill: 'rgba(16,185,129,0.9)',  label: 'Entry' },
  exit:  { fill: 'rgba(244,63,94,0.9)',   label: 'Exit'  },
}

const STATUS_STYLE = {
  vacant:    { fill: 'rgba(16,185,129,0.38)',  stroke: '#10b981', label: 'Vacant'    },
  occupied:  { fill: 'rgba(244,63,94,0.48)',   stroke: '#f43f5e', label: 'Occupied'  },
  unavailable: { fill: 'rgba(244,63,94,0.48)', stroke: '#f43f5e', label: 'Unavailable' },
  misparked: { fill: 'rgba(245,158,11,0.42)',  stroke: '#f59e0b', label: 'Misparked' },
}
const NO_STATUS_STYLE = { fill: 'rgba(100,116,139,0.13)', stroke: 'rgba(100,116,139,0.38)', label: 'No Data' }

const TYPE_COLOR = { reserved: '#e6a817', handicap: '#1a7fc1' }

function centroid(pts) {
  return [
    pts.reduce((s, [x]) => s + x, 0) / pts.length,
    pts.reduce((s, [, y]) => s + y, 0) / pts.length,
  ]
}

// Orientation coords are stored normalized (0–1); slot coords here live in the
// CANVAS_W×CANVAS_H space that roiToSlot projects into, so scale to match.
const scaleOrient = (o) => {
  if (!o) return null
  const pt = ([x, y]) => [x * CANVAS_W, y * CANVAS_H]
  return {
    perimeter: Array.isArray(o.perimeter) ? o.perimeter.map(pt) : null,
    gates: Array.isArray(o.gates) ? o.gates.map(g => ({ ...g, x: g.x * CANVAS_W, y: g.y * CANVAS_H })) : [],
    flow: Array.isArray(o.flow) ? o.flow.map(f => ({ ...f, from: pt(f.from), to: pt(f.to) })) : [],
    anchor: o.anchor ? { ...o.anchor, x: o.anchor.x * CANVAS_W, y: o.anchor.y * CANVAS_H } : null,
  }
}

export default function LotMap({ slots, orientation = null, roiOnly = false, title = null }) {
  if (!slots || slots.length === 0) return null

  const orient = scaleOrient(orientation)

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const fold = (x, y) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  for (const s of slots) {
    if (s.polygon) {
      for (const [px, py] of s.polygon) fold(px, py)
    } else {
      const [x, y, w, h] = s.bbox
      fold(x, y)
      fold(x + w, y + h)
    }
  }
  // Fold the orientation frame into the bounds so the perimeter isn't clipped.
  if (orient?.perimeter) for (const [px, py] of orient.perimeter) fold(px, py)
  if (orient) {
    for (const g of orient.gates) fold(g.x, g.y)
    for (const f of orient.flow) { fold(...f.from); fold(...f.to) }
    if (orient.anchor) fold(orient.anchor.x, orient.anchor.y)
  }
  const pad = 18
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`

  const hasReserved  = slots.some(s => (s.spotType || 'normal') === 'reserved')
  const hasHandicap  = slots.some(s => (s.spotType || 'normal') === 'handicap')

  return (
    <div style={{
      width: '100%',
      background: 'rgba(17,24,39,0.55)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 'var(--radius-lg)',
      padding: '18px 20px 14px',
      boxSizing: 'border-box',
    }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{
          fontSize: '0.7rem', color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '1.5px', fontWeight: 600,
        }}>
          {title ? `${title} — ` : 'Lot Map — '}{slots.length} slot{slots.length !== 1 ? 's' : ''}
        </span>
        {roiOnly && (
          <span style={{
            fontSize: '0.6rem', color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
            borderRadius: 4, padding: '1px 6px', fontWeight: 600,
            letterSpacing: '0.5px', textTransform: 'uppercase',
          }}>ROI</span>
        )}
      </div>

      {/* ── SVG map ── */}
      <svg viewBox={vb} width="100%" style={{ display: 'block', overflow: 'visible' }} aria-label="Parking lot map">

        {/* Lot background */}
        <rect
          x={minX - pad} y={minY - pad}
          width={maxX - minX + pad * 2} height={maxY - minY + pad * 2}
          rx={10} fill="rgba(12,18,28,0.55)" stroke="rgba(255,255,255,0.04)" strokeWidth={1}
        />

        {/* ── Orientation layer (display only — never processed) ── */}
        {orient && (
          <g style={{ pointerEvents: 'none' }}>
            {/* Perimeter / drive lane */}
            {orient.perimeter && orient.perimeter.length >= 2 && (
              <polygon
                points={orient.perimeter.map(([x, y]) => `${x},${y}`).join(' ')}
                fill="none"
                stroke="rgba(148,163,184,0.55)"
                strokeWidth={2.5}
                strokeDasharray="10,7"
                strokeLinejoin="round"
              />
            )}

            {/* Flow arrows */}
            {orient.flow.map((f, i) => {
              const [x1, y1] = f.from
              const [x2, y2] = f.to
              const ang = Math.atan2(y2 - y1, x2 - x1)
              const ah = 13
              const a1 = ang + Math.PI - 0.4
              const a2 = ang + Math.PI + 0.4
              return (
                <g key={f.id || `flow-${i}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="rgba(56,189,248,0.75)" strokeWidth={3} strokeLinecap="round" />
                  <polygon
                    points={`${x2},${y2} ${x2 + ah * Math.cos(a1)},${y2 + ah * Math.sin(a1)} ${x2 + ah * Math.cos(a2)},${y2 + ah * Math.sin(a2)}`}
                    fill="rgba(56,189,248,0.85)"
                  />
                </g>
              )
            })}

            {/* Gates */}
            {orient.gates.map((g, i) => {
              const gs = GATE_STYLE[g.kind] || GATE_STYLE.entry
              const text = g.label || gs.label
              const w = Math.max(38, text.length * 8 + 18)
              return (
                <g key={g.id || `gate-${i}`}>
                  <rect x={g.x - w / 2} y={g.y - 12} width={w} height={24} rx={12} fill={gs.fill} />
                  <text x={g.x} y={g.y} textAnchor="middle" dominantBaseline="middle"
                    fill="#fff" fontSize={12} fontFamily="system-ui,sans-serif" fontWeight="700">
                    {text}
                  </text>
                </g>
              )
            })}

            {/* Orientation anchor ("you are here") */}
            {orient.anchor && (
              <g>
                <circle cx={orient.anchor.x} cy={orient.anchor.y} r={9}
                  fill="rgba(250,204,21,0.9)" stroke="#fff" strokeWidth={2} />
                <text x={orient.anchor.x} y={orient.anchor.y + 24} textAnchor="middle"
                  fill="rgba(250,204,21,0.95)" fontSize={11} fontFamily="system-ui,sans-serif" fontWeight="700">
                  {orient.anchor.label || 'You are here'}
                </text>
              </g>
            )}
          </g>
        )}

        {slots.map(s => {
          const spotType = s.spotType || 'normal'
          const style    = STATUS_STYLE[s.status] || NO_STATUS_STYLE
          const typeColor = TYPE_COLOR[spotType]
          const pts = s.polygon
          const polyStr = pts?.map(([px, py]) => `${px},${py}`).join(' ')
          const [bx, by, bw, bh] = s.bbox
          const [cx, cy] = pts ? centroid(pts) : [bx + bw / 2, by + bh / 2]
          const fs = Math.max(7, Math.min(bw, bh) * 0.16)

          // label + badge vertical layout
          const hasBadge = spotType !== 'normal'
          const labelY  = hasBadge ? cy - fs * 0.85 : cy
          const badgeY  = cy + fs * 1.1
          const ownerY  = cy + fs * 2.3

          return (
            <g key={s.id}>
              {/* Base polygon — status-driven fill */}
              {pts && (
                <polygon
                  points={polyStr}
                  fill={style.fill}
                  stroke={style.stroke}
                  strokeWidth={1.8}
                  strokeLinejoin="round"
                />
              )}

              {/* Type border overlay */}
              {spotType !== 'normal' && pts && (
                <polygon
                  points={polyStr}
                  fill="none"
                  stroke={typeColor}
                  strokeWidth={2.8}
                  strokeDasharray={spotType === 'reserved' ? '6,3' : undefined}
                  strokeLinejoin="round"
                />
              )}

              {/* Label pill background */}
              <rect
                x={cx - fs * 2.2} y={labelY - fs * 0.8}
                width={fs * 4.4} height={fs * 1.6}
                rx={fs * 0.35} fill="rgba(0,0,0,0.52)"
              />
              {/* Label text */}
              <text
                x={cx} y={labelY}
                textAnchor="middle" dominantBaseline="middle"
                fill="#ffffff" fontSize={fs}
                fontFamily="system-ui,sans-serif" fontWeight="700"
                letterSpacing="0.2"
              >
                {s.label}
              </text>

              {/* Handicap symbol */}
              {spotType === 'handicap' && (
                <text
                  x={cx} y={badgeY}
                  textAnchor="middle" dominantBaseline="middle"
                  fill={typeColor} fontSize={fs * 1.2}
                  fontFamily="system-ui,sans-serif"
                >
                  ♿
                </text>
              )}

              {/* Reserved badge */}
              {spotType === 'reserved' && (
                <>
                  <text
                    x={cx} y={badgeY}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={typeColor} fontSize={fs * 0.82}
                    fontFamily="system-ui,sans-serif" fontWeight="700"
                    letterSpacing="0.5"
                  >
                    {s.owner || 'RESERVED'}
                  </text>
                  {/* owner sub-line when owner differs from badge */}
                  {s.owner && (
                    <text
                      x={cx} y={ownerY}
                      textAnchor="middle" dominantBaseline="middle"
                      fill={typeColor} fontSize={fs * 0.72}
                      fontFamily="system-ui,sans-serif" opacity={0.75}
                    >
                      reserved
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>

      {/* ── Legend ── */}
      <div style={{
        display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap',
        justifyContent: 'center', alignItems: 'center',
      }}>
        {/* Status entries */}
        {[...Object.entries(STATUS_STYLE), ['none', NO_STATUS_STYLE]].map(([key, st]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 11, height: 11, borderRadius: 3,
              background: st.fill, border: `1.5px solid ${st.stroke}`,
            }} />
            <span style={{ fontSize: '0.69rem', color: 'var(--text-secondary)' }}>{st.label}</span>
          </div>
        ))}

        {/* Divider */}
        {(hasReserved || hasHandicap) && (
          <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.12)', margin: '0 2px' }} />
        )}

        {/* Type entries — only shown if at least one of that type exists */}
        {hasReserved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 11, height: 11, borderRadius: 3, background: 'transparent',
              border: `2px dashed ${TYPE_COLOR.reserved}`,
            }} />
            <span style={{ fontSize: '0.69rem', color: 'var(--text-secondary)' }}>Reserved</span>
          </div>
        )}
        {hasHandicap && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 11, height: 11, borderRadius: 3, background: 'transparent',
              border: `2px solid ${TYPE_COLOR.handicap}`,
            }} />
            <span style={{ fontSize: '0.69rem', color: 'var(--text-secondary)' }}>♿ Handicap</span>
          </div>
        )}
      </div>
    </div>
  )
}
