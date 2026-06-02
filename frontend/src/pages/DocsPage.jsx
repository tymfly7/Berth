import Header from '../components/Header'
import '../App.css'

const s = {
  page: {
    minHeight: '100vh',
    padding: '0 24px 60px',
    maxWidth: '860px',
    margin: '0 auto',
  },
  hero: {
    padding: '48px 0 32px',
    borderBottom: '1px solid var(--border-color)',
    marginBottom: '40px',
  },
  heroTag: {
    display: 'inline-block',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--accent-secondary)',
    marginBottom: '12px',
  },
  heroTitle: {
    fontSize: '2rem',
    fontWeight: 800,
    background: 'var(--gradient-accent)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    lineHeight: 1.2,
    marginBottom: '12px',
  },
  heroSub: {
    fontSize: '1rem',
    color: 'var(--text-secondary)',
    maxWidth: '560px',
    lineHeight: 1.7,
  },
  toc: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    padding: '20px 24px',
    marginBottom: '40px',
  },
  tocTitle: {
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: '12px',
  },
  tocList: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  tocItem: {
    fontSize: '0.875rem',
    color: 'var(--accent-primary)',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px 32px',
    marginBottom: '24px',
  },
  sectionNum: {
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: '6px',
  },
  sectionTitle: {
    fontSize: '1.2rem',
    fontWeight: 700,
    background: 'var(--gradient-accent)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    marginBottom: '16px',
  },
  body: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.75,
    marginBottom: '16px',
  },
  steps: {
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '16px',
  },
  step: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.65,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: '0.82rem',
    background: 'rgba(99, 102, 241, 0.08)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 7px',
    color: 'var(--accent-secondary)',
  },
  callout: {
    background: 'rgba(99, 102, 241, 0.07)',
    border: '1px solid rgba(99, 102, 241, 0.18)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 16px',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginTop: '12px',
    lineHeight: 1.65,
  },
  calloutWarn: {
    background: 'rgba(245, 158, 11, 0.07)',
    border: '1px solid rgba(245, 158, 11, 0.22)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 16px',
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginTop: '12px',
    lineHeight: 1.65,
  },
  label: {
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  divider: {
    border: 'none',
    borderTop: '1px solid var(--border-color)',
    margin: '16px 0',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '12px',
  },
  chip: {
    fontSize: '0.78rem',
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'rgba(6, 182, 212, 0.1)',
    border: '1px solid rgba(6, 182, 212, 0.25)',
    color: 'var(--accent-secondary)',
  },
}

const SECTIONS = [
  'System Overview',
  'Accessing the Admin Dashboard',
  'Connecting a Camera',
  'Drawing Regions of Interest (ROI)',
  'Choosing an AI Model',
  'Reading the Live Dashboard',
  'Enabling Anomaly Detection',
  'Training a Custom Model',
]

function Code({ children }) {
  return <code style={s.code}>{children}</code>
}

