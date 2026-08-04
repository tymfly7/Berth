"""The SPA catch-all must not answer unknown API paths with the SPA shell.

`@app.get("/{full_path:path}")` matches everything left over. Registration order
only stops it shadowing routes that exist, so before the prefix guard an unknown
/api/ path fell through and returned 200 + index.html. A client calling a typo'd
or removed endpoint got HTML and a success code instead of a 404, which is how
four deleted endpoints stayed in the docs unnoticed.
"""

import pytest


@pytest.fixture
def served_spa(tmp_path, monkeypatch):
    """Point main at a static dir holding an index.html, as in production."""
    import main

    (tmp_path / "index.html").write_text("<!doctype html><title>SPA</title>", encoding="utf-8")
    monkeypatch.setattr(main, "_static_dir", tmp_path)


def test_unknown_api_path_is_404_even_when_spa_is_served(test_client, served_spa):
    r = test_client.get("/api/no-such-endpoint")
    assert r.status_code == 404
    assert "text/html" not in r.headers.get("content-type", "")


def test_unknown_ws_path_is_404(test_client, served_spa):
    assert test_client.get("/ws/no-such-stream").status_code == 404


def test_browser_route_falls_back_to_the_spa(test_client, served_spa):
    r = test_client.get("/admin/some/client/route")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_real_api_route_still_works(test_client, served_spa):
    assert test_client.get("/api/health").status_code == 200


def test_unknown_path_is_404_without_a_built_frontend(test_client, tmp_path, monkeypatch):
    import main

    monkeypatch.setattr(main, "_static_dir", tmp_path / "absent")
    assert test_client.get("/admin/some/client/route").status_code == 404
