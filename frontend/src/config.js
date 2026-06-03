// In dev (Vite on 5173/3000) call the backend directly; in Docker both are same origin.
const _devPort = window.location.port === '5173' || window.location.port === '3000'
const _host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname
export const API_BASE = _devPort ? `http://${_host}:8000` : ''
export const WS_BASE = _devPort
  ? `ws://${_host}:8000`
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
