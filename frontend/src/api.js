const _KEY = import.meta.env.VITE_API_KEY ?? ''

const DEFAULT_TIMEOUT_MS = 15000

export const apiFetch = (url, opts = {}) => {
  const token = sessionStorage.getItem('admin_token')
  const { timeout, signal, ...rest } = opts
  const headers = {
    ...opts.headers,
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(_KEY && { 'X-API-Key': _KEY }),
  }

  // Abort hung requests so a saturated backend yields a fast failure instead of a
  // permanently-pending promise that freezes the UI. Uploads (FormData) and
  // callers that pass their own signal are left untimed; pass timeout:0 to opt out.
  const ms = timeout ?? (opts.body instanceof FormData ? 0 : DEFAULT_TIMEOUT_MS)
  if (signal || ms <= 0) {
    return fetch(url, { ...rest, signal, headers })
  }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...rest, headers, signal: ctrl.signal })
    .finally(() => clearTimeout(t))
}
