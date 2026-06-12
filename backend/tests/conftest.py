import io
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

# Ensure backend/ is on the path when pytest runs from backend/
sys.path.insert(0, str(Path(__file__).parent.parent))

import config  # noqa: E402


@pytest.fixture
def test_client():
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.app)


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    occ_dir = tmp_path / "occupied"
    vac_dir = tmp_path / "vacant"
    occ_dir.mkdir()
    vac_dir.mkdir()

    for folder in (occ_dir, vac_dir):
        for i in range(10):
            img = Image.new("RGB", (32, 32), color=(i * 20, i * 10, i * 5))
            buf = io.BytesIO()
            img.save(buf, "JPEG")
            (folder / f"img_{i:02d}.jpg").write_bytes(buf.getvalue())

    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def mock_processor():
    proc = MagicMock()
    proc.get_metrics.return_value = {
        "total": 10,
        "available": 4,
        "occupied": 6,
        "occupancy_percent": 60.0,
        "avg_confidence": 0.85,
        "slots": [],
        "timestamp": "2026-01-01T00:00:00Z",
    }
    proc.get_history.return_value = []
    proc.get_heatmap.return_value = []
    proc.get_latest_frame_base64.return_value = None
    proc.start_processing.return_value = None
    proc.stop_processing.return_value = None
    return proc


@pytest.fixture(autouse=True)
def patch_get_processor(mock_processor):
    from src.api.processor_service import processor_service
    with patch.object(processor_service, "get_processor", return_value=mock_processor):
        yield


@pytest.fixture(autouse=True)
def patch_roi_dir(tmp_path, monkeypatch):
    import src.roi.roi_store as roi_module
    roi_dir = tmp_path / "roi_configs"
    roi_dir.mkdir()
    monkeypatch.setattr(roi_module, "_ROI_DIR", roi_dir)


@pytest.fixture(autouse=True)
def disable_auth(monkeypatch):
    # The endpoint tests assume auth is disabled. Force it off so a local
    # BERTH_API_KEY (e.g. from the developer's .env) doesn't turn every
    # protected endpoint into a 401 and make the suite environment-dependent.
    # Router endpoints read config.API_KEY live via deps.verify_api_key; the
    # WebSocket/health path reads main.API_KEY — patch both.
    import main
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(main, "API_KEY", "")
