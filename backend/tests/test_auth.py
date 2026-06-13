import config
from src.api.deps import verify_token


def test_login_unconfigured_returns_503(test_client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
    r = test_client.post("/api/auth/login", json={"password": "anything"})
    assert r.status_code == 503


def test_login_wrong_password_returns_401(test_client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "s3cret")
    r = test_client.post("/api/auth/login", json={"password": "nope"})
    assert r.status_code == 401


def test_login_success_returns_valid_token(test_client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "s3cret")
    r = test_client.post("/api/auth/login", json={"password": "s3cret"})
    assert r.status_code == 200
    body = r.json()
    assert body["expires_in"] == config.AUTH_TOKEN_TTL
    assert verify_token(body["token"])


def test_admin_token_authorizes_protected_endpoint(test_client, monkeypatch):
    # With a static API key set, a valid Bearer token must pass verify_api_key.
    monkeypatch.setattr(config, "API_KEY", "static-key")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "s3cret")
    token = test_client.post("/api/auth/login", json={"password": "s3cret"}).json()["token"]
    r = test_client.get("/api/cameras", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    # And a bogus token is rejected.
    r = test_client.get("/api/cameras", headers={"Authorization": "Bearer 9999999999.deadbeef"})
    assert r.status_code == 401
