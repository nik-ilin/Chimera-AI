"""
LangFlow REST client  (CONVENTIONS.md §4 — LangFlow as visual orchestration layer)

FastAPI calls LangFlow's exported chain REST endpoints. If LangFlow is
unreachable, each method falls back to calling Granite directly through the
task executor and logs which path was used.

Chain endpoint URL pattern:
  {LANGFLOW_BASE_URL}/api/v1/run/{flow_id}?stream=false

Flow IDs are stored per-task in config (LANGFLOW_FLOW_IDS env var) or defaults.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── Default flow IDs (overridden by LANGFLOW_FLOW_IDS env var if set) ─────────
# These are populated after you import the chain JSONs into LangFlow and copy
# the flow IDs shown in the URL.  Format: "task_name:flow_uuid,..."
_DEFAULT_FLOW_IDS: dict[str, str] = {
    "classify_creator":  "",
    "write_captions":    "",
    "write_lyrics":      "",
    "build_image_brief": "",
}


def _get_flow_ids() -> dict[str, str]:
    """Parse LANGFLOW_FLOW_IDS from settings, fall back to defaults."""
    raw = getattr(settings, "langflow_flow_ids", "")
    if not raw:
        return dict(_DEFAULT_FLOW_IDS)
    result = dict(_DEFAULT_FLOW_IDS)
    for entry in raw.split(","):
        if ":" in entry:
            task, fid = entry.split(":", 1)
            result[task.strip()] = fid.strip()
    return result


class LangFlowClient:
    """
    Thin async proxy to LangFlow's REST API.

    - If a flow_id is configured and LangFlow is reachable → use LangFlow.
    - Otherwise → returns None, signalling the caller to fall back to direct Granite.
    """

    def __init__(self) -> None:
        self._flow_ids = _get_flow_ids()
        self._headers = {
            "Content-Type": "application/json",
            **({"x-api-key": settings.langflow_api_key} if settings.langflow_api_key else {}),
        }

    async def run(
        self,
        task_name: str,
        input_value: str,
        tweaks: dict[str, Any] | None = None,
    ) -> str | None:
        """
        Call the LangFlow REST endpoint for task_name.
        Returns the model output string, or None if LangFlow is unavailable/unconfigured.
        """
        flow_id = self._flow_ids.get(task_name, "")
        if not flow_id:
            logger.info(
                "langflow_no_flow_id",
                extra={"task": task_name, "path": "direct_granite"},
            )
            return None

        url = f"{settings.langflow_base_url}/api/v1/run/{flow_id}?stream=false"
        payload: dict[str, Any] = {"input_value": input_value, "input_type": "text"}
        if tweaks:
            payload["tweaks"] = tweaks

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(url, json=payload, headers=self._headers)
                resp.raise_for_status()
                data = resp.json()
                # LangFlow v1 response shape: outputs[0].outputs[0].results.message.text
                text = (
                    data.get("outputs", [{}])[0]
                    .get("outputs", [{}])[0]
                    .get("results", {})
                    .get("message", {})
                    .get("text", "")
                )
                logger.info(
                    "langflow_call_success",
                    extra={"task": task_name, "path": "langflow"},
                )
                return text or None
        except Exception as exc:
            logger.warning(
                "langflow_unavailable",
                extra={"task": task_name, "error": str(exc), "path": "direct_granite"},
            )
            return None


_client: LangFlowClient | None = None


def get_langflow_client() -> LangFlowClient:
    global _client
    if _client is None:
        _client = LangFlowClient()
    return _client
