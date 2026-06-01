import { useState } from 'react'
import { apiFetch } from '../api'

const labelStyle = { fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }
const rowStyle = { marginBottom: 14 }

function SliderRow({ label, value, min, max, suffix, onChange }) {
  return (
    <div style={rowStyle}>
      <div style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span>{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value}
        onChange={e => onChange(+e.target.value)} style={{ width: '100%' }} />
    </div>
  )
}

function ToggleRow({ label, value, onChange }) {
  return (
    <div style={{ ...rowStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={labelStyle}>{label}</span>
      <button onClick={() => onChange(v => !v)}
        className={`btn btn-sm ${value ? 'btn-primary' : 'btn-ghost'}`}>
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

function ChipRow({ label, options, value, onChange }) {
  return (
    <div style={rowStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            className={`btn btn-sm ${value === opt ? 'btn-primary' : 'btn-ghost'}`}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function DataAugmentPanel({ apiBase }) {
  const [label, setLabel]     = useState('both')
  const [shadowP, setShadowP] = useState(50)
  const [night, setNight]     = useState(false)
  const [flip, setFlip]       = useState(true)
  const [rotation, setRotation] = useState(15)
  const [jitter, setJitter]   = useState(30)
  const [count, setCount]     = useState(6)
  const [images, setImages]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`${apiBase}/api/augment/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label,
          shadow_p: shadowP / 100,
          night,
          flip,
          rotation,
          jitter: jitter / 100,
          count,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || 'Failed'); return }
      setImages(data.images || [])
    } catch {
      setError('Server unreachable')
    } finally {
      setLoading(false)
    }
  }

  const cols = Math.min(3, count)

  return (
    <div>
      <ChipRow label="Source class" options={['occupied', 'vacant', 'both']}
        value={label} onChange={setLabel} />

      <SliderRow label="Shadow probability" value={shadowP} min={0} max={100}
        suffix="%" onChange={setShadowP} />

      <ToggleRow label="Night / low-light mode" value={night} onChange={setNight} />

      <ToggleRow label="Random horizontal flip" value={flip} onChange={setFlip} />

      <SliderRow label="Rotation" value={rotation} min={0} max={45}
        suffix="°" onChange={setRotation} />

      <SliderRow label="Color jitter" value={jitter} min={0} max={100}
        suffix="%" onChange={setJitter} />

      <ChipRow label="Preview count" options={[4, 6, 8]}
        value={count} onChange={setCount} />

      <button onClick={generate} disabled={loading}
        className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }}>
        {loading ? 'Generating…' : 'Generate Preview'}
      </button>

      {error && (
        <div style={{ color: 'var(--error)', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>
      )}

      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5 }}>
          {images.map((img, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <img
                src={`data:image/jpeg;base64,${img.image}`}
                alt={img.label}
                style={{ width: '100%', borderRadius: 4, display: 'block' }}
              />
              <span style={{
                fontSize: '0.6rem',
                color: img.label === 'occupied' ? 'var(--error)' : 'var(--success)',
              }}>
                {img.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
