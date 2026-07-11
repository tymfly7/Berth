const _devPort = window.location.port === '5173' || window.location.port === '3000'
const _host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname
const _envBase = import.meta.env.VITE_API_BASE   // e.g. http://192.168.0.27:8001
export const API_BASE = _envBase || (_devPort ? `http://${_host}:8001` : '')
export const WS_BASE = _envBase
  ? _envBase.replace(/^http/, 'ws')
  : _devPort
    ? `ws://${_host}:8001`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
