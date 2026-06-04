const STATUS_STYLE = {
  vacant:    { fill: 'rgba(16,185,129,0.38)',  stroke: '#10b981', label: 'Vacant'    },
  occupied:  { fill: 'rgba(244,63,94,0.48)',   stroke: '#f43f5e', label: 'Occupied'  },
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

export default function LotMap({ slots, roiOnly = false, title = null }) {
  if (!slots || slots.length === 0) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const s of slots) {
    if (s.polygon) {
      for (const [px, py] of s.polygon) {
        if (px < minX) minX = px
        if (py < minY) minY = py
        if (px > maxX) maxX = px
        if (py > maxY) maxY = py
      }
    } else {
      const [x, y, w, h] = s.bbox
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x + w > maxX) maxX = x + w
      if (y + h > maxY) maxY = y + h
    }
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
