import pytest


@pytest.fixture
def test_client():
    # Dev routers (training, labeling) are not mounted on the runtime main.app,
    # so build a test app that mounts them to exercise the dev-only endpoints.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from dev.routers import labeling, training

    app = FastAPI()
    app.include_router(training.router)
    app.include_router(labeling.router)
    return TestClient(app)
