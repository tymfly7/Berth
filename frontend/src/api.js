const _KEY = import.meta.env.VITE_API_KEY ?? ''

export const apiFetch = (url, opts = {}) => {
  const token = sessionStorage.getItem('admin_token')
  return fetch(url, {
    ...opts,
    headers: {
      ...opts.headers,
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(_KEY && { 'X-API-Key': _KEY }),
    },
  })
}
