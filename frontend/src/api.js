const _KEY = import.meta.env.VITE_API_KEY ?? ''

export const apiFetch = (url, opts = {}) =>
  fetch(url, { ...opts, headers: { ...opts.headers, ...(_KEY && { 'X-API-Key': _KEY }) } })
