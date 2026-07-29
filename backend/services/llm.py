"""
LLM Abstraction Layer  (CONVENTIONS.md §3 — One LLM abstraction)

Single interface wrapping ChatWatsonx (IBM Granite) as the DEFAULT provider.
A swappable FakeLLM fallback sits behind the same interface for dev/test when
watsonx credentials are absent.

Usage
-----
    from services.llm import get_llm_service

    svc = get_llm_service()
    result = await svc.generate(
        task_name="write_captions",
        messages=[SystemMessage(...), HumanMessage(...)],
        params=TaskParams(temperature=0.8, max_tokens=512),
    )
"""
from __future__ import annotations

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import BaseMessage

from config import settings
from services.task_params import TASK_PARAMS, TaskParams

logger = logging.getLogger(__name__)


# ─── Abstract interface ────────────────────────────────────────────────────────

class LLMService(ABC):
    """Single interface for all LLM calls in Chimera."""

    @abstractmethod
    async def generate(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> str:
        """
        Call the model and return the raw text response.
        The caller is responsible for parsing/validating the JSON.
        """
        ...

    @abstractmethod
    def generate_stream(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> AsyncIterator[str]:
        """
        Stream the model response as text deltas, in order, as they arrive.
        The caller accumulates the full text and parses/validates it at the end.
        """
        ...

    async def prewarm(self) -> None:
        """
        Pre-build any expensive per-provider client state so the first real
        request doesn't pay for it. Called once at startup. Default: no-op.
        """
        return None

    @property
    @abstractmethod
    def provider_name(self) -> str: ...


# ─── IBM Granite (watsonx.ai) ─────────────────────────────────────────────────

class GraniteLLMService(LLMService):
    """
    Wraps langchain-ibm ChatWatsonx.
    Initialised lazily on first call so the import doesn't hang when
    credentials are missing (ibm_watsonx_ai probes the network on import).
    """

    def __init__(self) -> None:
        # Cache ChatWatsonx clients keyed by their generation params, so the
        # expensive IAM/init handshake runs ONCE per distinct config instead of
        # on every request. A lock serialises concurrent first-builds.
        self._clients: dict[tuple[float, int], Any] = {}
        self._lock = asyncio.Lock()

    def _build_client(self, params: TaskParams) -> Any:
        """
        Construct a ChatWatsonx instance for the given task params.

        BLOCKING: the constructor performs the IAM/token handshake, so this must
        only ever be called via asyncio.to_thread — never directly on the loop.
        """
        # Deferred import — avoids network probe at module load time.
        from langchain_ibm import ChatWatsonx  # noqa: PLC0415

        return ChatWatsonx(
            model_id=settings.granite_model_id,
            url=settings.watsonx_url,
            apikey=settings.watsonx_api_key,
            project_id=settings.watsonx_project_id,
            # Skip the get_model_specs() validation call at construction — it
            # adds ~100s to time-to-first-token (and previously masked config
            # errors as a long retry). The model id is trusted from config;
            # a bad id surfaces immediately on the first inference call instead.
            validate_model=False,
            params={
                "temperature": params.temperature,
                "max_new_tokens": params.max_tokens,
                "decoding_method": "greedy" if params.temperature < 0.3 else "sample",
                "repetition_penalty": 1.1,
            },
        )

    async def _get_client(self, params: TaskParams) -> Any:
        """
        Return a cached ChatWatsonx client for these params, building it once
        (off the event loop, in a worker thread) on first use. decoding_method
        is derived from temperature, so (temperature, max_tokens) is a
        sufficient cache key.
        """
        key = (params.temperature, params.max_tokens)
        client = self._clients.get(key)
        if client is not None:
            return client
        async with self._lock:
            # Re-check inside the lock: another coroutine may have built it
            # while we were awaiting the lock.
            client = self._clients.get(key)
            if client is None:
                client = await asyncio.to_thread(self._build_client, params)
                self._clients[key] = client
            return client

    async def prewarm(self) -> None:
        """
        Build a client for every distinct task param set at startup.

        The client cache is keyed by (temperature, max_tokens), so a client warmed
        by one task cannot serve another — classify's (0.2, 256) client does NOT
        cover captions (0.8, 512) or lyrics (0.8, 2048). Without this, the first
        request for each param set pays the build cost on its critical path; the
        very first build in the process also pays the IAM handshake (~3s measured),
        which dominated time-to-first-token.
        """
        for params in dict.fromkeys(TASK_PARAMS.values()):
            try:
                await self._get_client(params)
            except Exception as exc:  # noqa: BLE001 — warming is best-effort
                # Never block startup on a warm failure: the request path builds
                # (and reports) lazily exactly as before.
                logger.warning(
                    "llm_prewarm_failed",
                    extra={
                        "temperature": params.temperature,
                        "max_tokens": params.max_tokens,
                        "error": str(exc),
                    },
                )

    async def generate(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> str:
        client = await self._get_client(params)
        if settings.log_level == "DEBUG":
            logger.debug(
                "llm_call",
                extra={
                    "task": task_name,
                    "provider": self.provider_name,
                    "messages": [m.content for m in messages],
                },
            )
        # Run the BLOCKING inference in a worker thread so the event loop stays
        # free (a second request isn't blocked) and an asyncio.wait_for timeout
        # around this call can actually fire if watsonx is slow.
        response = await asyncio.to_thread(client.invoke, messages)
        text = response.content if hasattr(response, "content") else str(response)
        if settings.log_level == "DEBUG":
            logger.debug("llm_response", extra={"task": task_name, "response": text})
        return text

    async def generate_stream(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> AsyncIterator[str]:
        """
        Stream text deltas from watsonx. The langchain-ibm sync `.stream()` is
        run in a worker thread and its chunks are bridged to the event loop via
        an asyncio.Queue, so the loop is never blocked while tokens arrive.
        """
        client = await self._get_client(params)
        queue: asyncio.Queue[Any] = asyncio.Queue()
        loop = asyncio.get_running_loop()
        done = object()

        def produce() -> None:
            try:
                for chunk in client.stream(messages):
                    text = chunk.content if hasattr(chunk, "content") else str(chunk)
                    if text:
                        loop.call_soon_threadsafe(queue.put_nowait, text)
            except Exception as exc:  # surface to the consumer
                loop.call_soon_threadsafe(queue.put_nowait, exc)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, done)

        producer = loop.run_in_executor(None, produce)
        try:
            while True:
                item = await queue.get()
                if item is done:
                    break
                if isinstance(item, BaseException):
                    raise item
                yield item
        finally:
            await producer

    @property
    def provider_name(self) -> str:
        return f"granite/{settings.granite_model_id}"


# ─── Fallback (dev-only) ──────────────────────────────────────────────────────

class FakeLLMService(LLMService):
    """
    Returns deterministic JSON stubs.
    Active ONLY when watsonx credentials are absent AND app_env == 'development'.
    NEVER used in production — get_llm_service() raises if production + no creds.
    """

    _STUBS: dict[str, str] = {
        "classify_creator": json.dumps({
            "creator_type": "musician",
            "confidence": 0.97,
            "reasoning": "[STUB] User description matches musician profile.",
        }),
        "write_captions": json.dumps({
            "variants": [
                {
                    "text": "[STUB] Drop everything — new track out NOW 🎵",
                    "char_count": 42,
                    "hashtags": ["#newmusic", "#indie", "#release"],
                },
                {
                    "text": "[STUB] This one's been in my head for months. Finally.",
                    "char_count": 52,
                    "hashtags": ["#songwriter", "#authentic"],
                },
                {
                    "text": "[STUB] The collab you didn't know you needed 👀",
                    "char_count": 46,
                    "hashtags": ["#collab", "#vibes"],
                },
            ]
        }),
        "write_lyrics": json.dumps({
            "sections": [
                {
                    "type": "verse",
                    "lines": [
                        {"text": "[STUB] Walking through the city lights alone", "rhyme_label": "A", "syllable_count": 8},
                        {"text": "[STUB] Every corner holds a memory I've known", "rhyme_label": "A", "syllable_count": 9},
                        {"text": "[STUB] The rain comes down on rooftops made of steel", "rhyme_label": "B", "syllable_count": 9},
                        {"text": "[STUB] And I'm still trying to decide what's real", "rhyme_label": "B", "syllable_count": 9},
                    ],
                }
            ],
            "assistant_message": "[STUB] Here's a verse draft in your style. Continue or edit any line.",
        }),
        "build_image_brief": json.dumps({
            "sd_prompt": "[STUB] Cinematic album cover, neon-lit city at night, lone figure silhouetted, dark pop aesthetic, film grain, 4k",
            "style_tokens": ["cinematic", "neon", "dark pop", "moody", "high contrast"],
        }),
    }

    async def generate(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> str:
        stub = self._STUBS.get(task_name)
        if stub is None:
            raise ValueError(f"FakeLLMService has no stub for task '{task_name}'")
        logger.warning("llm_fake_stub_used", extra={"task": task_name})
        return stub

    async def generate_stream(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> AsyncIterator[str]:
        stub = self._STUBS.get(task_name)
        if stub is None:
            raise ValueError(f"FakeLLMService has no stub for task '{task_name}'")
        logger.warning("llm_fake_stub_used", extra={"task": task_name})
        # Emit the stub in small chunks so the streaming path is exercised in dev.
        for i in range(0, len(stub), 24):
            await asyncio.sleep(0.02)
            yield stub[i : i + 24]

    @property
    def provider_name(self) -> str:
        return "fake/stub"


# ─── Factory ──────────────────────────────────────────────────────────────────

_instance: LLMService | None = None


def get_llm_service() -> LLMService:
    """
    Returns the singleton LLMService for the process.

    - If watsonx credentials are present → GraniteLLMService.
    - If credentials absent + development → FakeLLMService (with a warning).
    - If credentials absent + production → raises RuntimeError (fail fast).
    """
    global _instance
    if _instance is not None:
        return _instance

    has_creds = bool(settings.watsonx_api_key and settings.watsonx_project_id)

    if has_creds:
        _instance = GraniteLLMService()
        logger.info("llm_provider_selected", extra={"provider": _instance.provider_name})
    elif settings.app_env == "development":
        logger.warning(
            "llm_fallback_active: watsonx credentials missing — using FakeLLMService stub. "
            "Set WATSONX_API_KEY and WATSONX_PROJECT_ID to use Granite."
        )
        _instance = FakeLLMService()
    else:
        raise RuntimeError(
            "WATSONX_API_KEY and WATSONX_PROJECT_ID must be set in production. "
            "The Granite LLM service cannot start without credentials."
        )

    return _instance
