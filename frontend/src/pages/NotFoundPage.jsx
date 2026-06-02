import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  const home = sessionStorage.getItem('admin_authed') === 'true' ? '/admin' : '/'

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      padding: '24px',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '6rem',
        fontWeight: 900,
        background: 'var(--gradient-accent)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        lineHeight: 1,
        marginBottom: '24px',
      }}>
        404
      </div>
      <p style={{
        fontSize: '1.25rem',
        fontWeight: 600,
        color: 'var(--text-primary)',
        marginBottom: '8px',
      }}>
        We looked everywhere and we couldn't find that!
      </p>
      <p style={{
        fontSize: '0.9rem',
        color: 'var(--text-secondary)',
        marginBottom: '36px',
      }}>
        The page you're looking for doesn't exist or was moved.
      </p>
      <Link
        to={home}
        className="btn btn-primary"
        style={{ textDecoration: 'none', padding: '10px 28px' }}
      >
        Go Home
      </Link>
    </div>
  )
}
