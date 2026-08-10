import hashlib
import hmac
import time

from fastapi import HTTPException, Request, status

from app.config.settings import get_settings


def _expected_signature(
    *,
    body: bytes,
    method: str,
    path: str,
    secret: str,
    timestamp: str,
) -> str:
    payload = b".".join(
        [
            timestamp.encode("utf-8"),
            method.upper().encode("utf-8"),
            path.encode("utf-8"),
            body,
        ]
    )

    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


async def require_hmac(request: Request) -> None:
    settings = get_settings()
    timestamp = request.headers.get("x-service-timestamp", "")
    signature = request.headers.get("x-service-signature", "")

    if not timestamp or not signature:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing service signature.",
        )

    try:
        request_time = int(timestamp)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service timestamp.",
        ) from exc

    if abs(int(time.time()) - request_time) > settings.HMAC_TIMESTAMP_TOLERANCE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Expired service signature.",
        )

    body = await request.body()
    expected = _expected_signature(
        body=body,
        method=request.method,
        path=request.url.path,
        secret=settings.HMAC_SECRET,
        timestamp=timestamp,
    )

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid service signature.",
        )
