"""
Chimera FastAPI AI Microservice — entry point.

Security enforced here (CONVENTIONS.md §1, §3):
- Service-token auth on every route (via verify_service_token dependency).
- CORS locked to ALLOWED_ORIGINS only.
- Rate limiting via slowapi.
"""
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from config import settings
from routes.health import router as health_router

# ─── Structured logger ───────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()

# ─── Rate limiter (per IP; per-user limits applied in route deps) ─────────────
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("chimera_backend_startup", env=settings.app_env)
    yield
    logger.info("chimera_backend_shutdown")


app = FastAPI(
    title="Chimera AI Service",
    version="0.1.0",
    description="Internal AI microservice for the Chimera platform.",
    # Disable docs in production — no need to expose the API surface.
    docs_url="/docs" if settings.app_env == "development" else None,
    redoc_url=None,
    lifespan=lifespan,
)

# ─── CORS — locked to frontend origin only ───────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── Rate-limit error handler ─────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ─── Routers ─────────────────────────────────────────────────────────────────
app.include_router(health_router, prefix="/api")
