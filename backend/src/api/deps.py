"""
Shared API dependencies and request helpers
============================================
Auth, rate limiting, camera-source validation (SSRF guard), and image
decoding helpers used across the API routers. Kept free of any ``main``
import so routers can depend on it without a circular import.
"""

import base64
import hashlib
import hmac
import time
from urllib.parse import urlparse

import cv2
import numpy as np
from fastapi import HTTPException, Request, UploadFile
from slowapi import Limiter
from slowapi.util import get_remote_address

import config

# One shared limiter instance; main attaches it to app.state and registers the
# RateLimitExceeded handler. Routers reference it via @limiter.limit(...).
limiter = Limiter(key_func=get_remote_address)


# ── Admin session tokens (server-side login) ─────────────────────────────────
# Stateless HMAC token: "<expiry_epoch>.<hex_sig>" signed with config.AUTH_SECRET.
# No new dependencies — stdlib hmac/hashlib only.

def create_token() -> tuple[str, int]:
    """Issue a signed token valid for config.AUTH_TOKEN_TTL seconds."""
    exp = int(time.time()) + config.AUTH_TOKEN_TTL
    sig = hmac.new(config.AUTH_SECRET.encode(), str(exp).encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}", config.AUTH_TOKEN_TTL


def verify_token(token: str) -> bool:
    """True if the token's signature is valid and it has not expired."""
    try:
        exp_str, sig = token.split(".", 1)
        exp = int(exp_str)
    except (ValueError, AttributeError):
        return False
    if exp < time.time():
        return False
    expected = hmac.new(config.AUTH_SECRET.encode(), exp_str.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


async def verify_api_key(request: Request) -> None:
    """FastAPI dependency. Reads config.API_KEY live so tests (and runtime
    re-config) can toggle auth without re-importing. Empty key = auth disabled.

    Accepts either a valid admin session token (Authorization: Bearer <token>)
    or the static service key (X-API-Key, used by the sync worker)."""
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and verify_token(auth[7:]):
        return
    key_required = config.API_KEY
    if not key_required:
        return
    key = request.headers.get("X-API-Key", "")
    if not hmac.compare_digest(key.encode(), key_required.encode()):
        raise HTTPException(401, "Invalid or missing API key")


# ── Camera source validation (SSRF guard) ────────────────────────────────────
_YOUTUBE_HOSTS = {"www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"}


def validate_camera_source(source: str, type_: str) -> None:
    if type_ == "usb":
        try:
            idx = int(source)
            if idx < 0:
                raise ValueError
        except (ValueError, TypeError):
            raise HTTPException(400, "USB source must be a non-negative integer device index")
    elif type_ == "rtsp":
        p = urlparse(source)
        if p.scheme not in ("rtsp", "rtsps"):
            raise HTTPException(400, "RTSP source must use rtsp:// or rtsps:// scheme")
        if not p.hostname:
            raise HTTPException(400, "RTSP source must include a hostname")
    elif type_ == "youtube":
        p = urlparse(source)
        if p.hostname not in _YOUTUBE_HOSTS:
            raise HTTPException(400, "YouTube source must be a youtube.com or youtu.be URL")


# ── Image helpers ─────────────────────────────────────────────────────────────
def read_image_from_bytes(filename: str, content: bytes) -> np.ndarray:
    allowed = (".jpg", ".jpeg", ".png", ".bmp")
    if not filename.lower().endswith(allowed):
        raise HTTPException(400, "Unsupported image format. Use JPG or PNG.")
    frame = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(400, "Could not decode image")
    return frame


async def read_image(file: UploadFile) -> np.ndarray:
    content = await file.read()
    return read_image_from_bytes(file.filename, content)


def frame_to_b64(frame: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return base64.b64encode(buf).decode("utf-8")
