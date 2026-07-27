"""Behaviour tests for the batch auto-labeling endpoints.

These run against the real main.app (the shared test_client fixture), so they
also fail if dev.routers.labeling stops being mounted — but they assert on the
response body, not just the status, because the SPA catch-all in main.py answers
an unmounted path with a 404 too.
"""


def test_manifest_missing_when_no_run(test_client, tmp_path, monkeypatch):
    import config
    # Point DATA_DIR at an empty temp dir so the lookup misses regardless of what
    # the machine running the suite has under data/labeled/.
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    r = test_client.get("/api/label-batch/lot-t10lot/manifest")
    assert r.status_code == 404
    assert "No labeling run found" in r.json()["detail"]


def test_last_run_empty_before_first_run(test_client):
    r = test_client.get("/api/label-batch/never-run/last-run")
    assert r.status_code == 200
    assert r.json() == {"ok": None, "error": None}


def test_invalid_lot_id_rejected(test_client):
    # _SAFE_ID allows [A-Za-z0-9_-] only; a dot must not reach the filesystem.
    r = test_client.get("/api/label-batch/lot.t10lot/manifest")
    assert r.status_code == 400
    assert "Invalid lot_id" in r.json()["detail"]
