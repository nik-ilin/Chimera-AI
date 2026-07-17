"""
GET /api/health

Always public (no service-token required) — monitoring systems and deployment
platforms use this to verify the service is alive.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from config import settings

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str
    env: str


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="0.1.0",
        env=settings.app_env,
    )
