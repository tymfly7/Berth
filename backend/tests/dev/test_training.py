from unittest.mock import MagicMock, patch


def test_model_info(test_client):
    r = test_client.get("/api/model/info")
    assert r.status_code == 200
    assert "active_model" in r.json()


# ── Training ──────────────────────────────────────────────────────────────────

def test_train_start_no_dataset(test_client, tmp_path, monkeypatch):
    import config
    # Point DATA_DIR at an empty temp dir so occupied/vacant are absent
    # regardless of what exists on the machine running the suite, and stub
    # TrainManager so a stray "already training" state can't shadow the check
    # (and so the endpoint can never kick off a real training run).
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    # CLASSIFY_SPLIT_DIR is derived from DATA_DIR at config import, so patching
    # DATA_DIR alone leaves it pointing at the real split on machines where the
    # dataset exists — patch the derived path too.
    monkeypatch.setattr(config, "CLASSIFY_SPLIT_DIR", tmp_path / "classify_split")
    mock_mgr = MagicMock()
    mock_mgr.is_training.return_value = False
    with patch("dev.train.train_manager.TrainManager", return_value=mock_mgr):
        r = test_client.post("/api/train/start")
    assert r.status_code == 400
