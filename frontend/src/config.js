// Use 127.0.0.1 instead of `localhost` to avoid the Windows IPv6 (::1) connect
// stall that adds ~1–2 s per request; keep the real hostname for remote access.
const _host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname
export const API_BASE = `http://${_host}:8000`
