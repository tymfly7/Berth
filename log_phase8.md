# Phase 8 — Log

## Demo Mode Investigation

**Issue reported:** The image (`alt="Parking lot live feed"`) and the `.metrics-row fade-in` metric cards were changing randomly and not reflecting real occupancy.

**Root cause:** No trained model or real camera was available, so `main.py:137–141` falls back to `DemoProcessor` (`backend/src/inference/demo_processor.py`). The demo processor:
- Randomly toggles a slot's occupied/vacant state every 10 ticks (`_update_states`, line 93–97)
- Renders a fully synthetic parking lot frame (not a real camera feed)
- Computes metrics from those randomised states

**Resolution:** Explained to user that real occupancy requires either a trained model + camera, or an uploaded video. The random behaviour is intentional demo behaviour.

---

## UI Change — Reduce Metric Card Size

**Files changed:**
- `frontend/src/components/MetricCards.jsx`
- `frontend/src/App.css`

**Changes:**

| Property | Before | After |
|---|---|---|
| Card padding | `20px` | `12px 14px` |
| Card gap | `8px` | `6px` |
| Icon wrap size | `40×40` | `30×30` |
| Icon font size | `1.2rem` | `0.95rem` |
| Big number font | `2rem` | `1.5rem` |
| Letter spacing (number) | `-1px` | `-0.5px` |
| Label font size | `0.75rem` | `0.68rem` |
| `.metrics-row` gap | `16px` | `10px` |

---

## UI Change — Remove AlertBanner

**Issue reported:** Info bar with `padding: 12px 20px; border-...` was showing and needed removal.

**Component identified:** `frontend/src/components/AlertBanner.jsx`

**Files changed:**
- `frontend/src/pages/AdminView.jsx` — removed import and `<AlertBanner>` usage
- `frontend/src/pages/PublicView.jsx` — removed import and `<AlertBanner>` usage

Component file retained at `frontend/src/components/AlertBanner.jsx`.

---

## UI Change — Occupancy Progress Bar Smooth Color

**File changed:** `frontend/src/components/MetricCards.jsx`

**Before:** 3-step hard-coded color switch (`> 85` → red, `> 60` → yellow, else green) using CSS variables.

**After:** Smooth HSL interpolation via `occupancyColor(pct)`:
- Hue: `120` (green) → `0` (red) as occupancy goes 0 → 100%
- Saturation: `65%` → `100%` (more vivid at high occupancy)
- Lightness: `44%` → `34%` (darker/more intense at high occupancy)
