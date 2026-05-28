const style = {
  container: {
    position: 'relative',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    background: '#000',
    aspectRatio: '16 / 9',
    maxHeight: 500,
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  },
  overlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    display: 'flex',
    gap: 8,
  },
  placeholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-secondary)',
    gap: 12,
  },
  placeholderIcon: {
    fontSize: '3rem',
    opacity: 0.3,
  },
}

export default function VideoFeed({ frame, connected }) {
  return (
    <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={style.container}>
        {frame ? (
          <img
            src={`data:image/jpeg;base64,${frame}`}
            alt="Parking lot live feed"
            style={style.img}
          />
        ) : (
          <div style={style.placeholder}>
            <div style={style.placeholderIcon}>📹</div>
            <div className="text-sm">
              {connected ? 'Waiting for video feed...' : 'Connect to start streaming'}
            </div>
          </div>
        )}

        {/* Live indicator overlay */}
        <div style={style.overlay}>
          {connected && frame && (
            <span className="badge badge-occupied" style={{
              background: 'rgba(239,68,68,0.9)',
              color: '#fff',
              fontSize: '0.65rem',
            }}>
              ● LIVE
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
