"""
Inference Pool — Shared worker pool for slot detection.

Replaces the per-camera inference thread with N shared workers that drain
a common queue. All VideoProcessors submit work here; workers call
detector.detect() and invoke the result callback.

Worker count defaults to min(cpu_count - 1, 4). Override with
BERTH_INFERENCE_WORKERS env var.
"""

import os
import queue
import threading
import logging

logger = logging.getLogger("berth.inference_pool")

_DEFAULT_WORKERS = min(max(1, (os.cpu_count() or 1) - 1), 4)


class InferencePool:
    """Shared inference worker pool — one instance shared across all VideoProcessors."""

    _instance: "InferencePool | None" = None
    _instance_lock = threading.Lock()

    @classmethod
    def get(cls) -> "InferencePool":
        """Return the singleton, starting it on first access."""
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = InferencePool()
                    cls._instance._start()
        return cls._instance

    def __init__(self, num_workers: int | None = None) -> None:
        self._num_workers = num_workers or int(
            os.getenv("BERTH_INFERENCE_WORKERS", str(_DEFAULT_WORKERS))
        )
        # Queue depth sets inference latency: a submission waits roughly
        # (depth / workers) x service-time before a worker picks it up. Keep it
        # shallow — a deep buffer just converts overload into staleness.
        self._queue: queue.Queue = queue.Queue(maxsize=max(2, self._num_workers * 2))
        self._workers: list[threading.Thread] = []
        self._running = False

    def _start(self) -> None:
        self._running = True
        for i in range(self._num_workers):
            t = threading.Thread(
                target=self._worker,
                daemon=True,
                name=f"infer-worker-{i}",
            )
            t.start()
            self._workers.append(t)
        logger.info(f"InferencePool started ({self._num_workers} workers)")

    def submit(self, detector, frame, camera_id: str, callback) -> None:
        """Submit a frame for inference, evicting the oldest queued frame when full.

        Live video wants the freshest frame available, not a backlog. Dropping the
        incoming frame instead left the pool draining stale ones, which surfaced as
        tens of seconds of inference latency once submissions outpaced the workers.
        """
        item = (detector, frame, camera_id, callback)
        try:
            self._queue.put_nowait(item)
            return
        except queue.Full:
            pass
        try:
            self._queue.get_nowait()  # evict oldest
            self._queue.task_done()
        except queue.Empty:
            pass
        try:
            self._queue.put_nowait(item)
        except queue.Full:
            pass  # another camera refilled it; next infer_event submits again

    def _worker(self) -> None:
        while self._running:
            try:
                detector, frame, camera_id, callback = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                result = detector.detect(frame, camera_id=camera_id)
                callback(result)
            except Exception as e:
                logger.warning(f"Inference worker error (camera={camera_id}): {e}")
            finally:
                self._queue.task_done()
