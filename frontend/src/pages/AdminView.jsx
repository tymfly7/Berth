import { useState, useEffect, useRef, useCallback } from 'react'
import '../App.css'
import Header from '../components/Header'
import VideoFeed from '../components/VideoFeed'
import MetricCards from '../components/MetricCards'
import HeatmapView from '../components/HeatmapView'
import AnalyticsChart from '../components/AnalyticsChart'
import ConfidenceGauge from '../components/ConfidenceGauge'
import ServerStatus from '../components/ServerStatus'
import CameraManager from '../components/CameraManager'
import MultiCameraGrid from '../components/MultiCameraGrid'
import SettingsPanel from '../components/SettingsPanel'

const WS_URL = `ws://${window.location.hostname}:8000/ws/video`
const API_BASE = `http://${window.location.hostname}:8000`

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
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)

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
  }, [connectWs])

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

  const fetchCameras = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cameras`)
      if (res.ok) setCameras(await res.json())
    } catch { /* silent */ }
  }

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
      <Header connected={connected} model={modelInfo?.active_model || 'demo'} />
      <ServerStatus />

      <div className="metrics-row fade-in">
        <MetricCards metrics={metrics} />
      </div>

      <div className="dashboard-grid">
        <div className="main-column">
          <VideoFeed frame={frame} connected={connected} />
          <CameraManager onCamerasChange={setCameras} />
          <MultiCameraGrid cameras={cameras} />
          <AnalyticsChart history={history} />

          <div className="analytics-row">
            <ConfidenceGauge confidence={metrics.avg_confidence} />
            <HeatmapView heatmap={heatmap} />
          </div>

        </div>

        <div className="side-column">
          <SettingsPanel apiAction={apiAction} apiBase={API_BASE} modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} />
        </div>
      </div>
    </div>
  )
}
