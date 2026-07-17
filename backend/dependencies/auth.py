"""
Security dependencies — applied to every route.

CONVENTIONS.md §1:
- FastAPI is server-to-server ONLY.
- Every route requires Authorization: Bearer <CHIMERA_SERVICE_TOKEN>.
- Unauthenticated requests receive 401.
"""
import secrets

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings

bearer_scheme = HTTPBearer(auto_error=False)


def verify_service_token(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> None:
    """
    Dependency that rejects any request without the shared internal token.
    Uses secrets.compare_digest to prevent timing attacks.
    """
    if credentials is None or not secrets.compare_digest(
        credentials.credentials, settings.chimera_service_token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing service token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
