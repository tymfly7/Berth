import { useState, useEffect, useRef, useMemo } from 'react'
import { apiFetch } from '../api'
import { API_BASE, WS_BASE } from '../config'
import { Link } from 'react-router-dom'
import MetricCards from '../components/MetricCards'
import LotMap from '../components/LotMap'
import AnalyticsChart from '../components/AnalyticsChart'
import { roiToSlot } from '../utils/roiUtils'

const _API_KEY = import.meta.env.VITE_API_KEY ?? ''

export default function PublicView() {
  const [metrics, setMetrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [time, setTime] = useState(new Date())
  const [, setHistory] = useState([])
  const [allCameraSlots, setAllCameraSlots] = useState([])
  const [lotMapIdx, setLotMapIdx] = useState(0)
  const [liveSlotsMap, setLiveSlotsMap] = useState({})
  const [liveCamMetrics, setLiveCamMetrics] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)
  const camWsRefs = useRef({})

  const displayMetrics = useMemo(() => {
    const entries = Object.values(liveCamMetrics)
    if (!entries.length) return metrics
    const total     = entries.reduce((s, m) => s + (m.total     || 0), 0)
    const available = entries.reduce((s, m) => s + (m.available || 0), 0)
    const occupied  = entries.reduce((s, m) => s + (m.occupied  || 0), 0)
    return {
      ...metrics,
      total,
      available,
      occupied,
      occupancy_percent: total > 0 ? Math.round(occupied / total * 1000) / 10 : 0,
      slots: entries.flatMap(m => m.slots || []),
    }
  }, [liveCamMetrics, metrics])

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/public/metrics`)
        if (res.ok) setMetrics(await res.json())
      } catch { /* silent */ }
    }

    const fetchHistory = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/history`)
        if (res.ok) setHistory(await res.json())
      } catch { /* silent */ }
    }

    fetchMetrics()
    fetchHistory()
    const pollInterval = setInterval(fetchMetrics, 30000)
    const historyInterval = setInterval(fetchHistory, 60000)
    const clockInterval = setInterval(() => setTime(new Date()), 1000)

    return () => {
      clearInterval(pollInterval)
      clearInterval(historyInterval)
      clearInterval(clockInterval)
    }
  }, [])

  useEffect(() => {
    const fetchCameraSlots = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/cameras`)
        if (!res.ok) return
        const cams = await res.json()
        const results = await Promise.all(
          cams.map(async cam => {
            try {
              const cameraId = cam.roi_camera_id || cam.id
              const r = await apiFetch(`${API_BASE}/api/roi/${cameraId}`)
              if (!r.ok) return null
              const rois = await r.json()
              const slots = Array.isArray(rois)
                ? rois.filter(roi => roi.polygon?.length >= 3).map(roiToSlot)
                : []
              return slots.length > 0 ? { cameraId: cam.id, name: cam.name, slots } : null
            } catch { return null }
          })
        )
        setAllCameraSlots(results.filter(Boolean))
      } catch { /* silent */ }
    }
    fetchCameraSlots()
    const interval = setInterval(fetchCameraSlots, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setLotMapIdx(i => Math.min(i, Math.max(0, allCameraSlots.length - 1)))
  }, [allCameraSlots.length])

  useEffect(() => {
    const activeIds = new Set(allCameraSlots.map(c => c.cameraId))

    Object.entries(camWsRefs.current).forEach(([id, ws]) => {
      if (!activeIds.has(id)) { ws.close(); delete camWsRefs.current[id] }
    })

    // Drop stale metrics/slots for cameras that are gone, so the aggregate
    // stops summing ghost lots (metric hallucination).
    const pruneStale = prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    }
    setLiveCamMetrics(pruneStale)
    setLiveSlotsMap(pruneStale)

    allCameraSlots.forEach(cam => {
      if (camWsRefs.current[cam.cameraId]) return

      const connect = () => {
        const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
        const ws = new WebSocket(`${WS_BASE}/ws/cameras/${cam.cameraId}${wsToken}`)
        camWsRefs.current[cam.cameraId] = ws
        ws.onmessage = (e) => {
          // Public view only consumes metrics — skip binary frame messages.
          if (typeof e.data !== 'string') return
          try {
            const d = JSON.parse(e.data)
            if (d.type === 'feed_unavailable') {
              // Feed stopped/deactivated — drop its metrics so it stops
              // counting toward the aggregate.
              setLiveCamMetrics(({ [cam.cameraId]: _drop, ...rest }) => rest)
              setLiveSlotsMap(({ [cam.cameraId]: _drop, ...rest }) => rest)
              return
            }
            if (d.metrics) {
              setLastUpdate(Date.now())
              setLiveCamMetrics(prev => ({ ...prev, [cam.cameraId]: d.metrics }))
              if (Array.isArray(d.metrics.slots))
                setLiveSlotsMap(prev => ({ ...prev, [cam.cameraId]: d.metrics.slots }))
            }
          } catch { /* ignore */ }
        }
        ws.onerror = () => ws.close()
        ws.onclose = () => {
          delete camWsRefs.current[cam.cameraId]
          setTimeout(() => {
            if (activeIds.has(cam.cameraId) && !camWsRefs.current[cam.cameraId]) connect()
          }, 3000)
        }
      }
      connect()
    })

    return () => {
      Object.values(camWsRefs.current).forEach(ws => ws.close())
      camWsRefs.current = {}
    }
  }, [allCameraSlots])

  const availableColor =
    displayMetrics.available === 0
      ? 'var(--color-occupied)'
      : displayMetrics.occupancy_percent > 85
      ? 'var(--color-warning)'
      : 'var(--color-vacant)'

  const isFull = displayMetrics.available === 0

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px clamp(12px, 4vw, 24px)',
      position: 'relative',
    }}>
      {/* Heading + clock */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{
          fontSize: 'clamp(1.6rem, 4vw, 2.4rem)',
          fontWeight: 800,
          background: 'var(--gradient-accent)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: 4,
        }}>
          Berth
        </h1>
        <div style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 500, letterSpacing: '1px', marginBottom: 10 }}>
          Find your space.
        </div>
        <div style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '1rem' }}>
          {time.toLocaleTimeString()}
        </div>
        {(() => {
          const agoSec = lastUpdate ? Math.max(0, Math.round((time.getTime() - lastUpdate) / 1000)) : null
          const live = agoSec != null && agoSec < 15
          const color = live ? 'var(--color-vacant)' : 'var(--text-muted)'
          return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, fontSize: '0.8rem', color }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: live ? `0 0 8px ${color}` : 'none' }} />
              {live ? `Live · updated ${agoSec}s ago` : 'Connecting…'}
            </div>
          )
        })()}
      </div>


      {/* Available spots — large number */}
      <div style={{
        textAlign: 'center',
        margin: '32px 0',
      }}>
        <div style={{
          fontSize: 'clamp(1.1rem, 3vw, 1.6rem)',
          fontWeight: 800,
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          color: isFull ? 'var(--color-occupied)' : 'var(--color-vacant)',
          marginBottom: 8,
        }}>
          {isFull ? 'Lot Full' : 'Spaces Available'}
        </div>
        <div style={{
          fontSize: 'clamp(5rem, 18vw, 10rem)',
          fontWeight: 900,
          lineHeight: 1,
          color: availableColor,
          textShadow: `0 0 60px ${availableColor}55`,
          letterSpacing: '-4px',
        }}>
          {displayMetrics.available}
        </div>
        <div style={{
          fontSize: '1rem',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          letterSpacing: '2px',
          textTransform: 'uppercase',
          marginTop: 8,
        }}>
          spots available
        </div>
      </div>

      {/* Per-lot breakdown */}
      {allCameraSlots.length > 1 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
          gap: '8px 18px', marginBottom: 24, width: '100%', maxWidth: 800,
        }}>
          {allCameraSlots.map(cam => {
            const free = liveCamMetrics[cam.cameraId]?.available
            return (
              <span key={cam.cameraId} style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                <span style={{ fontWeight: 600 }}>{cam.name}:</span>{' '}
                {free == null
                  ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                  : free > 0
                    ? <span style={{ color: 'var(--color-vacant)', fontWeight: 700 }}>{free} free</span>
                    : <span style={{ color: 'var(--color-occupied)', fontWeight: 700 }}>Full</span>}
              </span>
            )
          })}
        </div>
      )}

      {/* Metric cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 16,
        width: '100%',
        maxWidth: 800,
        marginBottom: 32,
      }}>
        <MetricCards metrics={displayMetrics} showMisparked={false} />
      </div>

      {/* Lot map */}
      {allCameraSlots.length > 0 && (() => {
        const safeIdx = Math.min(lotMapIdx, allCameraSlots.length - 1)
        const cam = allCameraSlots[safeIdx]
        const liveForCam = liveSlotsMap[cam.cameraId] || displayMetrics.slots
        const statusById = Object.fromEntries(liveForCam.map(s => [s.id, s.status]))
        const slots = cam.slots.map(s => ({ ...s, status: statusById[s.id] ?? null }))
        const multi = allCameraSlots.length > 1
        return (
          <div style={{ width: '100%', maxWidth: 800, marginBottom: 24 }}>
            {multi && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {allCameraSlots.map((c, i) => (
                    <button key={c.cameraId} onClick={() => setLotMapIdx(i)} title={c.name}
                      style={{ width: 10, height: 10, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                        background: i === safeIdx ? 'var(--accent-primary)' : 'rgba(255,255,255,0.2)', transition: 'background 0.2s' }} />
                  ))}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                  Use ‹ › arrows to switch between lots
                </span>
              </div>
            )}
            <div style={{ position: 'relative' }}>
              {multi && <>
                <button className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', zIndex: 2, fontSize: '1.2rem', padding: '6px 14px' }}
                  onClick={() => setLotMapIdx(i => (i - 1 + allCameraSlots.length) % allCameraSlots.length)}>‹</button>
                <button className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', zIndex: 2, fontSize: '1.2rem', padding: '6px 14px' }}
                  onClick={() => setLotMapIdx(i => (i + 1) % allCameraSlots.length)}>›</button>
              </>}
              <LotMap slots={slots} roiOnly={liveForCam.length === 0} title={multi ? cam.name : null} />
            </div>
          </div>
        )
      })()}

      {/* Trends chart */}
      <div style={{ width: '100%', maxWidth: 800, marginBottom: 32 }}>
        <AnalyticsChart cameras={allCameraSlots.map(c => ({ id: c.cameraId, name: c.name }))} />
      </div>

      {/* Admin link — bottom-right corner */}
      <Link
        to="/admin"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 24,
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textDecoration: 'none',
          padding: '4px 10px',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        Admin
      </Link>
    </div>
  )
}
