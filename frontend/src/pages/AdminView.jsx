import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { apiFetch } from '../api'
import { API_BASE } from '../config'
import '../App.css'
import Header from '../components/Header'
import VideoFeed from '../components/VideoFeed'
import MetricCards from '../components/MetricCards'
import HeatmapView from '../components/HeatmapView'
import AnalyticsChart from '../components/AnalyticsChart'
import ConfidenceGauge from '../components/ConfidenceGauge'
import ServerStatus from '../components/ServerStatus'
import SettingsPanel from '../components/SettingsPanel'
import LotMap from '../components/LotMap'
import { roiToSlot } from '../utils/roiUtils'

export default function AdminView() {
  // Zero-valued fallback used by displayMetrics until camera WS data arrives.
  const [metrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [allCameraMetrics, setAllCameraMetrics] = useState({})
  const [history, setHistory] = useState([])
  const [modelInfo, setModelInfo] = useState(null)
  const [cameras, setCameras] = useState([])
  const [allCameraSlots, setAllCameraSlots] = useState([])
  const [liveSlotsMap, setLiveSlotsMap] = useState({})
  const [lotMapIdx, setLotMapIdx] = useState(0)
  const prevCamIdsRef = useRef('')

  // "Live" once any active camera's WS is delivering metrics.
  const connected = Object.keys(allCameraMetrics).length > 0

  const displayMetrics = useMemo(() => {
    const entries = Object.values(allCameraMetrics)
    if (!entries.length) return metrics
    const total     = entries.reduce((s, m) => s + (m.total     || 0), 0)
    const available = entries.reduce((s, m) => s + (m.available || 0), 0)
    const occupied  = entries.reduce((s, m) => s + (m.occupied  || 0), 0)
    return {
      ...entries[0],
      total,
      available,
      occupied,
      occupancy_percent: total > 0 ? Math.round(occupied / total * 1000) / 10 : 0,
      avg_confidence:    entries.reduce((s, m) => s + (m.avg_confidence || 0), 0) / entries.length,
      fps:               Math.round(entries.reduce((s, m) => s + (m.fps || 0), 0) / entries.length * 10) / 10,
      slots:             entries.flatMap(m => m.slots || []),
    }
  }, [allCameraMetrics, metrics])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/history`)
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
  }, [])

  const fetchModelInfo = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/model/info`)
      if (res.ok) setModelInfo(await res.json())
    } catch { /* silent */ }
  }, [])

  const fetchRoiSlots = useCallback(async (camList) => {
    if (!camList?.length) return
    const results = await Promise.all(
      camList.map(async cam => {
        try {
          const cameraId = cam.roi_camera_id || cam.id
          const res = await apiFetch(`${API_BASE}/api/roi/${cameraId}`)
          if (!res.ok) return null
          const rois = await res.json()
          const slots = Array.isArray(rois)
            ? rois.filter(r => r.polygon?.length >= 3).map(roiToSlot)
            : []
          return slots.length > 0 ? { cameraId: cam.id, name: cam.name, active: cam.active, slots } : null
        } catch { return null }
      })
    )
    setAllCameraSlots(results.filter(Boolean))
  }, [])

  const fetchCameras = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/cameras`)
      if (res.ok) {
        const cams = await res.json()
        setCameras(cams)
        // Only re-fetch ROIs when the camera set actually changed to avoid
        // N × ROI requests on every 10-second poll.
        const newKey = cams.map(c => `${c.id}:${c.roi_camera_id || ''}`).sort().join(',')
        if (newKey !== prevCamIdsRef.current) {
          prevCamIdsRef.current = newKey
          fetchRoiSlots(cams)
        }
      }
    } catch { /* silent */ }
  }, [fetchRoiSlots])

  useEffect(() => {
    fetchHistory()
    fetchModelInfo()
    fetchCameras()
    // Camera state needs to be responsive (10s); history and model info are cheaper
    // to poll less often since the backend now caches model info for 60s.
    const cameraInterval  = setInterval(fetchCameras,   10_000)
    const historyInterval = setInterval(fetchHistory,   30_000)
    const modelInterval   = setInterval(fetchModelInfo, 60_000)

    return () => {
      clearInterval(cameraInterval)
      clearInterval(historyInterval)
      clearInterval(modelInterval)
    }
  }, [fetchCameras, fetchModelInfo, fetchHistory])

  // Stable signature of the active-camera set, used only to prune metrics for
  // cameras that leave the active set (metric hallucination).
  const activeCamKey = cameras.filter(c => c.active).map(c => c.id).sort().join(',')

  useEffect(() => {
    const activeIds = new Set(activeCamKey ? activeCamKey.split(',') : [])
    const pruneStale = prev => {
      const next = Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id)))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    }
    setAllCameraMetrics(pruneStale)
    setLiveSlotsMap(pruneStale)
  }, [activeCamKey])

  // Live per-camera metrics/slots are surfaced from MultiCameraGrid's sockets
  // (one WS per camera) instead of opening a second WS per camera here.
  const handleCamMetrics = useCallback((id, m) => {
    setAllCameraMetrics(prev => ({ ...prev, [id]: m }))
    if (Array.isArray(m.slots)) setLiveSlotsMap(prev => ({ ...prev, [id]: m.slots }))
  }, [])

  const handleCamUnavailable = useCallback((id) => {
    setAllCameraMetrics(({ [id]: _drop, ...rest }) => rest)
    setLiveSlotsMap(({ [id]: _drop, ...rest }) => rest)
  }, [])

  useEffect(() => {
    setLotMapIdx(i => Math.min(i, Math.max(0, allCameraSlots.length - 1)))
  }, [allCameraSlots.length])

  const apiAction = async (endpoint, method = 'POST', body = null) => {
    try {
      const options = { method }
      if (body) {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify(body)
      }
      const res = await apiFetch(`${API_BASE}${endpoint}`, options)
      return await res.json()
    } catch (e) {
      console.error(`API error: ${endpoint}`, e)
      return null
    }
  }

  return (
    <div className="app-container">
      <Header connected={connected} model={modelInfo?.active_model || 'none'} />
      <ServerStatus />

      <div className="dashboard-grid">
        <div className="main-column">
          <VideoFeed
            connected={connected}
            activeCamera={cameras.find(c => c.active) || null}
            apiBase={API_BASE}
            cameras={cameras}
            onCameraMetrics={handleCamMetrics}
            onCameraUnavailable={handleCamUnavailable}
          />
          <div className="metrics-row fade-in">
            <MetricCards
              metrics={displayMetrics}
              streams={cameras.filter(c => c.active).map(c => ({
                id: c.id,
                name: c.name,
                fps: allCameraMetrics[c.id]?.fps ?? 0,
              }))}
            />
          </div>
          {allCameraSlots.length > 0 && (() => {
            const safeIdx = Math.min(lotMapIdx, allCameraSlots.length - 1)
            const cam = allCameraSlots[safeIdx]
            const liveForCam = liveSlotsMap[cam.cameraId] || displayMetrics.slots
            const statusById = Object.fromEntries(liveForCam.map(s => [s.id, s.status]))
            const slots = cam.slots.map(s => ({ ...s, status: statusById[s.id] ?? null }))
            const multi = allCameraSlots.length > 1
            return (
              <>
                {multi && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {allCameraSlots.map((c, i) => (
                        <button key={c.cameraId} onClick={() => setLotMapIdx(i)} title={c.name}
                          style={{ width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                            background: i === safeIdx ? 'var(--accent-primary)' : 'var(--border-color)', transition: 'background 0.2s' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
                      Use ‹ › arrows to switch between lots
                    </span>
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  {multi && <>
                    <button className="btn btn-ghost btn-sm"
                      style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2, fontSize: '1.1rem', padding: '4px 10px' }}
                      onClick={() => setLotMapIdx(i => (i - 1 + allCameraSlots.length) % allCameraSlots.length)}>‹</button>
                    <button className="btn btn-ghost btn-sm"
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2, fontSize: '1.1rem', padding: '4px 10px' }}
                      onClick={() => setLotMapIdx(i => (i + 1) % allCameraSlots.length)}>›</button>
                  </>}
                  <LotMap slots={slots} roiOnly={liveForCam.length === 0} title={multi ? cam.name : null} />
                </div>
              </>
            )
          })()}
          <AnalyticsChart connected={connected} />

          <div className="analytics-row">
            <ConfidenceGauge confidence={displayMetrics.avg_confidence} />
            <HeatmapView cameras={cameras} />
          </div>

        </div>

        <div className="side-column">
          <SettingsPanel apiAction={apiAction} apiBase={API_BASE} modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} onCamerasChange={setCameras} />
        </div>
      </div>
    </div>
  )
}
