import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../api'
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

const _API_KEY = import.meta.env.VITE_API_KEY ?? ''
const WS_URL = `ws://${window.location.hostname}:8000/ws/video${_API_KEY ? `?token=${_API_KEY}` : ''}`
const API_BASE = `http://${window.location.hostname}:8000`

const CANVAS_W = 1000, CANVAS_H = 600

function roiToSlot(roi) {
  const pts = roi.polygon.map(([nx, ny]) => [nx * CANVAS_W, ny * CANVAS_H])
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y
  return { id: roi.id, label: roi.label, status: null, bbox: [x, y, w, h], polygon: pts, spotType: roi.spotType || 'normal', owner: roi.owner || '' }
}

export default function AdminView() {
  const [connected, setConnected] = useState(false)
  const [frame, setFrame] = useState(null)
  const [metrics, setMetrics] = useState({
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
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const camWsRefs = useRef({})
  const unloading = useRef(false)
  const metricsThrottleRef = useRef(0)
  const camMetricsThrottleRef = useRef({})

  const displayMetrics = (() => {
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
  })()

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      console.log('✅ WebSocket connected')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.frame) setFrame(data.frame)
        if (data.metrics) {
          const now = Date.now()
          if (now - metricsThrottleRef.current >= 500) {
            metricsThrottleRef.current = now
            setMetrics(data.metrics)
          }
        }
      } catch (e) {
        console.error('Parse error:', e)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      if (!unloading.current)
        reconnectTimer.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => ws.close()
  }, [])

  const fetchHistory = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/history`)
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
  }

  const fetchModelInfo = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/model/info`)
      if (res.ok) setModelInfo(await res.json())
    } catch { /* silent */ }
  }

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
        fetchRoiSlots(cams)
      }
    } catch { /* silent */ }
  }, [fetchRoiSlots])

  useEffect(() => {
    fetchHistory()
    fetchModelInfo()
    fetchCameras()
    const interval = setInterval(() => {
      fetchHistory()
      fetchModelInfo()
      fetchCameras()
    }, 10000)

    const handleUnload = () => {
      unloading.current = true
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
    window.addEventListener('beforeunload', handleUnload)

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      clearInterval(interval)
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [fetchCameras])

  // Only open the legacy /ws/video connection when at least one camera is active.
  useEffect(() => {
    if (cameras.some(c => c.active)) {
      connectWs()
    } else {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
      setConnected(false)
    }
  }, [cameras, connectWs])

  // Subscribe to all active cameras' WS for live slot statuses.
  useEffect(() => {
    const activeCams = cameras.filter(c => c.active)
    const activeIds = new Set(activeCams.map(c => c.id))

    Object.entries(camWsRefs.current).forEach(([id, ws]) => {
      if (!activeIds.has(id)) { ws.close(); delete camWsRefs.current[id] }
    })

    if (!activeCams.length) { setLiveSlotsMap({}); setAllCameraMetrics({}); return }

    activeCams.forEach((cam, i) => {
      if (camWsRefs.current[cam.id]) return
      const wsToken = _API_KEY ? `?token=${_API_KEY}` : ''
      const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/cameras/${cam.id}${wsToken}`)
      camWsRefs.current[cam.id] = ws
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.metrics) {
            const now = Date.now()
            const last = camMetricsThrottleRef.current[cam.id] || 0
            if (now - last >= 500) {
              camMetricsThrottleRef.current[cam.id] = now
              setAllCameraMetrics(prev => ({ ...prev, [cam.id]: d.metrics }))
              if (Array.isArray(d.metrics.slots))
                setLiveSlotsMap(prev => ({ ...prev, [cam.id]: d.metrics.slots }))
            }
          }
        } catch { /* ignore */ }
      }
      ws.onerror = () => { ws.close(); delete camWsRefs.current[cam.id] }
    })

    const closeAll = () => {
      Object.values(camWsRefs.current).forEach(ws => ws.close())
      camWsRefs.current = {}
      setAllCameraMetrics({})
    }

    window.addEventListener('beforeunload', closeAll)
    return () => {
      window.removeEventListener('beforeunload', closeAll)
      closeAll()
    }
  }, [cameras])

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
            frame={frame}
            connected={connected}
            activeCamera={cameras.find(c => c.active) || null}
            apiBase={API_BASE}
            cameras={cameras}
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
            const liveForCam = liveSlotsMap[cam.cameraId] || []
            const allLive = [...displayMetrics.slots, ...liveForCam]
            const statusById = Object.fromEntries(allLive.map(s => [s.id, s.status]))
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
                  <LotMap slots={slots} demo={allLive.length === 0} title={multi ? cam.name : null} />
                </div>
              </>
            )
          })()}
          <AnalyticsChart history={history} />

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
