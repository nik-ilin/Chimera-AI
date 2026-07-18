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

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

from langchain_core.messages import BaseMessage

from config import settings
from services.task_params import TaskParams

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
        self._client: Any = None

    def _get_client(self, params: TaskParams) -> Any:
        """Build a ChatWatsonx instance for the given task params."""
        # Deferred import — avoids network probe at module load time.
        from langchain_ibm import ChatWatsonx  # noqa: PLC0415

        return ChatWatsonx(
            model_id=settings.granite_model_id,
            url=settings.watsonx_url,
            apikey=settings.watsonx_api_key,
            project_id=settings.watsonx_project_id,
            params={
                "temperature": params.temperature,
                "max_new_tokens": params.max_tokens,
                "decoding_method": "greedy" if params.temperature < 0.3 else "sample",
                "repetition_penalty": 1.1,
            },
        )

    async def generate(
        self,
        task_name: str,
        messages: list[BaseMessage],
        params: TaskParams,
    ) -> str:
        client = self._get_client(params)
        if settings.log_level == "DEBUG":
            logger.debug(
                "llm_call",
                extra={
                    "task": task_name,
                    "provider": self.provider_name,
                    "messages": [m.content for m in messages],
                },
            )
        response = await client.ainvoke(messages)
        text = response.content if hasattr(response, "content") else str(response)
        if settings.log_level == "DEBUG":
            logger.debug("llm_response", extra={"task": task_name, "response": text})
        return text

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
