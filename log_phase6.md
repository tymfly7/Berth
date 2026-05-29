# Phase 6 — Public Board + PIN-Protected Admin Dashboard

## Summary
Split the app into a public-facing parking board (`/`) and a PIN-protected admin dashboard (`/admin`).

---

## Backend changes

### `backend/main.py`
- Added `GET /api/public/metrics` (no auth, no rate limit) that calls `_get_processor().get_metrics()`.
  Used by `PublicView` for its 8-second poll. All existing authenticated endpoints unchanged.

---

## Frontend changes

### `frontend/package.json`
- Added `"react-router-dom": "^7.0.0"` to dependencies.

### `frontend/src/App.jsx` (replaced)
- Now just a `BrowserRouter` + `Routes` shell:
  - `"/"` → `<PublicView />`
  - `"/admin"` → `<PinGate><AdminView /></PinGate>`

### `frontend/src/components/PinGate.jsx` (new)
- Checks `localStorage.getItem("admin_authed") === "true"`.
- If not authed: renders centered PIN entry UI (password input, Enter button).
- Compares against `import.meta.env.VITE_ADMIN_PIN ?? "1234"`.
- On match: sets `localStorage.admin_authed = "true"`, re-renders children.
- On mismatch: shows "Incorrect PIN" in red, clears input.
- Comment notes this is frontend-only / kiosk/demo use only.

### `frontend/src/pages/PublicView.jsx` (new)
- Polls `GET /api/public/metrics` every 8 seconds (no WebSocket).
- Updates clock every second via separate interval.
- Shows: heading "Parking Availability", live clock, large available-spots number (colour-coded by occupancy), `<MetricCards>`, `<AlertBanner>`.
- Fixed bottom-right "Admin" `<Link to="/admin">`.
- No controls, no training panel, no video feed, no camera manager.

### `frontend/src/pages/AdminView.jsx` (new)
- Contains all state and logic previously in `App.jsx` (WebSocket, metrics, history, heatmap, modelInfo, cameras, apiAction).
- Renders full admin UI: Header, ServerStatus, AlertBanner, MetricCards, VideoFeed, CameraManager, MultiCameraGrid, AnalyticsChart, ConfidenceGauge, HeatmapView, ModelStatus, TrainingPanel, ControlPanel, RoiManager.

### `frontend/src/components/Header.jsx` (updated)
- Added `useLocation` + `useNavigate` from react-router-dom.
- Added nav section with "Public View" (`/`) and "Admin" (`/admin`) links; active link is highlighted.
- When `pathname === "/admin"` and `localStorage.admin_authed === "true"`: shows a "Logout" button that clears storage and navigates to `/`.

---

## Routing map
| Path     | Component           | Auth        |
|----------|---------------------|-------------|
| `/`      | `PublicView`        | None        |
| `/admin` | `PinGate > AdminView` | PIN (localStorage) |

---

## Fix — `react-router-dom` not resolved by Vite

**Error:** `Failed to resolve import "react-router-dom"` — package was added to `package.json` but `npm install` had not been run, so the module was absent from `node_modules`.

**Fix:** Ran `npm install` in `frontend/` — added 4 packages (`react-router-dom` + its deps), 0 vulnerabilities.

---

## Fix — PIN input overflows glass-card

**Problem:** `<input className="input">` — no `.input` rule exists in the stylesheet, so the input used browser-default sizing and escaped the card boundary.

**Fix (`PinGate.jsx`):** Replaced `className="input"` with full inline styles: `width: 100%`, `box-sizing: border-box`, explicit padding/background/border/borderRadius matching the design system variables. Placeholder changed from `"PIN"` to `"••••"` for clarity.

---

## Update — Username + password login, glass-card container fix

**Changes (`PinGate.jsx`):**
- Replaced single PIN field with username + password fields.
- Credentials checked: username `"admin"`, password from `import.meta.env.VITE_ADMIN_PASSWORD ?? "password"`.
- Error message updated to "Incorrect username or password"; password field clears on failure, username retained.
- glass-card container: `width: 100%`, `maxWidth: 380px`, `display: flex / flexDirection: column / gap: 16px` — inputs and button are now fully contained and evenly spaced.
- Each field has a labelled group (`<label>` + `<input>`) with consistent `inputStyle` shared via a const.
- Prototype credentials: username `admin`, password `password`.

---

## Note — `.env` file location

No `.env` file existed in the project. It must be created manually at `frontend/.env` (same directory as `package.json`):

```
VITE_ADMIN_PASSWORD=password
```

The app works without it — `"password"` is the hardcoded fallback. The file is only needed to override the password without touching source code.

---

## Fix — `useNavigate is not defined` in AdminView

Stale `const navigate = useNavigate()` call remained on line 22 after the import was removed in a prior cleanup. Deleted the line — logout is handled entirely by Header.jsx.
