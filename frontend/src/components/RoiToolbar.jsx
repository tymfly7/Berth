const btnStyle = (active) => ({
  padding: '5px 11px',
  borderRadius: 4,
  border: '1px solid rgba(255,255,255,0.2)',
  background: active ? 'var(--color-primary, #3498db)' : 'rgba(255,255,255,0.05)',
  color: active ? '#fff' : 'var(--text-muted, #aaa)',
  cursor: 'pointer',
  fontSize: '0.78rem',
})

const proposalBtnStyle = (disabled) => ({
  padding: '5px 11px',
  borderRadius: 4,
  border: '1px solid rgba(100,200,255,0.5)',
  background: 'rgba(100,200,255,0.08)',
  color: disabled ? 'rgba(100,200,255,0.35)' : '#64c8ff',
  cursor: disabled ? 'default' : 'pointer',
  fontSize: '0.78rem',
})

const typeBtnStyle = (active, accent) => ({
  padding: '4px 10px',
  borderRadius: 4,
  border: `1px solid ${active ? accent : 'rgba(255,255,255,0.18)'}`,
  background: active ? `${accent}22` : 'rgba(255,255,255,0.04)',
  color: active ? accent : 'var(--text-muted,#aaa)',
  cursor: 'pointer',
  fontSize: '0.76rem',
  fontWeight: active ? 700 : 400,
})

