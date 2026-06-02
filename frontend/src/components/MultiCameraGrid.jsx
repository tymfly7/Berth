import { useState, useCallback, useEffect, useRef, memo } from 'react'
import CameraFeedCell from './CameraFeedCell'

const WS_BASE = `ws://${window.location.hostname}:8000`
const _API_KEY = import.meta.env.VITE_API_KEY ?? ''

// Owns one camera's WebSocket + state. Re-renders only when its own data changes.
const CameraFeed = memo(function CameraFeed({ cam, onMetrics, onClick, mini }) {
  const [frame, setFrame]           = useState(null)
  const [metrics, setMetrics]       = useState({ available: 0, occupied: 0 })
  const [connected, setConnected]   = useState(false)
  const [unavailable, setUnavailable] = useState(null)

  const wsRef              = useRef(null)
  const reconnectTimer     = useRef(null)
  const stopReconnect      = useRef(false)
  const onMetricsRef       = useRef(onMetrics)
  onMetricsRef.current     = onMetrics
  const metricsThrottleRef = useRef(0)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
    const ws = new WebSocket(`${WS_BASE}/ws/cameras/${cam.id}${wsToken}`)
    wsRef.current = ws

    ws.onopen = () => { stopReconnect.current = false; setConnected(true); setUnavailable(null) }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'feed_unavailable') {
          // "Camera is not active" is transient — the processor may still be
          // loading on startup.  Allow the onclose handler to schedule a retry.
          // All other reasons (stream timeout, camera removed) are permanent.
          const permanent = data.reason !== 'Camera is not active'
          stopReconnect.current = permanent
          clearTimeout(reconnectTimer.current)
          setConnected(false)
          setUnavailable(permanent ? (data.reason ?? 'Feed unavailable') : null)
          ws.close()
          return
        }
        if (data.error) { ws.close(); return }
        if (data.frame) setFrame(data.frame)
        if (data.metrics) {
          const now = Date.now()
          if (now - metricsThrottleRef.current >= 500) {
            metricsThrottleRef.current = now
            setMetrics(data.metrics)
            onMetricsRef.current?.(cam.id, data.metrics)
          }
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setConnected(false)
      if (!stopReconnect.current) reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }, [cam.id])

  useEffect(() => {
    connect()
    return () => { clearTimeout(reconnectTimer.current); wsRef.current?.close() }
  }, [connect])

  return (
    <CameraFeedCell
      name={cam.name}
      frame={frame}
      metrics={metrics}
      connected={connected}
      unavailable={unavailable}
      onClick={onClick}
      mini={mini}
    />
  )
})

const s = {
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '20px',
  },
  title: {
    fontSize: '0.8rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: 'var(--text-secondary)',
    marginBottom: 14,
  },
  empty: {
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    textAlign: 'center',
    padding: '24px 0',
  },
  totalsRow: {
    display: 'flex',
    gap: 16,
    marginTop: 14,
    padding: '10px 14px',
    background: 'rgba(0,0,0,0.2)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-color)',
    alignItems: 'center',
  },
  totalsLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 'auto',
  },
  totalStat: (color) => ({
    fontSize: '0.82rem',
    fontWeight: 700,
    color,
  }),
  focusedWrap: {
    position: 'relative',
    width: '100%',
    borderRadius: 'var(--radius-sm)',
    overflow: 'hidden',
  },
  exitBtn: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    background: 'rgba(0,0,0,0.55)',
    border: '1px solid rgba(255,255,255,0.18)',
    color: '#fff',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: '0.72rem',
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.3,
  },
  strip: {
    display: 'flex',
    gap: 8,
    overflowX: 'auto',
    marginTop: 10,
    paddingBottom: 4,
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--border-color) transparent',
  },
  stripItem: {
    width: 152,
    flexShrink: 0,
    borderRadius: 'var(--radius-sm)',
  },
}

function gridColumns(count) {
  if (count <= 1) return '1fr'
  if (count <= 2) return '1fr 1fr'
  return '1fr 1fr 1fr'
}

export default function MultiCameraGrid({ cameras, bare = false, onFocusChange }) {
  const [metricsMap, setMetricsMap] = useState({})
  const [focusedId, setFocusedId] = useState(null)

  const setFocus = useCallback((id) => {
    setFocusedId(id)
    onFocusChange?.(id)
  }, [onFocusChange])

  const active = cameras.filter(c => c.active)

  const handleMetrics = useCallback((cameraId, metrics) => {
    setMetricsMap(prev => ({ ...prev, [cameraId]: metrics }))
  }, [])

  // Clear focus if the focused camera is deactivated
  useEffect(() => {
    if (focusedId && !active.find(c => c.id === focusedId)) {
      setFocus(null)
    }
  }, [active, focusedId, setFocus])

  const totalAvailable = Object.values(metricsMap).reduce((sum, m) => sum + (m.available || 0), 0)
  const totalOccupied  = Object.values(metricsMap).reduce((sum, m) => sum + (m.occupied  || 0), 0)
  const totalSlots     = totalAvailable + totalOccupied

  const totalsRow = (
    <div style={s.totalsRow}>
      <span style={s.totalsLabel}>Unified Totals</span>
      <span style={s.totalStat('var(--text-secondary)')}>{totalSlots} slots</span>
      <span style={s.totalStat('var(--color-vacant)')}>■ {totalAvailable} avail</span>
      <span style={s.totalStat('var(--color-occupied)')}>■ {totalOccupied} occ</span>
    </div>
  )

  const focusedCam = focusedId ? active.find(c => c.id === focusedId) : null
  const others = focusedCam ? active.filter(c => c.id !== focusedId) : []

  let layout

  if (active.length === 0) {
    layout = <div style={s.empty}>No active cameras. Activate one in Camera Registry.</div>
  } else if (focusedCam) {
    layout = (
      <>
        <div style={s.focusedWrap}>
          <button style={s.exitBtn} onClick={() => setFocus(null)}>← All Feeds</button>
          <CameraFeed cam={focusedCam} onMetrics={handleMetrics} />
        </div>

        {others.length > 0 && (
          <div style={s.strip}>
            {others.map(cam => (
              <div key={cam.id} style={s.stripItem} onClick={() => setFocus(cam.id)}>
                <CameraFeed cam={cam} onMetrics={handleMetrics} mini onClick={() => setFocus(cam.id)} />
              </div>
            ))}
          </div>
        )}

        {totalsRow}
      </>
    )
  } else {
    layout = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: gridColumns(active.length), gap: 12 }}>
          {active.map(cam => (
            <CameraFeed key={cam.id} cam={cam} onMetrics={handleMetrics} onClick={() => setFocus(cam.id)} />
          ))}
        </div>
        {totalsRow}
      </>
    )
  }

  const content = (
    <>
      <div style={s.title}>Live Camera Feeds</div>
      {layout}
    </>
  )

  if (bare) return <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>{content}</div>
  return <div style={s.card}>{content}</div>
}
