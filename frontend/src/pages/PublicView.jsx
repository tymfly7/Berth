import { useState, useEffect, useMemo } from 'react'
import { apiFetch } from '../api'
import { API_BASE } from '../config'
import { Link } from 'react-router-dom'
import MetricCards from '../components/MetricCards'
import LotMap from '../components/LotMap'
import AnalyticsChart from '../components/AnalyticsChart'
import { roiToSlot } from '../utils/roiUtils'

export default function PublicView() {
  const [metrics, setMetrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [time, setTime] = useState(new Date())
  const [allCameraSlots, setAllCameraSlots] = useState([])
  const [lotMapIdx, setLotMapIdx] = useState(0)
  const [liveSlotsMap, setLiveSlotsMap] = useState({})
  const [liveCamMetrics, setLiveCamMetrics] = useState({})
  const [lastUpdate, setLastUpdate] = useState(null)

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

    fetchMetrics()
    const pollInterval = setInterval(fetchMetrics, 30000)
    const clockInterval = setInterval(() => setTime(new Date()), 1000)

    return () => {
      clearInterval(pollInterval)
      clearInterval(clockInterval)
    }
  }, [])

  useEffect(() => {
    // Single unauthenticated poll: slot geometry + live occupancy for every
    // active lot, replacing the old /api/cameras + /api/roi calls and the
    // per-camera WebSocket (the public page needs no live frames).
    const fetchLots = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/public/lots`)
        if (!res.ok) return
        const lots = await res.json()
        const cams = []
        const metricsById = {}
        const slotsById = {}
        lots.forEach(l => {
          const slots = Array.isArray(l.rois)
            ? l.rois.filter(roi => roi.polygon?.length >= 3).map(roiToSlot)
            : []
          if (slots.length === 0) return
          cams.push({ cameraId: l.cameraId, name: l.name, slots })
          if (l.metrics) {
            metricsById[l.cameraId] = l.metrics
            if (Array.isArray(l.metrics.slots)) slotsById[l.cameraId] = l.metrics.slots
          }
        })
        setAllCameraSlots(cams)
        setLiveCamMetrics(metricsById)
        setLiveSlotsMap(slotsById)
        if (Object.keys(metricsById).length) setLastUpdate(Date.now())
      } catch { /* silent */ }
    }
    fetchLots()
    const interval = setInterval(fetchLots, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setLotMapIdx(i => Math.min(i, Math.max(0, allCameraSlots.length - 1)))
  }, [allCameraSlots.length])

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
        <AnalyticsChart cameras={allCameraSlots.map(c => ({ id: c.cameraId, name: c.name }))} trendsUrl="/api/public/trends" />
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
