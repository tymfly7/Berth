"""
YouTube Live Stream Resolver
============================
Resolves a public YouTube *live* watch URL (e.g. ``youtube.com/watch?v=...``)
to a direct HLS (``.m3u8``) stream URL that ``cv2.VideoCapture`` can open.

OpenCV cannot open a YouTube watch page — it needs a direct media URL. We use
the ``yt_dlp`` Python API to extract one. Live HLS URLs are short-lived, so we
cache them with a short TTL and support ``force_refresh`` to re-resolve on
reconnect.

Scope: live streams only (regular/finished videos are out of scope).
"""

import time
import logging

import config

logger = logging.getLogger("smartpark.youtube")

# In-memory cache: {watch_url: (stream_url, expires_at)}
_cache: dict = {}


class YouTubeResolveError(Exception):
    """Raised when a YouTube watch URL cannot be resolved to a stream URL."""


def _pick_m3u8(info: dict) -> str | None:
    """
    Prefer an HLS/m3u8 URL from extracted info.

    Order of preference:
      1. The top-level ``info["url"]`` (yt-dlp's chosen best) if it's m3u8.
      2. A format carrying both video and audio that looks like m3u8.
      3. The best video-only m3u8 format.
    """
    top = info.get("url")
    if top and ".m3u8" in top:
        return top

    formats = info.get("formats") or []

    # Prefer formats with both video + audio.
    for fmt in reversed(formats):
        url = fmt.get("url", "")
        if ".m3u8" not in url:
            continue
        if fmt.get("vcodec", "none") != "none" and fmt.get("acodec", "none") != "none":
            return url

    # Fall back to best video-only m3u8.
    for fmt in reversed(formats):
        url = fmt.get("url", "")
        if ".m3u8" in url and fmt.get("vcodec", "none") != "none":
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

    if not force_refresh:
        cached = _cache.get(watch_url)
        if cached and cached[1] > time.time():
            return cached[0]

    try:
        from yt_dlp import YoutubeDL
    except ImportError as e:
        raise YouTubeResolveError(
            "yt-dlp is not installed — run: pip install yt-dlp"
        ) from e

    try:
        # Prefer 480p or lower: smaller HLS segments download faster, reducing
        # the blocking time per cap.read() call and improving perceived FPS.
        with YoutubeDL({
            "quiet": True,
            "no_warnings": True,
            "format": "best[height<=480]/best",
        }) as ydl:
            info = ydl.extract_info(watch_url, download=False)
    except Exception as e:
        logger.error(f"yt-dlp failed to resolve '{watch_url}': {e}")
        raise YouTubeResolveError(f"Could not resolve YouTube URL: {e}") from e

    stream_url = _pick_m3u8(info)
    if not stream_url:
        raise YouTubeResolveError(
            f"No playable stream URL found for '{watch_url}'"
        )

    _cache[watch_url] = (stream_url, time.time() + ttl)
    logger.info(f"Resolved YouTube stream for '{watch_url}' (ttl={ttl}s)")
    return stream_url
