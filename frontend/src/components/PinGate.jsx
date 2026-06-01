// Frontend-only auth gate — suitable for kiosk/demo use only; not a security boundary.
import { useState } from 'react'

const CORRECT_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? 'password'
const CORRECT_USERNAME = 'admin'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '11px 14px',
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
  outline: 'none',
}

export default function PinGate({ children }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem('admin_authed') === 'true')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  if (authed) return children

  const submit = () => {
    if (username === CORRECT_USERNAME && password === CORRECT_PASSWORD) {
      sessionStorage.setItem('admin_authed', 'true')
      setAuthed(true)
    } else {
      setError(true)
      setPassword('')
    }
  }

  const handleKey = e => e.key === 'Enter' && submit()

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: 380,
          padding: '40px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: '2.2rem', marginBottom: 12 }}>🔒</div>
          <div style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            background: 'var(--gradient-accent)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Admin Access
          </div>
        </div>

        {/* Username */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Username
          </label>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(false) }}
            onKeyDown={handleKey}
            placeholder="admin"
            autoFocus
            autoComplete="username"
            style={inputStyle}
          />
        </div>

        {/* Password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false) }}
            onKeyDown={handleKey}
            placeholder="••••••••"
            autoComplete="current-password"
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{ color: 'var(--color-occupied)', fontSize: '0.82rem', textAlign: 'center' }}>
            Incorrect username or password
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={submit}>
          Sign in
        </button>
      </div>
    </div>
  )
}
