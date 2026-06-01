const STATUS_COLOR = {
  vacant:    { fill: 'rgba(16,185,129,0.35)',  stroke: '#10b981' },
  occupied:  { fill: 'rgba(244,63,94,0.45)',   stroke: '#f43f5e' },
  misparked: { fill: 'rgba(245,158,11,0.40)',  stroke: '#f59e0b' },
}
const DEFAULT_COLOR = { fill: 'rgba(139,149,165,0.15)', stroke: '#4a5568' }

export default function LotMap({ slots, demo = false, title = null }) {
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
  const pad = 12
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`

  return (
    <div style={{
      width: '100%',
      background: 'rgba(17,24,39,0.55)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 20px 16px',
      boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '1.5px',
          fontWeight: 600,
        }}>
          {title ? `${title} — ` : 'Lot Map — '}{slots.length} slots
        </div>
        {demo && (
          <span style={{
            fontSize: '0.6rem',
            color: 'var(--text-muted)',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            padding: '1px 6px',
            fontWeight: 600,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}>
            ROI
          </span>
        )}
      </div>

      <svg
        viewBox={vb}
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        aria-label="Parking lot map"
      >
        {slots.map(s => {
          const [x, y, w, h] = s.bbox
          const c = STATUS_COLOR[s.status] || DEFAULT_COLOR
          const fontSize = Math.max(9, Math.min(w, h) * 0.18)
          const cx = x + w / 2, cy = y + h / 2
          return (
            <g key={s.id}>
              {s.polygon && (
                <polygon
                  points={s.polygon.map(([px, py]) => `${px},${py}`).join(' ')}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={1.5}
                />
              )}
              {s.status && (
                <text
                  x={cx} y={cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={c.stroke}
                  fontSize={fontSize * 0.75}
                  opacity={0.8}
                  fontFamily="monospace"
                >
                  {s.status === 'vacant' ? 'FREE' : s.status === 'misparked' ? 'MISP' : 'OCC'}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div style={{ display: 'flex', gap: 20, marginTop: 12, justifyContent: 'center' }}>
        {[
          { label: 'Vacant',    key: 'vacant'    },
          { label: 'Occupied',  key: 'occupied'  },
          { label: 'Misparked', key: 'misparked' },
        ].map(({ label, key }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 12, height: 12, borderRadius: 3,
              background: (STATUS_COLOR[key] || DEFAULT_COLOR).fill,
              border: `1.5px solid ${(STATUS_COLOR[key] || DEFAULT_COLOR).stroke}`,
            }} />
            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
