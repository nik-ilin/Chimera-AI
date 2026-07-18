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
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from config import settings
from limiter import limiter

# ─── Structured logger ───────────────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from services.llm import get_llm_service
    # Eagerly initialise the LLM service so misconfiguration fails at startup.
    try:
        svc = get_llm_service()
        logger.info("llm_ready", provider=svc.provider_name)
    except RuntimeError as exc:
        logger.error("llm_init_failed", error=str(exc))
        raise
    logger.info("chimera_backend_startup", env=settings.app_env)
    yield
    logger.info("chimera_backend_shutdown")


app = FastAPI(
    title="Chimera AI Service",
    version="0.2.0",
    description="Internal AI microservice for the Chimera platform.",
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
from routes.health import router as health_router
from routes.classify import router as classify_router
from routes.captions import router as captions_router
from routes.ghostwrite import router as ghostwrite_router
from routes.visual_brief import router as visual_brief_router

app.include_router(health_router, prefix="/api")
app.include_router(classify_router, prefix="/api")
app.include_router(captions_router, prefix="/api")
app.include_router(ghostwrite_router, prefix="/api")
app.include_router(visual_brief_router, prefix="/api")
