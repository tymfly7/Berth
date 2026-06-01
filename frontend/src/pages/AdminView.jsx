import { useState, useEffect, useRef, useCallback } from 'react'
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

const WS_URL = `ws://${window.location.hostname}:8000/ws/video`
const API_BASE = `http://${window.location.hostname}:8000`

const CANVAS_W = 1000, CANVAS_H = 600

function roiToSlot(roi) {
  const pts = roi.polygon.map(([nx, ny]) => [nx * CANVAS_W, ny * CANVAS_H])
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  const w = Math.max(...xs) - x, h = Math.max(...ys) - y
  return { id: roi.id, label: roi.label, status: null, bbox: [x, y, w, h], polygon: pts }
}

export default function AdminView() {
  const [connected, setConnected] = useState(false)
  const [frame, setFrame] = useState(null)
  const [metrics, setMetrics] = useState({
    total: 0, available: 0, occupied: 0,
    occupancy_percent: 0, avg_confidence: 0, slots: [],
  })
  const [history, setHistory] = useState([])
  const [heatmap, setHeatmap] = useState([])
  const [modelInfo, setModelInfo] = useState(null)
  const [cameras, setCameras] = useState([])
  const [roiSlots, setRoiSlots] = useState([])
  const [liveSlots, setLiveSlots] = useState([])  // slot statuses from active camera WS
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const camWsRef = useRef(null)

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
        if (data.metrics) setMetrics(data.metrics)
      } catch (e) {
        console.error('Parse error:', e)
      }
    }

    ws.onclose = () => {
      setConnected(false)
      console.log('❌ WebSocket disconnected, reconnecting...')
      reconnectTimer.current = setTimeout(connectWs, 3000)
    }

    ws.onerror = () => ws.close()
  }, [])

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/history`)
      if (res.ok) setHistory(await res.json())
    } catch { /* silent */ }
  }

  const fetchHeatmap = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/heatmap`)
      if (res.ok) setHeatmap(await res.json())
    } catch { /* silent */ }
  }

  const fetchModelInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/model/info`)
      if (res.ok) setModelInfo(await res.json())
    } catch { /* silent */ }
  }

  const fetchRoiSlots = useCallback(async (camList) => {
    try {
      const active = camList?.find(c => c.active)
      const cameraId = active?.roi_camera_id || active?.id || 'default'
      const res = await fetch(`${API_BASE}/api/roi/${cameraId}`)
      if (!res.ok) return
      const rois = await res.json()
      setRoiSlots(Array.isArray(rois) ? rois.filter(r => r.polygon?.length >= 3).map(roiToSlot) : [])
    } catch { /* silent */ }
  }, [])

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cameras`)
      if (res.ok) {
        const cams = await res.json()
        setCameras(cams)
        fetchRoiSlots(cams)
      }
    } catch { /* silent */ }
  }, [fetchRoiSlots])

  useEffect(() => {
    connectWs()
    fetchHistory()
    fetchHeatmap()
    fetchModelInfo()
    fetchCameras()
    const interval = setInterval(() => {
      fetchHistory()
      fetchHeatmap()
      fetchModelInfo()
      fetchCameras()
    }, 10000)

    return () => {
      clearInterval(interval)
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connectWs, fetchCameras])

  // Subscribe to the active camera's WS to get per-slot statuses for LotMap coloring.
  useEffect(() => {
    const active = cameras.find(c => c.active)
    camWsRef.current?.close()
    if (!active) { setLiveSlots([]); return }
    const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/cameras/${active.id}`)
    camWsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data)
        if (Array.isArray(d.metrics?.slots)) setLiveSlots(d.metrics.slots)
      } catch { /* ignore */ }
    }
    ws.onerror = () => ws.close()
    return () => ws.close()
  }, [cameras])

  const apiAction = async (endpoint, method = 'POST', body = null) => {
    try {
      const options = { method }
      if (body) {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify(body)
      }
      const res = await fetch(`${API_BASE}${endpoint}`, options)
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
            <MetricCards metrics={metrics} />
          </div>
          <LotMap
            slots={(() => {
              if (metrics.slots.length > 0) return metrics.slots
              if (liveSlots.length > 0 && roiSlots.length > 0) {
                const statusById = Object.fromEntries(liveSlots.map(s => [s.id, s.status]))
                return roiSlots.map(s => ({ ...s, status: statusById[s.id] ?? s.status }))
              }
              return []
            })()}
            demo={metrics.slots.length === 0}
          />
          <AnalyticsChart history={history} />

          <div className="analytics-row">
            <ConfidenceGauge confidence={metrics.avg_confidence} />
            <HeatmapView
                heatmap={heatmap}
                cameraId={cameras.find(c => c.active)?.roi_camera_id || cameras.find(c => c.active)?.id || null}
              />
          </div>

        </div>

        <div className="side-column">
          <SettingsPanel apiAction={apiAction} apiBase={API_BASE} modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} onCamerasChange={setCameras} />
        </div>
      </div>
    </div>
  )
}
