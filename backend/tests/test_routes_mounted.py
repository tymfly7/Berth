"""Every router that exists must actually be mounted on main.app.

The dev routers (training, labeling) were silently absent from main.py after the
dev/edge restructure, so 23 endpoints 404'd while the suite stayed green — the
dev tests built their own app instead of using the real one. These checks read
main.app's own schema rather than issuing requests, because the SPA catch-all in
main.py answers unmounted GETs with the same 404 a live handler would return.
"""

import pytest

from dev.routers import labeling, training
from src.api.routers import analytics, auth, cameras, inference, models, roi

ROUTERS = {
    "inference": inference, "analytics": analytics, "models": models,
    "cameras": cameras, "roi": roi, "auth": auth,
    "training": training, "labeling": labeling,
}


@pytest.mark.parametrize("name", sorted(ROUTERS))
def test_router_is_mounted(name):
    import main

    # Read the OpenAPI schema, not app.routes: Starlette 1.6 replaced the
    # per-route entries include_router used to add with a single wrapper object
    # that has no .path.
    mounted = set(main.app.openapi()["paths"])
    missing = sorted({r.path for r in ROUTERS[name].router.routes} - mounted)
    assert not missing, f"{name}.router is not mounted on main.app: {missing}"