function SectionCard({ num, id, title, children }) {
  return (
    <section id={id} style={s.card}>
      <div style={s.sectionNum}>Section {num}</div>
      <h2 style={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

export default function DocsPage() {
  return (
    <div style={s.page}>
      <Header connected={false} model={null} />

      {/* Hero */}
      <div style={s.hero}>
        <div style={s.heroTag}>Getting Started</div>
        <h1 style={s.heroTitle}>Berth Operator Guide</h1>
        <p style={s.heroSub}>
          Everything you need to set up cameras, configure detection zones,
          select an AI model, and interpret live parking data.
        </p>
      </div>

      {/* Table of Contents */}
      <div style={s.toc}>
        <div style={s.tocTitle}>On this page</div>
        <ol style={s.tocList}>
          {SECTIONS.map((title, i) => (
            <li key={i}>
              <a href={`#s${i + 1}`} style={s.tocItem}>
                {i + 1}. {title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Section 1: Overview ─────────────────────────────── */}
      <SectionCard num={1} id="s1" title="System Overview">
        <p style={s.body}>
          Berth is a real-time AI parking occupancy system. It ingests live
          video from one or more IP cameras, runs inference on each configured
          parking slot, and publishes occupancy metrics to both the public
          display and the admin dashboard.
        </p>
        <p style={s.body}>
          The system has two views:
        </p>
        <ul style={{ ...s.steps, listStyleType: 'disc' }}>
          <li style={s.step}>
            <span style={s.label}>Public View</span> (<Code>/</Code>) — A
            read-only display showing total available spots, a lot map, and
            live occupancy trends. No login required.
          </li>
          <li style={s.step}>
            <span style={s.label}>Admin Dashboard</span> (<Code>/admin</Code>)
            — Full control over cameras, ROIs, model selection, training, and
            analytics. PIN-protected.
          </li>
        </ul>
        <div style={s.callout}>
          <span style={s.label}>Architecture at a glance:</span> Browser
          connects via WebSocket to the Python backend (port 8000). The backend
          runs inference on camera frames and pushes metrics back in real time.
          No page refresh is needed.
        </div>
      </SectionCard>

      {/* ── Section 2: Admin Access ──────────────────────────── */}
      <SectionCard num={2} id="s2" title="Accessing the Admin Dashboard">
        <p style={s.body}>
          The admin area is protected by a username and password login. To sign in:
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            Open a browser and navigate to <Code>/admin</Code>.
          </li>
          <li style={s.step}>
            Enter the credentials when prompted. The defaults are username{' '}
            <Code>admin</Code> and password <Code>password</Code>.
          </li>
          <li style={s.step}>
            The dashboard loads automatically once credentials are accepted.
            Authentication is stored in <Code>sessionStorage</Code> — it
            persists for the current browser tab and clears when the tab is
            closed or you click <strong>Logout</strong>.
          </li>
        </ol>
        <div style={s.calloutWarn}>
          <span style={s.label}>Security note:</span> Change the default
          password before deploying in a production environment. Set the{' '}
          <Code>VITE_ADMIN_PASSWORD</Code> environment variable in your{' '}
          <Code>.env</Code> file to override the default.
        </div>
      </SectionCard>

      {/* ── Section 3: Adding a Camera ───────────────────────── */}
      <SectionCard num={3} id="s3" title="Connecting a Camera">
        <p style={s.body}>
          The system supports multiple simultaneous camera sources. Each camera
          runs its own video processor with its own ROI configuration. Three
          source types are supported:
        </p>
        <div style={s.chipRow}>
          {['USB', 'RTSP', 'YouTube'].map(t => (
            <span key={t} style={s.chip}>{t}</span>
          ))}
        </div>

        <hr style={s.divider} />

        <p style={{ ...s.body, marginBottom: 8 }}>
          <span style={s.label}>USB — camera wired into the backend machine</span>
        </p>
        <p style={s.body}>
          OpenCV reads the device server-side, so the camera must be plugged
          into the host running the backend — not the laptop where you open the
          browser.
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            The source is the integer <span style={s.label}>device index</span>:
            {' '}<Code>0</Code> for the first/built-in camera, <Code>1</Code>,{' '}
            <Code>2</Code>, … for additional ones.
          </li>
          <li style={s.step}>
            Settings → Camera Registry → Type <Code>USB</Code> → Source{' '}
            <Code>0</Code> → <span style={s.label}>Add Camera</span> →{' '}
            <span style={s.label}>Activate</span>.
          </li>
          <li style={s.step}>
            If the index is wrong the camera shows offline — try the next
            index. Only one app can hold a given camera at a time.
          </li>
        </ol>

        <hr style={s.divider} />

        <p style={{ ...s.body, marginBottom: 8 }}>
          <span style={s.label}>RTSP — CCTV / IP camera on the network</span>
        </p>
        <p style={s.body}>
          Most CCTV and IP cameras expose an RTSP URL in the format:
        </p>
        <div style={{
          fontFamily: 'monospace',
          fontSize: '0.82rem',
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          color: 'var(--accent-secondary)',
          marginBottom: 14,
          wordBreak: 'break-all',
        }}>
          rtsp://user:pass@&lt;camera-ip&gt;:554/&lt;stream-path&gt;
        </div>
        <ol style={s.steps}>
          <li style={s.step}>
            The <Code>&lt;stream-path&gt;</Code> is vendor-specific — e.g.
            Hikvision <Code>/Streaming/Channels/101</Code>, Dahua{' '}
            <Code>/cam/realmonitor?channel=1&subtype=0</Code>. Check your
            camera's manual or its ONVIF / app settings.
          </li>
          <li style={s.step}>
            Test the URL in <span style={s.label}>VLC</span> first (Media →
            Open Network Stream). If VLC plays it, the backend will too — both
            use FFmpeg under the hood.
          </li>
          <li style={s.step}>
            Settings → Camera Registry → Type <Code>RTSP</Code> → paste the{' '}
            <Code>rtsp://…</Code> URL → <span style={s.label}>Add Camera</span>{' '}
            → <span style={s.label}>Activate</span>.
          </li>
        </ol>
        <div style={s.callout}>
          <span style={s.label}>Tip:</span> Prefer the camera's lower-resolution
          sub-stream (e.g. Hikvision <Code>Channels/102</Code>, Dahua{' '}
          <Code>subtype=1</Code>). Parking detection doesn't need full
          resolution and the sub-stream is far lighter on CPU and bandwidth.
        </div>

        <hr style={s.divider} />

        <p style={{ ...s.body, marginBottom: 8 }}>
          <span style={s.label}>YouTube Live — public live feed</span>
        </p>
        <p style={s.body}>
          Paste a YouTube live URL as the source. The backend resolves it to an
          HLS stream automatically (cached for <Code>BERTH_YT_CACHE_TTL</Code>{' '}
          seconds). No additional setup required.
        </p>

        <hr style={s.divider} />

        <p style={{ ...s.body, marginBottom: 8 }}>
          <span style={s.label}>Keeping RTSP credentials secure</span>
        </p>
        <p style={s.body}>
          Instead of saving a password in the stored source URL, set it as an
          environment variable on the backend host. The registry will use it
          at runtime and the on-disk config stays credential-free.
        </p>
        <div style={{
          fontFamily: 'monospace',
          fontSize: '0.82rem',
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 'var(--radius-sm)',
          padding: '10px 14px',
          color: 'var(--accent-secondary)',
          marginBottom: 0,
        }}>
          {'# camera id "lot-a-1f3c2d" →'}<br />
          {'BERTH_CAM_SOURCE_LOT_A_1F3C2D=rtsp://user:pass@192.168.1.10:554/Streaming/Channels/102'}
        </div>
      </SectionCard>

      {/* ── Section 4: ROI ───────────────────────────────────── */}
      <SectionCard num={4} id="s4" title="Drawing Regions of Interest (ROI)">
        <p style={s.body}>
          A Region of Interest (ROI) is a polygon drawn over a parking slot in
          the camera frame. Each ROI maps to exactly one slot — the model
          classifies that region as <em>vacant</em> or <em>occupied</em> on
          every inference cycle.
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            Select the target camera in the video feed panel.
          </li>
          <li style={s.step}>
            Click <span style={s.label}>Edit ROI</span> to enter the ROI
            editor. The live frame freezes so you can draw accurately.
          </li>
          <li style={s.step}>
            Click on the frame to place polygon vertices around a parking slot.
            Aim for 4–6 points that tightly bound the slot.
          </li>
          <li style={s.step}>
            Click the first vertex again (or the <span style={s.label}>Close
            Shape</span> button) to complete the polygon.
          </li>
          <li style={s.step}>
            Repeat for each additional slot visible in this camera's frame.
          </li>
          <li style={s.step}>
            Click <span style={s.label}>Save ROI</span>. The polygons are
            stored in the backend and persist across restarts.
          </li>
        </ol>
        <div style={s.calloutWarn}>
          <span style={s.label}>Important:</span> ROIs that overlap cause
          double-counting. Draw each polygon to cover only the floor area of
          one slot. Avoid including lane markings or adjacent slots.
        </div>
      </SectionCard>

      {/* ── Section 5: Model Selection ───────────────────────── */}
      <SectionCard num={5} id="s5" title="Choosing an AI Model">
        <p style={s.body}>
          Five inference models are available. Select the one that best matches
          your hardware and accuracy requirements.
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            Open <span style={s.label}>Settings → Controls</span>.
          </li>
          <li style={s.step}>
            Choose a model from the dropdown. The change takes effect
            immediately — no restart required.
          </li>
        </ol>
        <div style={s.chipRow}>
          {['CNN Scratch', 'ResNet-50', 'MobileNetV4', 'YOLO26 Classify', 'YOLO26 Detect'].map(m => (
            <span key={m} style={s.chip}>{m}</span>
          ))}
        </div>
        <hr style={s.divider} />
        <ul style={{ ...s.steps, listStyleType: 'disc' }}>
          <li style={s.step}>
            <span style={s.label}>CNN Scratch</span> — Lightweight baseline.
            Fast, low accuracy. Good for testing on CPU-only hardware.
          </li>
          <li style={s.step}>
            <span style={s.label}>ResNet-50</span> — Strong accuracy on
            well-lit lots. Higher memory footprint.
          </li>
          <li style={s.step}>
            <span style={s.label}>MobileNetV4</span> — Best
            accuracy-to-speed ratio for edge devices (Raspberry Pi, Jetson).
          </li>
          <li style={s.step}>
            <span style={s.label}>YOLO26 Classify</span> — Classification
            variant. Extremely fast inference; NMS-free.
          </li>
          <li style={s.step}>
            <span style={s.label}>YOLO26 Detect</span> — Detection variant.
            Most accurate for complex or busy scenes. Requires GPU for
            real-time performance.
          </li>
        </ul>
        <div style={s.callout}>
          <span style={s.label}>Inference mode:</span> Switch between
          <Code>classify</Code> (per-ROI crop) and <Code>detect</Code>
          (full-frame object detection) in the same Controls panel. Classify
          mode is faster when ROIs are already configured.
        </div>
      </SectionCard>

      {/* ── Section 6: Dashboard ─────────────────────────────── */}
      <SectionCard num={6} id="s6" title="Reading the Live Dashboard">
        <p style={s.body}>
          The main panel updates in real time over WebSocket. Here is what each
          widget shows:
        </p>
        <ul style={{ ...s.steps, listStyleType: 'disc' }}>
          <li style={s.step}>
            <span style={s.label}>Metric Cards</span> — Five headline numbers:
            Total Spots, Available, Occupied, Occupancy %, and Active Streams.
            Aggregated across all active cameras.
          </li>
          <li style={s.step}>
            <span style={s.label}>Lot Map</span> — A slot-by-slot grid.
            Green = vacant, red = occupied. Click a slot to see its camera
            source and ROI ID. Use the carousel arrows to switch between
            multiple registered lots.
          </li>
          <li style={s.step}>
            <span style={s.label}>Analytics Chart</span> — Occupancy trend
            over Live / Day / Week / Month. Switch periods using the tabs above
            the chart.
          </li>
          <li style={s.step}>
            <span style={s.label}>Confidence Gauge</span> — Average model
            confidence across all slots in the last inference cycle. Values
            below 60 % suggest the model needs retraining or the lighting
            conditions have changed.
          </li>
          <li style={s.step}>
            <span style={s.label}>Heatmap</span> — Per-camera parking duration
            heatmap. Darker cells indicate slots that have been occupied
            continuously for longer periods.
          </li>
        </ul>
        <div style={s.callout}>
          <span style={s.label}>Connection indicator:</span> The pulsing dot in
          the header shows WebSocket state — green (Live) means metrics are
          streaming; red (Offline) means the backend is unreachable. The
          dashboard will attempt to reconnect automatically.
        </div>
      </SectionCard>

      {/* ── Section 7: Anomaly Detection ─────────────────────── */}
      <SectionCard num={7} id="s7" title="Enabling Anomaly Detection">
        <p style={s.body}>
          Anomaly detection flags vehicles parked outside valid ROI zones —
          such as blocking fire lanes, disabled bays, or yellow-hatched
          no-park areas.
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            Open <span style={s.label}>Settings → Controls</span>.
          </li>
          <li style={s.step}>
            Toggle <span style={s.label}>Anomaly Detection</span> on.
          </li>
          <li style={s.step}>
            A <span style={s.label}>Misparked</span> count card appears in the
            Metric Cards row. It shows how many vehicles are detected outside
            designated ROIs.
          </li>
          <li style={s.step}>
            The <span style={s.label}>Anomaly Panel</span> in the settings area
            provides a per-camera breakdown.
          </li>
        </ol>
        <div style={s.calloutWarn}>
          <span style={s.label}>Prerequisite:</span> Anomaly detection requires
          at least one ROI to be defined per camera. It uses the area
          <em> outside</em> all ROI polygons as the anomaly zone.
        </div>
      </SectionCard>

      {/* ── Section 8: Training ──────────────────────────────── */}
      <SectionCard num={8} id="s8" title="Training a Custom Model">
        <p style={s.body}>
          If the default pre-trained weights produce low confidence on your
          lot, you can train a new model on images captured from your own
          cameras.
        </p>
        <ol style={s.steps}>
          <li style={s.step}>
            Open <span style={s.label}>Settings → Model Training</span>.
          </li>
          <li style={s.step}>
            Use the <span style={s.label}>Data Augmentation</span> tools to
            prepare your training images. Augmentation applies crops,
            brightness shifts, and flips to expand the dataset.
          </li>
          <li style={s.step}>
            Review the augmented sample previews. Adjust intensity if the
            transformations look too aggressive for your lighting conditions.
          </li>
          <li style={s.step}>
            Click <span style={s.label}>Start Training</span>. A progress bar
            and epoch counter track the job.
          </li>
          <li style={s.step}>
            When training completes, the new model appears in the model
            dropdown under <span style={s.label}>Controls</span>. Select it to
            switch inference to your custom weights.
          </li>
        </ol>
        <div style={s.callout}>
          <span style={s.label}>Recommended dataset size:</span> At least 200
          images per class (vacant / occupied) for reliable results. Capture
          images across different times of day and weather conditions.
        </div>
        <hr style={s.divider} />
        <p style={{ ...s.body, marginBottom: 0 }}>
          After switching to a newly trained model, monitor the{' '}
          <span style={s.label}>Confidence Gauge</span> over the next 30 minutes
          to confirm the model is performing as expected on live frames. If
          confidence drops, collect more training data under the failing
          conditions and retrain.
        </p>
      </SectionCard>
    </div>
  )
}
