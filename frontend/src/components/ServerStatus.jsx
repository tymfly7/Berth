import { useState, useEffect } from 'react'
import { apiFetch } from '../api'
import { API_BASE } from '../config'

export default function ServerStatus() {
  const [status, setStatus] = useState({ busy: false, operations: [] })

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/status`)
        if (res.ok) setStatus(await res.json())
      } catch { /* silent */ }
    }

    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [])

  const { busy, operations } = status
  const maxProgress = busy && operations.length > 0
    ? Math.max(...operations.map(o => o.progress || 0))
    : 0
  const firstOp = operations[0]
  const extraCount = operations.length - 1
  const determinate = maxProgress > 0

  let label = ''
  if (busy && firstOp) {
    label = firstOp.label
    if (firstOp.progress > 0) {
      label += ` (${Math.round(firstOp.progress * 100)}%)`
    }
    if (extraCount > 0) label += ` +${extraCount} more`
  }

  return (
    <div className={`server-status-bar${busy ? ' server-status-bar--active' : ''}`}>
      <div className="server-status-progress">
        <div
          className={`server-status-fill${!determinate ? ' server-status-fill--pulse' : ''}`}
          style={determinate ? { width: `${maxProgress * 100}%` } : undefined}
        />
      </div>
      {busy && <div className="server-status-label">{label}</div>}
    </div>
  )
}
