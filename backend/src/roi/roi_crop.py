"""Shared ROI crop logic used by the auto-labeller (training crops) and by both
inference paths, so training and inference feed the classifier identical crops.

cv2 + numpy only — must stay importable on the torch-free NCNN edge profile.
"""

import cv2
import numpy as np


def _order_quad(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype="float32")


def crop_roi(frame: np.ndarray, polygon: list):
    """Deskewed (perspective-warped) crop for a 4-point quad so a slanted stall
    yields a tight, neighbor-free rectangle; axis-aligned bbox crop otherwise."""
    h, w = frame.shape[:2]
    if len(polygon) == 4:
        pts = np.array([[p[0] * w, p[1] * h] for p in polygon], dtype="float32")
        tl, tr, br, bl = _order_quad(pts)
        out_w = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
        out_h = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
        if out_w >= 2 and out_h >= 2:
            dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1],
                            [0, out_h - 1]], dtype="float32")
            m = cv2.getPerspectiveTransform(np.array([tl, tr, br, bl], dtype="float32"), dst)
            return cv2.warpPerspective(frame, m, (out_w, out_h))
    xs = [max(0, min(w - 1, int(p[0] * w))) for p in polygon]
    ys = [max(0, min(h - 1, int(p[1] * h))) for p in polygon]
    x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2]
