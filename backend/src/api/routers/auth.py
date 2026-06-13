"""
Admin authentication
=====================
Server-side admin login. The password is validated here against the
``BERTH_ADMIN_PASSWORD`` env var and never shipped to the browser; a successful
login returns a short-lived signed token (see deps.create_token) that the
frontend sends as ``Authorization: Bearer <token>`` on subsequent requests.
"""

import hmac

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import config
from src.api.deps import create_token, limiter

router = APIRouter()


class _LoginBody(BaseModel):
    password: str


@router.post("/api/auth/login")
@limiter.limit("10/minute")
def login(request: Request, body: _LoginBody):
    if not config.ADMIN_PASSWORD:
        raise HTTPException(503, "Admin login is not configured")
    if not hmac.compare_digest(body.password.encode(), config.ADMIN_PASSWORD.encode()):
        raise HTTPException(401, "Incorrect password")
    token, expires_in = create_token()
    return {"token": token, "expires_in": expires_in}
