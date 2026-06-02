# Phase 9 — Monetization Plan

> Status: **PLANNED** — no implementation started  
> Stripe: **Mock/placeholder** (swap for live Stripe keys when ready)  
> Depends on: Phase 6 (Admin/Public split + auth scaffolding)

---

## Goals

Turn SmartPark into a billable multi-tenant SaaS product with five revenue streams:

| # | Stream | Revenue type |
|---|--------|-------------|
| 1 | SaaS subscription tiers | Recurring monthly |
| 2 | Per-camera / per-lot licensing | Seat-based recurring |
| 3 | API access plans | Usage-based |
| 4 | Edge hardware bundle | One-time + annual renewal |
| 5 | Analytics PDF reports | Add-on / included in Pro+ |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                 Frontend (React)                     │
│  PricingPage  BillingPortal  UsageDashboard          │
└────────────────────┬────────────────────────────────┘
                     │ REST / WS
┌────────────────────▼────────────────────────────────┐
│                FastAPI Backend                       │
│                                                      │
│  Auth middleware  →  Quota middleware  →  Routes     │
│  (JWT tenant)        (plan limits)                   │
│                                                      │
│  /api/billing/*   /api/auth/*   /api/usage/*         │
└──────┬──────────────────────────────┬───────────────┘
       │                              │
┌──────▼──────┐               ┌───────▼────────┐
│  SQLite DB  │               │  MockStripe    │
│  tenants    │               │  (placeholder) │
│  plans      │               │  → swap for    │
│  seats      │               │    stripe-python│
│  api_usage  │               │    when ready  │
│  subscriptions│             └────────────────┘
└─────────────┘
```

---

## Database Schema (new tables)

```sql
-- Tenants (one per parking operator / customer)
CREATE TABLE tenants (
    id          TEXT PRIMARY KEY,          -- uuid
    name        TEXT NOT NULL,
    email       TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    plan_id     TEXT NOT NULL DEFAULT 'free',
    stripe_customer_id TEXT,              -- null in mock mode
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Plans catalogue
CREATE TABLE plans (
    id              TEXT PRIMARY KEY,     -- 'free' | 'pro' | 'enterprise'
    name            TEXT NOT NULL,
    price_cents     INTEGER NOT NULL,     -- 0 for free
    camera_limit    INTEGER NOT NULL,     -- -1 = unlimited
    history_days    INTEGER NOT NULL,     -- retention window
    api_calls_month INTEGER NOT NULL,     -- -1 = unlimited
    can_export_pdf  BOOLEAN NOT NULL DEFAULT 0,
    can_api_access  BOOLEAN NOT NULL DEFAULT 0
);

-- Active subscriptions
CREATE TABLE subscriptions (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    plan_id         TEXT NOT NULL REFERENCES plans(id),
    status          TEXT NOT NULL,        -- 'active' | 'canceled' | 'past_due'
    current_period_end DATETIME,
    stripe_sub_id   TEXT                  -- null in mock mode
);

-- License seats (camera activations)
CREATE TABLE license_seats (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    camera_id   TEXT NOT NULL,
    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, camera_id)
);

-- API usage counters (reset monthly)
CREATE TABLE api_usage (
    tenant_id   TEXT NOT NULL REFERENCES tenants(id),
    year_month  TEXT NOT NULL,            -- '2026-06'
    call_count  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, year_month)
);
```

**Seed data (plans catalogue):**

| id | name | price | cameras | history | api calls/mo | PDF | API |
|----|------|-------|---------|---------|-------------|-----|-----|
| free | Free | $0 | 1 | 7 days | 1,000 | No | No |
| pro | Pro | $29 | 5 | 90 days | 50,000 | Yes | Yes |
| enterprise | Enterprise | $99 | -1 | 365 days | -1 | Yes | Yes |

---

## Build Order

### Step 1 — User / Tenant Auth
**Files:** `backend/src/auth/`, `backend/src/auth/auth_router.py`, `backend/src/auth/jwt_utils.py`

- `POST /api/auth/register` — create tenant, hash password (bcrypt), return JWT
- `POST /api/auth/login` — verify password, return JWT
- `GET  /api/auth/me` — return tenant + plan info
- JWT middleware: inject `tenant_id` into request state; fall back to legacy `SMARTPARK_API_KEY` for backwards compat
- **Dependencies:** `python-jose`, `passlib[bcrypt]`

---

### Step 2 — Plans Seeding + Quota Middleware
**Files:** `backend/src/billing/quota.py`, `backend/src/db/database.py`

- Seed plans table on `init_db()`
- `QuotaMiddleware` (FastAPI middleware):
  - Camera activation: check `len(license_seats) < plan.camera_limit`
  - API call: increment `api_usage`, reject with 429 if over limit
  - History query: clamp `range` param to `plan.history_days`
  - Feature flag: return 403 if `can_export_pdf=False` and endpoint is `/api/reports/*`

---

### Step 3 — Mock Stripe Service
**Files:** `backend/src/billing/mock_stripe.py`, `backend/src/billing/billing_router.py`

`mock_stripe.py` simulates the Stripe API surface used by the app:

```python
# mock_stripe.py — placeholder, swap for stripe-python later
def create_checkout_session(tenant_id, plan_id, success_url, cancel_url):
    """Returns a fake checkout URL that auto-confirms after 2s."""
    return {"url": f"/mock-checkout?tenant={tenant_id}&plan={plan_id}"}

def create_customer_portal_session(tenant_id):
    return {"url": f"/mock-portal?tenant={tenant_id}"}

def handle_webhook(payload, sig_header):
    """Parse mock webhook event (JSON posted by frontend mock UI)."""
    ...
```

REST endpoints (`/api/billing/`):
- `POST /api/billing/checkout` — start checkout (mock returns redirect URL)
- `POST /api/billing/portal` — customer portal link
- `POST /api/billing/webhook` — receive Stripe webhook (mock: frontend posts event)
- `GET  /api/billing/subscription` — current plan + period end + usage summary

---

### Step 4 — Per-Camera Seat Check
**Files:** `backend/src/cameras/camera_registry.py` (existing)

- On `activate_camera()`: query `license_seats`; if at limit → raise `PlanLimitError`
- On `deactivate_camera()`: remove seat row (frees the slot)
- Admin frontend shows seat count: `2 / 5 cameras used`

---

### Step 5 — API Usage Metering
**Files:** `backend/src/billing/quota.py`

- Wrap `/predict` and `/api/analyze-lot` with usage counter
- Counter increments atomically via `INSERT OR REPLACE INTO api_usage ... ON CONFLICT DO UPDATE SET call_count = call_count + 1`
- Usage visible at `GET /api/usage` → `{calls_this_month, limit, plan}`

---

### Step 6 — Analytics PDF Report
**Files:** `backend/src/reports/pdf_report.py`, `backend/src/reports/report_router.py`

- `GET /api/reports/weekly` → generates PDF via `reportlab`:
  - Cover: lot name, date range, branding
  - Page 1: occupancy trend chart (matplotlib → PNG → embed)
  - Page 2: peak hours heatmap
  - Page 3: per-camera breakdown table
- `POST /api/reports/schedule` → store cron config; `APScheduler` emails PDF weekly
- **Dependencies:** `reportlab`, `apscheduler`, SMTP config via env vars

---

### Step 7 — Frontend Billing UI
**Files:** `frontend/src/pages/PricingPage.jsx`, `frontend/src/pages/BillingPortal.jsx`, `frontend/src/components/UsageBanner.jsx`

- `PricingPage`: three-column pricing cards (Free / Pro / Enterprise), "Upgrade" button calls `/api/billing/checkout`
- `BillingPortal`: shows current plan, next renewal, usage bars (cameras used, API calls this month)
- `UsageBanner`: thin warning bar shown in AdminView when usage > 80% of limit
- Mock checkout: redirect to `/mock-checkout` route that auto-confirms and fires a webhook back

---

### Step 8 — Hardware Bundle Doc
**Files:** `HARDWARE_BUNDLE.md`

No backend code. Documents:
- Bill of materials (Raspberry Pi 5 16GB, camera module, case)
- Flashing SmartPark OS image
- License key activation flow
- Annual renewal pricing

---

## Environment Variables (new)

```env
# Auth
JWT_SECRET=change-me-in-prod
JWT_EXPIRE_MINUTES=1440

# Mock Stripe (replace values with real Stripe keys in production)
STRIPE_MODE=mock                        # 'mock' | 'live'
STRIPE_SECRET_KEY=sk_mock_placeholder
STRIPE_WEBHOOK_SECRET=whsec_mock_placeholder
STRIPE_PRO_PRICE_ID=price_mock_pro
STRIPE_ENTERPRISE_PRICE_ID=price_mock_enterprise

# Reports / email
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
REPORTS_FROM_EMAIL=reports@smartpark.local
```

---

## Swapping Mock → Live Stripe

When ready for production, three changes only:

1. `pip install stripe`
2. In `billing_router.py`: replace `from src.billing.mock_stripe import ...` with `import stripe` and use the real Stripe SDK calls
3. Set `STRIPE_MODE=live` + real keys in `.env`

No other files change.

---

## File Changelist

### New files
```
backend/src/auth/__init__.py
backend/src/auth/auth_router.py
backend/src/auth/jwt_utils.py
backend/src/billing/__init__.py
backend/src/billing/billing_router.py
backend/src/billing/mock_stripe.py
backend/src/billing/quota.py
backend/src/reports/__init__.py
backend/src/reports/pdf_report.py
backend/src/reports/report_router.py
frontend/src/pages/PricingPage.jsx
frontend/src/pages/BillingPortal.jsx
frontend/src/components/UsageBanner.jsx
HARDWARE_BUNDLE.md
```

### Modified files
```
backend/src/db/database.py      — add 5 new tables + plan seed data
backend/main.py                 — register auth/billing/report routers, add QuotaMiddleware
frontend/src/App.jsx            — add /pricing and /billing routes
frontend/src/pages/AdminView.jsx — add UsageBanner
```

---

## Success Criteria

- [ ] Tenant can register, log in, and receive a JWT
- [ ] Free plan blocks camera activation beyond 1 camera
- [ ] Pro plan mock checkout flow upgrades tenant in DB
- [ ] `/predict` calls over plan limit return 429 with `{"error": "api_limit_exceeded"}`
- [ ] `/api/reports/weekly` returns valid PDF for Pro tenants; 403 for Free
- [ ] `UsageBanner` appears in AdminView at 80%+ usage
- [ ] All existing Phase 1–8 features continue to work (no regressions)
- [ ] Swapping `STRIPE_MODE=live` requires zero other code changes

---

*Plan written 2026-06-02. Implementation pending user approval.*
