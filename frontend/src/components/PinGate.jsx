// Frontend-only auth gate — suitable for kiosk use only; not a security boundary.
// Bot protection here (honeypot, math challenge, attempt lockout) only raises the bar
// against naive automated guessing; it is not real security since the check runs client-side.
import { useState, useEffect } from 'react'

const CORRECT_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? 'password'
const CORRECT_USERNAME = 'admin'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 30_000
const FAIL_KEY = 'admin_fail_count'
const LOCK_KEY = 'admin_lock_until'

const newChallenge = () => ({
  a: Math.floor(Math.random() * 9) + 1,
  b: Math.floor(Math.random() * 9) + 1,
})

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

// Off-screen honeypot: invisible to humans, but naive bots fill every field.
const honeypotStyle = {
  position: 'absolute',
  left: '-9999px',
  width: 1,
  height: 1,
  opacity: 0,
  overflow: 'hidden',
}

export default function PinGate({ children }) {
  const [authed, setAuthed] = useState(sessionStorage.getItem('admin_authed') === 'true')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [company, setCompany] = useState('') // honeypot
  const [challenge, setChallenge] = useState(newChallenge)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [lockUntil, setLockUntil] = useState(() => Number(localStorage.getItem(LOCK_KEY) || 0))
  const [now, setNow] = useState(() => Date.now())

  // Tick a countdown while locked; clear the lockout once it expires.
  useEffect(() => {
    if (lockUntil <= Date.now()) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= lockUntil) {
        localStorage.removeItem(FAIL_KEY)
        localStorage.removeItem(LOCK_KEY)
        setLockUntil(0)
        clearInterval(id)
      }
    }, 500)
    return () => clearInterval(id)
  }, [lockUntil])

  if (authed) return children

  const remainingMs = Math.max(0, lockUntil - now)
  const locked = remainingMs > 0
  const remainingSec = Math.ceil(remainingMs / 1000)

  const resetChallenge = () => {
    setChallenge(newChallenge())
    setAnswer('')
  }

  const registerFailure = () => {
    const count = Number(localStorage.getItem(FAIL_KEY) || 0) + 1
    localStorage.setItem(FAIL_KEY, String(count))
    if (count >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS
      localStorage.setItem(LOCK_KEY, String(until))
      setLockUntil(until)
      setNow(Date.now())
    }
    setPassword('')
    resetChallenge()
  }

  const submit = () => {
    if (locked) return

    // Honeypot tripped — treat as a bot, reject without revealing why.
    if (company) {
      setError('Incorrect username or password')
      registerFailure()
      return
    }

    if (Number(answer) !== challenge.a + challenge.b) {
      setError('Incorrect answer to the challenge')
      resetChallenge()
      return
    }

    if (username === CORRECT_USERNAME && password === CORRECT_PASSWORD) {
      localStorage.removeItem(FAIL_KEY)
      localStorage.removeItem(LOCK_KEY)
      sessionStorage.setItem('admin_authed', 'true')
      setAuthed(true)
    } else {
      setError('Incorrect username or password')
      registerFailure()
    }
  }

  const handleKey = e => e.key === 'Enter' && submit()
  const clearError = () => setError('')

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
            onChange={e => { setUsername(e.target.value); clearError() }}
            onKeyDown={handleKey}
            placeholder="admin"
            disabled={locked}
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
            onChange={e => { setPassword(e.target.value); clearError() }}
            onKeyDown={handleKey}
            placeholder="••••••••"
            disabled={locked}
            autoComplete="current-password"
            style={inputStyle}
          />
        </div>

        {/* Honeypot — hidden from real users; bots that auto-fill forms will trip it. */}
        <div style={honeypotStyle} aria-hidden="true">
          <label htmlFor="company">Company</label>
          <input
            id="company"
            type="text"
            value={company}
            onChange={e => setCompany(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        {/* Challenge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            What is {challenge.a} + {challenge.b}?
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={answer}
            onChange={e => { setAnswer(e.target.value); clearError() }}
            onKeyDown={handleKey}
            placeholder="Answer"
            disabled={locked}
            autoComplete="off"
            style={inputStyle}
          />
        </div>

        {locked && (
          <div style={{ color: 'var(--color-occupied)', fontSize: '0.82rem', textAlign: 'center' }}>
            Too many attempts. Try again in {remainingSec}s
          </div>
        )}

        {error && !locked && (
          <div style={{ color: 'var(--color-occupied)', fontSize: '0.82rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} onClick={submit} disabled={locked}>
          {locked ? `Locked (${remainingSec}s)` : 'Sign in'}
        </button>
      </div>
    </div>
  )
}
