import { useState, useEffect, useRef, useCallback } from 'react'

const WS_BASE = `ws://${window.location.hostname}:8000`
const _API_KEY = import.meta.env.VITE_API_KEY ?? ''

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

export default function CameraFeedCell({ cameraId, name, onMetricsUpdate }) {
  const [frame, setFrame] = useState(null)
  const [metrics, setMetrics] = useState({ available: 0, occupied: 0 })
  const [connected, setConnected] = useState(false)
  const [unavailable, setUnavailable] = useState(null)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const stopReconnect = useRef(false)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
    const ws = new WebSocket(`${WS_BASE}/ws/cameras/${cameraId}${wsToken}`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setUnavailable(null)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'feed_unavailable') {
          stopReconnect.current = true
          setUnavailable(data.reason ?? 'Feed unavailable')
          setConnected(false)
          clearTimeout(reconnectTimer.current)
          ws.close()
          return
        }
        if (data.error) {
          ws.close()
          return
        }
        if (data.frame) setFrame(data.frame)
        if (data.metrics) {
          setMetrics(data.metrics)
          onMetricsUpdate?.(cameraId, data.metrics)
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      setConnected(false)
      if (!stopReconnect.current) reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }, [cameraId, onMetricsUpdate])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return (
    <div style={s.cell}>
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
        <span style={s.name}>{name}</span>
        <div style={s.badges}>
          <span style={s.badge('var(--color-vacant)')}>■ {metrics.available ?? 0} avail</span>
          <span style={s.badge('var(--color-occupied)')}>■ {metrics.occupied ?? 0} occ</span>
        </div>
      </div>
    </div>
  )
}
