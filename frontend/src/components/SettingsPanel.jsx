import { useState } from 'react'
import ControlPanel from './ControlPanel'
import RoiManager from './RoiManager'
import TrainingPanel from './TrainingPanel'
import ModelStatus from './ModelStatus'

const toggleBtnStyle = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-color)',
  padding: '14px 20px',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--text-primary)',
  fontSize: '0.95rem',
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const dividerStyle = {
  height: 1,
  background: 'var(--border-color)',
  margin: '0',
}

function SubSection({ title, children }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '16px 20px' }}>{children}</div>}
    </div>
  )
}

export default function SettingsPanel({ apiAction, apiBase, modelInfo, fetchModelInfo }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="glass-card" style={{ overflow: 'hidden' }}>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>⚙️ Settings</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <SubSection title="Controls">
            <ControlPanel apiAction={apiAction} apiBase={apiBase} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="ROI Manager">
            <RoiManager />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Model Training">
            <TrainingPanel
              apiAction={apiAction}
              apiBase={apiBase}
              modelInfo={modelInfo}
              fetchModelInfo={fetchModelInfo}
            />
            <ModelStatus modelInfo={modelInfo} apiAction={apiAction} />
          </SubSection>
        </>
      )}
    </div>
  )
}
