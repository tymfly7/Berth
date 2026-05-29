import io
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image


def _jpeg_bytes(w=64, h=64, color=(100, 150, 200)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color=color).save(buf, "JPEG")
    buf.seek(0)
    return buf.read()


# ── Basic endpoints ───────────────────────────────────────────────────────────

def test_root(test_client):
    r = test_client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "running"


def test_health(test_client):
    r = test_client.get("/api/health")
    assert r.status_code == 200
    assert "processor" in r.json()


def test_metrics(test_client):
    r = test_client.get("/api/metrics")
    assert r.status_code == 200
    body = r.json()
    assert "total" in body
    assert "available" in body


def test_history(test_client):
    r = test_client.get("/api/history")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_heatmap(test_client):
    r = test_client.get("/api/heatmap")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_status(test_client):
    r = test_client.get("/api/status")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["busy"], bool)
    assert isinstance(body["operations"], list)


def test_model_info(test_client):
    r = test_client.get("/api/model/info")
    assert r.status_code == 200
    assert "active_model" in r.json()


def test_public_metrics(test_client):
    r = test_client.get("/api/public/metrics")
    assert r.status_code == 200
    assert "total" in r.json()


# ── Predict ───────────────────────────────────────────────────────────────────

def test_predict_no_model(test_client):
    data = _jpeg_bytes()
    r = test_client.post(
        "/api/predict",
        files={"file": ("spot.jpg", data, "image/jpeg")},
    )
    assert r.status_code == 400


# ── Analyze lot ───────────────────────────────────────────────────────────────

def test_analyze_lot(test_client):
    mock_clf = MagicMock()
    mock_clf.is_loaded.return_value = True
    mock_clf.predict_batch.return_value = [
        {"status": "vacant", "confidence": 0.9} for _ in range(4)
    ]

    data = _jpeg_bytes(64, 64)
    with patch("main._resolve_model_name", return_value="cnn_scratch"), \
         patch("src.inference.classifier.ParkingClassifier", return_value=mock_clf):
        r = test_client.post(
            "/api/analyze-lot?rows=2&cols=2",
            files={"file": ("lot.jpg", data, "image/jpeg")},
        )

    assert r.status_code == 200
    assert r.json()["total"] == 4


# ── ROI CRUD ──────────────────────────────────────────────────────────────────

def test_roi_crud(test_client):
    rois = [
        {
            "id": "roi_001",
            "label": "Slot 1",
            "polygon": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]],
        },
        {
            "id": "roi_002",
            "label": "Slot 2",
            "polygon": [[0.5, 0.5], [0.7, 0.5], [0.7, 0.7], [0.5, 0.7]],
        },
    ]

    r = test_client.post("/api/roi/test_cam", json={"rois": rois})
    assert r.status_code == 200

    r = test_client.get("/api/roi/test_cam")
    assert r.status_code == 200
    loaded = r.json()
    assert len(loaded) == 2
    assert loaded[0]["id"] == "roi_001"

    r = test_client.delete("/api/roi/test_cam/roi_001")
    assert r.status_code == 200

    r = test_client.get("/api/roi/test_cam")
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == "roi_002"


# ── Dataset upload ────────────────────────────────────────────────────────────

def test_upload_dataset(test_client, tmp_data_dir):
    files = [
        ("files", (f"img{i}.jpg", _jpeg_bytes(), "image/jpeg"))
        for i in range(3)
    ]
    r = test_client.post(
        "/api/dataset/upload",
        files=files,
        data={"label": "occupied"},
    )
    assert r.status_code == 200
    assert r.json()["saved"] == 3


# ── Training ──────────────────────────────────────────────────────────────────

def test_train_start_no_dataset(test_client):
    r = test_client.post("/api/train/start")
    assert r.status_code == 400


# ── Camera CRUD ───────────────────────────────────────────────────────────────

def test_camera_crud(test_client):
    cam_name = "test-cam-pytest"

    r = test_client.post("/api/cameras", json={
        "name": cam_name,
        "source": "0",
        "type": "usb",
    })
    assert r.status_code == 201
    cam_id = r.json()["id"]

    r = test_client.get("/api/cameras")
    assert r.status_code == 200
    ids = [c["id"] for c in r.json()]
    assert cam_id in ids

    r = test_client.delete(f"/api/cameras/{cam_id}")
    assert r.status_code == 200
