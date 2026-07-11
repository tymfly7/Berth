"""
YouTube Live Stream Resolver
============================
Resolves a public YouTube *live* watch URL (e.g. ``youtube.com/watch?v=...``)
to a direct HLS (``.m3u8``) stream URL that ``cv2.VideoCapture`` can open.

OpenCV cannot open a YouTube watch page — it needs a direct media URL. We run
``yt-dlp`` as a subprocess to extract one: importing it in-process pins
~50-80 MiB for the life of the server, while a short-lived subprocess gives
that back after each resolve — and the URL cache below makes the spawn cost
(one every TTL) irrelevant. Live HLS URLs are short-lived, so we cache them
with a short TTL and support ``force_refresh`` to re-resolve on reconnect.

Scope: live streams only (regular/finished videos are out of scope).
"""

import json
import subprocess
import sys
import time
import threading
import logging

import config

logger = logging.getLogger("berth.youtube")

# In-memory cache: {watch_url: (stream_url, resolved_at)}
_cache: dict = {}

# Per-URL resolution locks so concurrent reconnects of the same stream coalesce
# into one yt-dlp call instead of stampeding YouTube.
_locks: dict = {}
_locks_guard = threading.Lock()


def _lock_for(watch_url: str) -> threading.Lock:
    with _locks_guard:
        lk = _locks.get(watch_url)
        if lk is None:
            lk = threading.Lock()
            _locks[watch_url] = lk
        return lk


class YouTubeResolveError(Exception):
    """Raised when a YouTube watch URL cannot be resolved to a stream URL."""


def _pick_m3u8(info: dict) -> str | None:
    """
    Prefer an HLS/m3u8 URL from extracted info, keeping to formats at or
    below ``config.YOUTUBE_MAX_HEIGHT`` (formats without a height pass).

    Order of preference:
      1. The top-level ``info["url"]`` (yt-dlp's chosen format) if it's m3u8
         and within the height cap.
      2. The best within-cap format carrying both video and audio that looks
         like m3u8.
      3. The best within-cap video-only m3u8 format.
    """
    def _within_cap(height) -> bool:
        return not height or height <= config.YOUTUBE_MAX_HEIGHT

    top = info.get("url")
    if top and ".m3u8" in top and _within_cap(info.get("height")):
        return top

    formats = info.get("formats") or []

    # Prefer formats with both video + audio.
    for fmt in reversed(formats):
        url = fmt.get("url", "")
        if ".m3u8" not in url or not _within_cap(fmt.get("height")):
            continue
        if fmt.get("vcodec", "none") != "none" and fmt.get("acodec", "none") != "none":
            return url

    # Fall back to best video-only m3u8.
    for fmt in reversed(formats):
        url = fmt.get("url", "")
        if (".m3u8" in url and fmt.get("vcodec", "none") != "none"
                and _within_cap(fmt.get("height"))):
            return url

    # Last resort: the top-level url even if not obviously m3u8.
    return top


def resolve_stream_url(watch_url: str, force_refresh: bool = False,
                       ttl: int = None) -> str:
    """
    Resolve a YouTube live watch URL to a direct HLS stream URL.

    Args:
        watch_url: The YouTube watch URL (or any yt-dlp supported live URL).
        force_refresh: Bypass the cache and re-resolve (used on reconnect,
            since live HLS URLs expire).
        ttl: Cache time-to-live in seconds. Defaults to
            ``config.YOUTUBE_STREAM_CACHE_TTL``.

    Returns:
        A direct stream URL suitable for ``cv2.VideoCapture``.

    Raises:
        YouTubeResolveError: If resolution fails or no stream URL is found.
    """
    ttl = ttl if ttl is not None else config.YOUTUBE_STREAM_CACHE_TTL

    # Fast path: a fresh cached URL satisfies non-refresh callers without locking.
    if not force_refresh:
        cached = _cache.get(watch_url)
        if cached and (time.time() - cached[1]) < ttl:
            return cached[0]

    request_time = time.time()
    with _lock_for(watch_url):
        # Coalesce concurrent reconnects: if another waiter resolved after we
        # started waiting, reuse its result instead of re-resolving. Also honour
        # a still-fresh cache entry for non-forced callers.
        cached = _cache.get(watch_url)
        if cached:
            if cached[1] >= request_time:
                return cached[0]
            if not force_refresh and (time.time() - cached[1]) < ttl:
                return cached[0]

        # Cap stream height (default 480p): smaller HLS segments download
        # faster per cap.read(), and full-quality decode overwhelms
        # low-RAM edge boxes.
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--quiet", "--no-warnings",
            "--dump-json",
            "--format", f"best[height<={config.YOUTUBE_MAX_HEIGHT}]/best",
            watch_url,
        ]
        try:
            # Generous timeout: the child inherits the service's cgroup, so on a
            # memory-capped edge box it may be allocation-throttled past MemoryHigh
            # and crawl — an 8 s resolve can legitimately take minutes there.
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        except subprocess.TimeoutExpired as e:
            logger.error(f"yt-dlp timed out resolving '{watch_url}'")
            raise YouTubeResolveError(f"Could not resolve YouTube URL: {e}") from e

        if proc.returncode != 0:
            err = (proc.stderr or "").strip()
            if "No module named" in err:
                raise YouTubeResolveError(
                    "yt-dlp is not installed — run: pip install yt-dlp"
                )
            logger.error(f"yt-dlp failed to resolve '{watch_url}': {err}")
            raise YouTubeResolveError(f"Could not resolve YouTube URL: {err}")

        try:
            info = json.loads(proc.stdout)
        except ValueError as e:
            raise YouTubeResolveError(f"Could not parse yt-dlp output: {e}") from e

        stream_url = _pick_m3u8(info)
        if not stream_url:
            raise YouTubeResolveError(
                f"No playable stream URL found for '{watch_url}'"
            )

        _cache[watch_url] = (stream_url, time.time())
        logger.info(f"Resolved YouTube stream for '{watch_url}' (ttl={ttl}s)")
        return stream_url
