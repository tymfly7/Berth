import io
import sys
from pathlib import Path

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


@pytest.fixture(autouse=True)
def patch_roi_dir(tmp_path, monkeypatch):
    roi_dir = tmp_path / "roi_configs"
    roi_dir.mkdir()
    monkeypatch.setattr(config, "ROI_CONFIG_DIR", roi_dir)


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
