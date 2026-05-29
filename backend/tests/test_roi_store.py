import pytest
from src.roi.roi_store import RoiStore


def _roi(roi_id: str, label: str) -> dict:
    return {
        "id": roi_id,
        "label": label,
        "polygon": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]],
    }


def test_save_and_get():
    rois = [_roi(f"r{i}", f"Slot {i}") for i in range(3)]
    RoiStore.save_rois("test", rois)
    loaded = RoiStore.get_rois("test")
    assert loaded == rois


def test_delete():
    rois = [_roi("r0", "Slot 0"), _roi("r1", "Slot 1")]
    RoiStore.save_rois("test_del", rois)
    assert RoiStore.delete_roi("test_del", "r0") is True
    remaining = RoiStore.get_rois("test_del")
    assert len(remaining) == 1
    assert remaining[0]["id"] == "r1"


def test_invalid_coords():
    with pytest.raises(ValueError):
        RoiStore.save_rois("bad_cam", [
            {"id": "bad", "label": "Bad",
             "polygon": [[0.1, 0.1], [1.5, 0.1], [1.5, 1.5]]},
        ])


def test_camera_isolation():
    RoiStore.save_rois("cam_a", [_roi("ra", "A")])
    RoiStore.save_rois("cam_b", [_roi("rb", "B")])

    result_a = RoiStore.get_rois("cam_a")
    result_b = RoiStore.get_rois("cam_b")

    assert len(result_a) == 1 and result_a[0]["id"] == "ra"
    assert len(result_b) == 1 and result_b[0]["id"] == "rb"
