const s = {
  cell: {
    position: 'relative',
    background: '#000',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
    aspectRatio: '16/9',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  placeholder: {
    color: 'var(--text-muted)',
    fontSize: '0.78rem',
    textAlign: 'center',
    padding: 16,
  },
  nameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '20px 10px 6px',
    background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
  nameMini: {
    fontSize: '0.65rem',
    fontWeight: 600,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  badges: {
    display: 'flex',
    gap: 6,
  },
  badge: (color) => ({
    fontSize: '0.68rem',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 99,
    background: 'rgba(0,0,0,0.5)',
    color,
    border: `1px solid ${color}`,
  }),
  dot: (connected) => ({
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: connected ? 'var(--color-vacant)' : 'var(--color-occupied)',
    boxShadow: `0 0 6px ${connected ? 'var(--color-vacant)' : 'var(--color-occupied)'}`,
  }),
}

export default function CameraFeedCell({
  name,
  frame = null,
  metrics = { available: 0, occupied: 0 },
  connected = false,
  unavailable = null,
  onClick,
  mini = false,
}) {
  return (
    <div
      style={{ ...s.cell, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
    >
      {frame && !unavailable ? (
        <img
          src={`data:image/jpeg;base64,${frame}`}
          style={s.img}
          alt={name}
        />
      ) : (
        <div style={s.placeholder}>
          {unavailable ?? (connected ? 'Waiting for frames…' : 'Connecting…')}
        </div>
      )}

      <div style={s.dot(connected)} />

      <div style={s.nameOverlay}>
        <span style={mini ? s.nameMini : s.name}>{name}</span>
        {!mini && (
          <div style={s.badges}>
            <span style={s.badge('var(--color-vacant)')}>■ {metrics.available ?? 0} avail</span>
            <span style={s.badge('var(--color-occupied)')}>■ {metrics.occupied ?? 0} occ</span>
          </div>
        )}
      </div>
    </div>
  )
}