// The toolbar band above the canvas: layer switch, ROI drawing tools, spot-type
// row, proposals row, and the orientation-frame tools. Presentational — every
// action arrives as a callback prop; all editor state lives in RoiEditor.
export default function RoiToolbar({
  overlay,
  mode, changeMode,
  selectedId, duplicateSelected, scaleSelected,
  divideN, setDivideN, canDivide, divideSelected,
  commitChange, rois, setSelectedId, setInProgress, smoothAll,
  selectedRoi, selectedSpotType, setSpotType, setOwner,
  hasProposals, proposals, smoothProposals,
  selProp, acceptProposal, acceptAllProposals, discardProposal, discardAllProposals,
  orient,
}) {
  const {
    orientEnabled, layer, changeLayer,
    orientTool, setOrientTool, flowStart, setFlowStart,
    commitOrient, onOrientationChange, setPerimDraft,
  } = orient
  return (
    <div style={overlay ? { flexShrink: 0, zIndex: 2 } : {}}>
    {/* ── Layer switch (Slots vs Orientation frame) ── */}
    {orientEnabled && (
      <div style={{ display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, ...(overlay ? { padding: '6px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' } : {}) }}>
        <button style={btnStyle(layer === 'slots')} onClick={() => changeLayer('slots')}
          title="Draw parking slots (these get processed)">Slots</button>
        <button style={btnStyle(layer === 'orientation')} onClick={() => changeLayer('orientation')}
          title="Draw the orientation frame — perimeter, gates, flow, anchor. Display only; never processed.">
          🧭 Orientation frame
        </button>
      </div>
    )}

    {(!orientEnabled || layer === 'slots') && (<>
    {/* ── ROI drawing toolbar ── */}
    <div style={{ display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', ...(overlay ? { padding: '6px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' } : {}) }}>
      <button style={btnStyle(mode === 'polygon')} onClick={() => changeMode('polygon')}>
        Polygon
      </button>
      <button style={btnStyle(mode === 'rect')} onClick={() => changeMode('rect')}>
        Rectangle
      </button>
      <button style={btnStyle(mode === 'edit')} onClick={() => changeMode('edit')}
        title="Select and drag vertices, edges, or whole polygons">
        Edit
      </button>
      <button
        style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
        disabled={!selectedId}
        onClick={duplicateSelected}
        title="Duplicate selected ROI with a small offset"
      >
        Duplicate
      </button>
      <button
        style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
        disabled={!selectedId}
        onClick={() => scaleSelected(1.1)}
        title="Scale selected ROI up 10%"
      >
        Scale +
      </button>
      <button
        style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
        disabled={!selectedId}
        onClick={() => scaleSelected(0.9)}
        title="Scale selected ROI down 10%"
      >
        Scale −
      </button>
      <input
        type="number"
        min={2}
        value={divideN}
        onChange={e => setDivideN(Math.max(2, parseInt(e.target.value, 10) || 2))}
        style={{
          width: 42, padding: '4px 6px', borderRadius: 4, fontSize: '0.78rem',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted,#aaa)', outline: 'none',
        }}
        title="Number of stalls to split the selected box into"
      />
      <button
        style={{ ...btnStyle(false), opacity: canDivide ? 1 : 0.4 }}
        disabled={!canDivide}
        onClick={() => divideSelected(divideN)}
        title={canDivide
          ? 'Split the selected 4-corner box into N even stalls (perspective-aware)'
          : 'Select a 4-corner box (Rectangle, or a 4-point polygon) to divide'}
      >
        Divide
      </button>
      <button
        style={{ ...btnStyle(false), opacity: selectedId ? 1 : 0.4 }}
        disabled={!selectedId}
        onClick={() => {
          commitChange(rois.filter(r => r.id !== selectedId))
          setSelectedId(null)
        }}
      >
        Delete Selected
      </button>
      <button
        style={{ ...btnStyle(false), opacity: rois.length >= 2 ? 1 : 0.4 }}
        disabled={rois.length < 2}
        onClick={smoothAll}
        title="Magic smooth — snap nearby corners of adjacent boxes together so shared edges line up cleanly"
      >
        ✨ Smooth
      </button>
      <button
        style={btnStyle(false)}
        onClick={() => { commitChange([]); setSelectedId(null); setInProgress([]) }}
      >
        Clear All
      </button>
    </div>

    {/* ── Spot type toolbar (visible when a ROI is selected) ── */}
    {selectedRoi && (
      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: overlay ? 0 : 6,
        padding: '5px 8px',
        background: overlay ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.04)',
        borderRadius: overlay ? 0 : 4,
        border: overlay ? 'none' : '1px solid rgba(255,255,255,0.1)',
        backdropFilter: overlay ? 'blur(4px)' : undefined,
        pointerEvents: overlay ? 'auto' : undefined,
      }}>
        <input
          value={selectedRoi.label}
          onChange={e => commitChange(rois.map(r => r.id === selectedRoi.id ? { ...r, label: e.target.value } : r))}
          style={{
            padding: '3px 7px', borderRadius: 4, fontSize: '0.76rem',
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(255,255,255,0.07)', color: '#fff',
            width: 80, outline: 'none',
          }}
          title="Rename this spot (e.g. A1, B3)"
        />
        <span style={{ fontSize: '0.73rem', color: 'var(--text-muted,#aaa)', margin: '0 2px' }}>type:</span>
        <button style={typeBtnStyle(selectedSpotType === 'normal', '#2ecc71')} onClick={() => setSpotType('normal')}>Normal</button>
        <button style={typeBtnStyle(selectedSpotType === 'reserved', '#e6a817')} onClick={() => setSpotType('reserved')}>Reserved</button>
        <button style={typeBtnStyle(selectedSpotType === 'handicap', '#1a7fc1')} onClick={() => setSpotType('handicap')}>♿ Handicap</button>
        {selectedSpotType === 'reserved' && (
          <button
            style={{ ...typeBtnStyle(false, '#e6a817'), borderColor: 'rgba(230,168,23,0.4)', color: '#e6a817' }}
            onClick={setOwner}
            title="Set owner / reservation name shown on the spot"
          >
            {selectedRoi.owner ? `Owner: ${selectedRoi.owner}` : 'Set Owner…'}
          </button>
        )}
      </div>
    )}

    {/* ── Proposals toolbar ── */}
    {hasProposals && (
      <div style={{
        display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', alignItems: 'center',
        padding: '7px 10px', borderRadius: overlay ? 0 : 5,
        border: overlay ? 'none' : '1px solid rgba(100,200,255,0.3)',
        background: overlay ? 'rgba(0,0,0,0.6)' : 'rgba(100,200,255,0.06)',
        backdropFilter: overlay ? 'blur(4px)' : undefined,
        borderBottom: overlay ? '1px solid rgba(100,200,255,0.2)' : undefined,
        pointerEvents: overlay ? 'auto' : undefined,
      }}>
        <span style={{ fontSize: '0.75rem', color: '#64c8ff', marginRight: 2 }}>
          {proposals.length} proposal{proposals.length > 1 ? 's' : ''} — dashed blue
        </span>
        <button
          style={proposalBtnStyle(proposals.length < 2)}
          disabled={proposals.length < 2}
          onClick={smoothProposals}
          title="Tidy auto-detected spots — align each row to clean baselines with a uniform stall size"
        >
          ✨ Tidy rows
        </button>
        <button
          style={proposalBtnStyle(!selProp)}
          disabled={!selProp}
          onClick={() => selProp && acceptProposal(selProp.id)}
          title="Accept selected proposal and add it as a confirmed ROI"
        >
          Accept Selected
        </button>
        <button
          style={proposalBtnStyle(false)}
          onClick={acceptAllProposals}
          title="Accept all proposals and add them as confirmed ROIs"
        >
          Accept All
        </button>
        <button
          style={{ ...proposalBtnStyle(!selProp), borderColor: 'rgba(255,255,255,0.2)', color: selProp ? 'var(--text-muted,#aaa)' : 'rgba(150,150,150,0.4)' }}
          disabled={!selProp}
          onClick={() => selProp && discardProposal(selProp.id)}
          title="Discard selected proposal"
        >
          Discard Selected
        </button>
        <button
          style={{ ...proposalBtnStyle(false), borderColor: 'rgba(255,255,255,0.2)', color: 'var(--text-muted,#aaa)' }}
          onClick={discardAllProposals}
          title="Discard all proposals"
        >
          Discard All
        </button>
      </div>
    )}

    {/* ── Proposals caveat ── */}
    {hasProposals && (
      <div style={{
        fontSize: '0.72rem', color: 'rgba(255,210,80,0.85)',
        marginBottom: 8, paddingLeft: 2,
      }}>
        Proposals cover <strong>occupied spots</strong> (vehicles detected). Empty spots may be
        missing. Click a dashed shape to select it, then accept or discard individually.
      </div>
    )}

    {/* ── Edit mode hint ── */}
    {mode === 'edit' && (
      <div style={{ fontSize: '0.72rem', color: 'rgba(100,200,255,0.8)', marginBottom: 8, paddingLeft: 2 }}>
        Edit mode — click to select, drag a vertex (circle) or edge midpoint (square) to reshape, drag inside to move. Delete key removes selected.
      </div>
    )}
    </>)}

    {/* ── Orientation toolbar ── */}
    {orientEnabled && layer === 'orientation' && (<>
      <div style={{ display: 'flex', gap: 6, marginBottom: overlay ? 0 : 8, flexWrap: 'wrap', alignItems: 'center', ...(overlay ? { padding: '6px 8px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' } : {}) }}>
        <button style={btnStyle(orientTool === 'perimeter')} onClick={() => { setOrientTool('perimeter'); setFlowStart(null) }}
          title="Draw the lot perimeter / drive lane — click points, click the first point or double-click to close">Perimeter</button>
        <button style={btnStyle(orientTool === 'entry')} onClick={() => { setOrientTool('entry'); setFlowStart(null) }}
          title="Click to drop an entry gate">＋ Entry gate</button>
        <button style={btnStyle(orientTool === 'exit')} onClick={() => { setOrientTool('exit'); setFlowStart(null) }}
          title="Click to drop an exit gate">＋ Exit gate</button>
        <button style={btnStyle(orientTool === 'flow')} onClick={() => { setOrientTool('flow'); setFlowStart(null) }}
          title="Click a start then an end point to draw a flow arrow">→ Flow arrow</button>
        <button style={btnStyle(orientTool === 'anchor')} onClick={() => { setOrientTool('anchor'); setFlowStart(null) }}
          title="Click to place the 'you are here' anchor">✷ Anchor</button>
        <button style={btnStyle(orientTool === 'erase')} onClick={() => { setOrientTool('erase'); setFlowStart(null) }}
          title="Click a gate, flow arrow, or anchor to remove it">Erase</button>
        <button style={btnStyle(false)} onClick={() => { commitOrient({ perimeter: null }); setPerimDraft([]) }}
          title="Remove the perimeter">Clear perimeter</button>
        <button style={btnStyle(false)}
          onClick={() => { onOrientationChange?.({ perimeter: null, gates: [], flow: [], anchor: null }); setPerimDraft([]); setFlowStart(null) }}
          title="Clear the entire orientation frame">Clear frame</button>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'rgba(120,200,255,0.85)', marginBottom: 8, paddingLeft: 2 }}>
        Orientation frame — a visual aid only. It is stored separately and <strong>never</strong> sent for detection.
        {orientTool === 'flow' && flowStart && ' Click the arrow end point.'}
      </div>
    </>)}

    </div>
  )
}
