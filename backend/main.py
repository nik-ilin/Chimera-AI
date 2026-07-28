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

    # Warm heavy lazy imports in the background so the first real request is
    # fast, WITHOUT blocking startup. supabase-py's dependency tree is large and
    # cold-importing it can take a long time on a slow disk (see
    # services/supabase.py) — do it off the startup path.
    import asyncio

    async def _warmup() -> None:
        try:
            from services.supabase import get_supabase

            await asyncio.to_thread(get_supabase)
            logger.info("warmup_supabase_ready")
        except Exception as exc:  # noqa: BLE001 — best-effort, never blocks
            logger.warning("warmup_supabase_failed", error=str(exc))

    asyncio.create_task(_warmup())

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
from routes.opportunities import router as opportunities_router
from routes.connections import router as connections_router
from routes.connections import public_router as connections_public_router
from routes.calendar import router as calendar_router

app.include_router(health_router, prefix="/api")
app.include_router(classify_router, prefix="/api")
app.include_router(captions_router, prefix="/api")
app.include_router(ghostwrite_router, prefix="/api")
app.include_router(visual_brief_router, prefix="/api")
app.include_router(opportunities_router, prefix="/api")
app.include_router(connections_router, prefix="/api")
app.include_router(calendar_router, prefix="/api")
# Browser-facing OAuth callback — deliberately NOT service-token guarded, since
# it is reached by a Google redirect. Authenticity comes from the signed state.
app.include_router(connections_public_router, prefix="/api")
