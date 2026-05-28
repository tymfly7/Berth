"""
Demo Processor — Synthetic Parking Data for Testing
=====================================================
Generates realistic simulated parking data so the dashboard
can be demonstrated without a trained model or camera.
"""

import sys
import base64
import math
import random
import threading
import time
import logging
from datetime import datetime, timezone
from collections import deque
from pathlib import Path
import cv2
import numpy as np
import config


logger = logging.getLogger("smartpark.demo")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))


# Demo parking lot layout: 3 rows × 6 columns = 18 slots
DEMO_SLOTS = []
for row in range(3):
    for col in range(6):
        DEMO_SLOTS.append({
            "id": row * 6 + col + 1,
            "x": 50 + col * 135,
            "y": 60 + row * 140,
            "width": 120,
            "height": 120,
        })


class DemoProcessor:
    """Generates synthetic parking frames and metrics for dashboard demo."""

    def __init__(self):
        self.running = False
        self.thread = None
        self.lock = threading.Lock()
        self._frame = None
        self._metrics = self._default_metrics()
        self._history = deque(maxlen=100)
        self._heatmap = {}
        self._slot_states = {}
        self._tick = 0

        # Init random states
        for slot in DEMO_SLOTS:
            self._slot_states[slot["id"]] = random.random() > 0.4

    def start_processing(self):
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()
        logger.info("▶️  Demo processor started")

    def stop_processing(self):
        self.running = False
        if self.thread:
            self.thread.join(timeout=2)

    def set_video_source(self, source):
        pass  # Demo ignores video source

    def _loop(self):
        while self.running:
            self._tick += 1
            self._update_states()
            frame = self._render_frame()
            metrics = self._compute_metrics()

            with self.lock:
                self._frame = frame
                self._metrics = metrics
                self._history.append({
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "available": metrics["available"],
                    "occupied": metrics["occupied"],
                    "occupancy_percent": metrics["occupancy_percent"],
                })

            time.sleep(1.0 / config.STREAM_FPS)

    def _update_states(self):
        """Randomly toggle some slot states to simulate cars arriving/leaving."""
        if self._tick % 10 == 0:
            slot_id = random.choice(list(self._slot_states.keys()))
            self._slot_states[slot_id] = not self._slot_states[slot_id]

    def _render_frame(self):
        """Render a synthetic parking lot image."""
        w, h = config.FRAME_WIDTH, config.FRAME_HEIGHT
        frame = np.full((h, w, 3), (45, 45, 50), dtype=np.uint8)

        # Title
        cv2.putText(frame, "Smart Parking AI — Demo Mode", (15, 35),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)

        # Draw slots
        for slot in DEMO_SLOTS:
            x, y, sw, sh = slot["x"], slot["y"], slot["width"], slot["height"]
            occupied = self._slot_states.get(slot["id"], False)
            conf = 0.85 + random.random() * 0.14

            color = (0, 0, 180) if occupied else (0, 180, 0)
            cv2.rectangle(frame, (x, y), (x+sw, y+sh), color, -1)
            cv2.rectangle(frame, (x, y), (x+sw, y+sh), (255, 255, 255), 1)

            label = f"#{slot['id']} {'OCC' if occupied else 'VAC'}"
            cv2.putText(frame, label, (x+5, y+20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
            cv2.putText(frame, f"{conf:.0%}", (x+5, y+sh-10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (220, 220, 220), 1)

            # Update heatmap
            sid = str(slot["id"])
            if sid not in self._heatmap:
                self._heatmap[sid] = {"occupied_count": 0, "total_count": 0}
            self._heatmap[sid]["total_count"] += 1
            if occupied:
                self._heatmap[sid]["occupied_count"] += 1

        return frame

    def _compute_metrics(self):
        occ = sum(1 for v in self._slot_states.values() if v)
        total = len(self._slot_states)
        avail = total - occ
        return {
            "total": total,
            "available": avail,
            "occupied": occ,
            "occupancy_percent": round(100.0 * occ / total, 1) if total else 0,
            "avg_confidence": round(0.9 + random.random() * 0.09, 4),
            "slots": [
                {
                    "id": s["id"],
                    "status": "occupied" if self._slot_states[s["id"]] else "vacant",
                    "confidence": round(0.85 + random.random() * 0.14, 4),
                    "bbox": [s["x"], s["y"], s["width"], s["height"]],
                }
                for s in DEMO_SLOTS
            ],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_latest_frame_base64(self):
        with self.lock:
            if self._frame is None:
                return None
            _, buf = cv2.imencode(".jpg", self._frame,
                                  [cv2.IMWRITE_JPEG_QUALITY, config.JPEG_QUALITY])
            return base64.b64encode(buf).decode("utf-8")

    def get_metrics(self):
        with self.lock:
            return dict(self._metrics)

    def get_history(self):
        with self.lock:
            return list(self._history)

    def get_heatmap(self):
        with self.lock:
            result = []
            for sid, data in self._heatmap.items():
                total = data["total_count"]
                occ = data["occupied_count"]
                result.append({
                    "slot_id": int(sid),
                    "occupancy_rate": round(occ / total * 100, 1) if total else 0,
                    "total_observations": total,
                })
            return result

    def _default_metrics(self):
        return {
            "total": 0, "available": 0, "occupied": 0,
            "occupancy_percent": 0.0, "avg_confidence": 0.0,
            "slots": [], "timestamp": datetime.now(timezone.utc).isoformat(),
        }
