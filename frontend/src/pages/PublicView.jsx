import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../api'
import { Link } from 'react-router-dom'
import MetricCards from '../components/MetricCards'
import LotMap from '../components/LotMap'
import AnalyticsChart from '../components/AnalyticsChart'

const API_BASE = `http://${window.location.hostname}:8000`
const _API_KEY = import.meta.env.VITE_API_KEY ?? ''
const CANVAS_W = 1000, CANVAS_H = 600

function roiToSlot(roi) {
  const pts = roi.polygon.map(([nx, ny]) => [nx * CANVAS_W, ny * CANVAS_H])
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y
  return { id: roi.id, label: roi.label, status: null, bbox: [x, y, w, h], polygon: pts, spotType: roi.spotType || 'normal', owner: roi.owner || '' }
}

export default function PublicView() {
  const [metrics, setMetrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [time, setTime] = useState(new Date())
  const [history, setHistory] = useState([])
  const [allCameraSlots, setAllCameraSlots] = useState([])
  const [lotMapIdx, setLotMapIdx] = useState(0)
  const [liveSlotsMap, setLiveSlotsMap] = useState({})
  const [liveCamMetrics, setLiveCamMetrics] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)
  const camWsRefs = useRef({})

  const displayMetrics = (() => {
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
  })()

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
    const pollInterval = setInterval(fetchMetrics, 8000)
    const clockInterval = setInterval(() => setTime(new Date()), 1000)

    return () => {
      clearInterval(pollInterval)
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

    allCameraSlots.forEach(cam => {
      if (camWsRefs.current[cam.cameraId]) return
      const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
      const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/cameras/${cam.cameraId}${wsToken}`)
      camWsRefs.current[cam.cameraId] = ws
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.metrics) {
            setLastUpdate(Date.now())
            setLiveCamMetrics(prev => ({ ...prev, [cam.cameraId]: d.metrics }))
            if (Array.isArray(d.metrics.slots))
              setLiveSlotsMap(prev => ({ ...prev, [cam.cameraId]: d.metrics.slots }))
          }
        } catch { /* ignore */ }
      }
      ws.onerror = () => { ws.close(); delete camWsRefs.current[cam.cameraId] }
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

  const trend = (() => {
    if (history.length < 4) return null
    const vals = history.map(h => h.occupancy_percent ?? 0)
    const recent = vals.slice(-3)
    const prior = vals.slice(-6, -3)
    if (!prior.length) return null
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length
    const delta = avg(recent) - avg(prior)
    if (delta > 2) return { label: 'Filling up', icon: '↑', color: 'var(--color-occupied)' }
    if (delta < -2) return { label: 'Emptying', icon: '↓', color: 'var(--color-vacant)' }
    return { label: 'Steady', icon: '→', color: 'var(--text-muted)' }
  })()

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
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
          marginBottom: 8,
        }}>
          Parking Availability
        </h1>
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
        {trend && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 12, fontSize: '0.9rem', fontWeight: 600, color: trend.color,
          }}>
            <span style={{ fontSize: '1.1rem', lineHeight: 1 }}>{trend.icon}</span>
            {trend.label}
          </div>
        )}
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
                <button onClick={() => setLotMapIdx(i => (i - 1 + allCameraSlots.length) % allCameraSlots.length)}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-sm)', padding: '6px 14px', cursor: 'pointer', fontSize: '1.2rem' }}>‹</button>
                <button onClick={() => setLotMapIdx(i => (i + 1) % allCameraSlots.length)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)',
                    borderRadius: 'var(--radius-sm)', padding: '6px 14px', cursor: 'pointer', fontSize: '1.2rem' }}>›</button>
              </>}
              <LotMap slots={slots} demo={liveForCam.length === 0} title={multi ? cam.name : null} />
            </div>
          </div>
        )
      })()}

      {/* Metric cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16,
        width: '100%',
        maxWidth: 800,
        marginBottom: 32,
      }}>
        <MetricCards metrics={displayMetrics} />
      </div>

      {/* Trends chart */}
      <div style={{ width: '100%', maxWidth: 800, marginBottom: 32 }}>
        <AnalyticsChart history={history} />
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
