import { useState } from 'react'
import ControlPanel from './ControlPanel'
import TrainingPanel from './TrainingPanel'
import ModelStatus from './ModelStatus'
import CameraManager from './CameraManager'
import AnomalyPanel from './AnomalyPanel'
import OccupancyPanel from './OccupancyPanel'
import LabelingPanel from './LabelingPanel'


const toggleBtnStyle = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-color)',
  padding: '12px 16px',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--text-primary)',
  fontSize: '0.78rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const dividerStyle = {
  height: 1,
  background: 'var(--border-color)',
  margin: '0',
}

function SubSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '14px 16px' }}>{children}</div>}
    </div>
  )
}

export default function SettingsPanel({ apiAction, apiBase, modelInfo, fetchModelInfo, setActiveModel, onCamerasChange, onRoisSaved }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="glass-card" style={{ overflow: 'hidden' }}>
      <button style={toggleBtnStyle} onClick={() => setOpen(o => !o)}>
        <span>Settings</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          <SubSection title="Camera Registry" defaultOpen={false}>
            <CameraManager compact onCamerasChange={onCamerasChange} onRoisSaved={onRoisSaved} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Controls">
            <ControlPanel apiAction={apiAction} apiBase={apiBase} modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} setActiveModel={setActiveModel} onCamerasChange={onCamerasChange} />
            <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />
            <AnomalyPanel apiBase={apiBase} />
            {modelInfo?.active_model?.startsWith('yolo') && (
              <>
                <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />
                <OccupancyPanel apiBase={apiBase} />
              </>
            )}
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Auto-Labeling" defaultOpen={false}>
            <LabelingPanel apiBase={apiBase} />
          </SubSection>

          <div style={dividerStyle} />

          <SubSection title="Model Training" defaultOpen={false}>
            <TrainingPanel
              apiAction={apiAction}
              apiBase={apiBase}
              modelInfo={modelInfo}
            />
            <ModelStatus modelInfo={modelInfo} fetchModelInfo={fetchModelInfo} apiBase={apiBase} />
          </SubSection>

        </>
      )}
    </div>
  )
}
