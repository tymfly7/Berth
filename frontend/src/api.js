const DEFAULT_TIMEOUT_MS = 15000

// Session tokens are "<expiry_epoch>.<sig>" — read the epoch prefix so the client
// can detect expiry locally instead of firing doomed requests at the backend.
const isTokenExpired = token => {
  const exp = Number(token?.split('.')[0])
  return !exp || exp * 1000 <= Date.now()
}

// Clear the admin session and notify PinGate so it flips back to the login screen
// (which unmounts the app and stops all background polling / WS reconnects).
const expireSession = () => {
  sessionStorage.removeItem('admin_authed')
  sessionStorage.removeItem('admin_token')
  window.dispatchEvent(new Event('auth-expired'))
}

// WebSockets can't send headers, so the admin session token rides as a query
// param instead. Empty when not logged in — public pages open no authed sockets.
export const wsAuthParam = () => {
  const token = sessionStorage.getItem('admin_token')
  return token ? `?token=${encodeURIComponent(token)}` : ''
}

export const apiFetch = (url, opts = {}) => {
  const token = sessionStorage.getItem('admin_token')

  // Expired token: log out up front rather than letting the request be rejected.
  if (token && isTokenExpired(token)) {
    expireSession()
    return Promise.reject(new Error('Session expired'))
  }

  const { timeout, signal, ...rest } = opts
  const headers = {
    ...opts.headers,
    ...(token && { Authorization: `Bearer ${token}` }),
  }

  // Backstop: if the backend rejects the session (e.g. AUTH_SECRET changed), log
  // out so the user is sent to the login screen instead of looping rejections.
  const handleAuth = res => {
    if (res.status === 401 && token) expireSession()
    return res
  }

  // Abort hung requests so a saturated backend yields a fast failure instead of a
  // permanently-pending promise that freezes the UI. Uploads (FormData) and
  // callers that pass their own signal are left untimed; pass timeout:0 to opt out.
  const ms = timeout ?? (opts.body instanceof FormData ? 0 : DEFAULT_TIMEOUT_MS)
  if (signal || ms <= 0) {
    return fetch(url, { ...rest, signal, headers }).then(handleAuth)
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...rest, headers, signal: ctrl.signal })
    .then(handleAuth)
    .finally(() => clearTimeout(t))
}
