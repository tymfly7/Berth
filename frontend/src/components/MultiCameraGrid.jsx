import { useState, useCallback, useEffect, useRef } from 'react'
import CameraFeedCell from './CameraFeedCell'

const WS_BASE = `ws://${window.location.hostname}:8000`
const _API_KEY = import.meta.env.VITE_API_KEY ?? ''

// Manages a single camera's WebSocket. Renders nothing — purely keeps the
// connection alive regardless of where CameraFeedCell appears in the tree.
function CameraConnection({ cameraId, onData }) {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const stopReconnect = useRef(false)
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
    const ws = new WebSocket(`${WS_BASE}/ws/cameras/${cameraId}${wsToken}`)
    wsRef.current = ws

    ws.onopen = () => {
      stopReconnect.current = false
      onDataRef.current({ connected: true, unavailable: null })
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'feed_unavailable') {
          stopReconnect.current = true
          clearTimeout(reconnectTimer.current)
          onDataRef.current({ connected: false, unavailable: data.reason ?? 'Feed unavailable' })
          ws.close()
          return
        }
        if (data.error) { ws.close(); return }
        const update = {}
        if (data.frame)   update.frame   = data.frame
        if (data.metrics) update.metrics = data.metrics
        if (Object.keys(update).length) onDataRef.current(update)
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      onDataRef.current({ connected: false })
      if (!stopReconnect.current) {
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => ws.close()
  }, [cameraId])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return null
}

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
  const [feedData, setFeedData] = useState({})

  const active = cameras.filter(c => c.active)

  const handleCameraData = useCallback((cameraId, data) => {
    setFeedData(prev => ({
      ...prev,
      [cameraId]: { ...(prev[cameraId] || {}), ...data },
    }))
    if (data.metrics) {
      setMetricsMap(prev => ({ ...prev, [cameraId]: data.metrics }))
    }
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
          <CameraFeedCell
            name={focusedCam.name}
            {...(feedData[focusedCam.id] || {})}
          />
        </div>

        {others.length > 0 && (
          <div style={s.strip}>
            {others.map(cam => (
              <div key={cam.id} style={s.stripItem} onClick={() => setFocus(cam.id)}>
                <CameraFeedCell
                  name={cam.name}
                  mini
                  onClick={() => setFocus(cam.id)}
                  {...(feedData[cam.id] || {})}
                />
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
            <CameraFeedCell
              key={cam.id}
              name={cam.name}
              onClick={() => setFocus(cam.id)}
              {...(feedData[cam.id] || {})}
            />
          ))}
        </div>
        {totalsRow}
      </>
    )
  }

  const content = (
    <>
      <div style={s.title}>Live Camera Feeds</div>

      {/* Connection keepers — always mounted at this level, never affected by layout changes */}
      {active.map(cam => (
        <CameraConnection
          key={cam.id}
          cameraId={cam.id}
          onData={(data) => handleCameraData(cam.id, data)}
        />
      ))}

      {layout}
    </>
  )

  if (bare) return <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>{content}</div>
  return <div style={s.card}>{content}</div>
}
