"""
Task executor  (CONVENTIONS.md §4 — Task registry + AI Orchestration Contract)

Responsibilities:
- Builds the prompt for a given task using the correct template
- Calls the LLM service with per-task params
- Parses and validates the JSON response against the task's output schema
- On parse failure: one automatic repair retry, then a clean ValidationError
- Runs N independent generations concurrently via asyncio.gather

Public API
----------
    executor = TaskExecutor()
    result = await executor.run("write_captions", payload)
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import ValidationError

from models.creator_context import CreatorContext
from models.opportunity import Opportunity, RankedOpportunity
from services.llm import get_llm_service
from services.output_schemas import (
    BuildImageBriefOutput,
    ClassifyCreatorOutput,
    DraftOutreachOutput,
    RankOpportunitiesOutput,
    WriteCaptionsOutput,
    WriteLyricsOutput,
)
from services.prompts import (
    build_captions_prompt,
    build_classify_prompt,
    build_image_brief_prompt,
    build_lyrics_prompt,
    build_outreach_prompt,
    build_rank_opportunities_prompt,
)
from services.task_params import TASK_PARAMS

logger = logging.getLogger(__name__)

# ─── Repair prompt appended on parse failure ──────────────────────────────────
_REPAIR_INSTRUCTION = (
    "\n\nYour previous response could not be parsed as valid JSON matching the "
    "required schema. Parse error: {error}\n"
    "Respond ONLY with corrected, schema-valid JSON. No prose. No fences."
)


class TaskExecutor:
    """
    Central AI task orchestrator.  One instance per application (singleton-safe).
    """

    # ── classify_creator ──────────────────────────────────────────────────────

    async def classify_creator(
        self,
        ctx: CreatorContext,
        user_description: str,
        request_id: str | None = None,
    ) -> ClassifyCreatorOutput:
        rid = request_id or str(uuid.uuid4())
        prompt = build_classify_prompt(ctx, user_description)
        raw = await self._call_with_retry(
            task_name="classify_creator",
            prompt=prompt,
            schema_cls=ClassifyCreatorOutput,
            request_id=rid,
        )
        return ClassifyCreatorOutput.model_validate(raw)

    # ── write_captions ────────────────────────────────────────────────────────

    async def write_captions(
        self,
        ctx: CreatorContext,
        context: str,
        platform: str,
        n_variants: int = 3,
        request_id: str | None = None,
    ) -> WriteCaptionsOutput:
        rid = request_id or str(uuid.uuid4())
        prompt = build_captions_prompt(ctx, context, platform, n_variants)
        raw = await self._call_with_retry(
            task_name="write_captions",
            prompt=prompt,
            schema_cls=WriteCaptionsOutput,
            request_id=rid,
        )
        return WriteCaptionsOutput.model_validate(raw)

    # ── write_lyrics ──────────────────────────────────────────────────────────

    async def write_lyrics(
        self,
        ctx: CreatorContext,
        user_message: str,
        genre: str,
        theme: str,
        rhyme_scheme: str,
        target_section: str,
        turn_history_summary: str = "",
        request_id: str | None = None,
    ) -> WriteLyricsOutput:
        rid = request_id or str(uuid.uuid4())
        prompt = build_lyrics_prompt(
            ctx, user_message, genre, theme, rhyme_scheme,
            target_section, turn_history_summary,
        )
        raw = await self._call_with_retry(
            task_name="write_lyrics",
            prompt=prompt,
            schema_cls=WriteLyricsOutput,
            request_id=rid,
        )
        return WriteLyricsOutput.model_validate(raw)

    # ── build_image_brief ─────────────────────────────────────────────────────

    async def build_image_brief(
        self,
        ctx: CreatorContext,
        user_brief: str,
        variant: str,
        request_id: str | None = None,
    ) -> BuildImageBriefOutput:
        rid = request_id or str(uuid.uuid4())
        prompt = build_image_brief_prompt(ctx, user_brief, variant)
        raw = await self._call_with_retry(
            task_name="build_image_brief",
            prompt=prompt,
            schema_cls=BuildImageBriefOutput,
            request_id=rid,
        )
        return BuildImageBriefOutput.model_validate(raw)

    # ── rank_opportunities (Phase 4 / Block B2) ──────────────────────────────

    async def rank_opportunities(
        self,
        ctx: CreatorContext,
        opportunities: list[Opportunity],
        career_level: str = "emerging",
        request_id: str | None = None,
    ) -> list[RankedOpportunity]:
        """
        Score each opportunity for fit and return them sorted best-first.

        Failure policy: ranking is an ENHANCEMENT, not the feature. If the model
        is unavailable or returns something unusable, the user should still get
        their list of venues — just unscored — rather than an error page. So a
        failure here degrades to score 0 with an explanatory reason instead of
        propagating.
        """
        rid = request_id or str(uuid.uuid4())
        if not opportunities:
            return []

        # Send only the fields the model needs to judge fit. Trimming keeps the
        # prompt inside the context window when a city returns many venues.
        payload = json.dumps(
            [
                {
                    "source_id": o.source_id,
                    "name": o.name,
                    "kind": o.kind,
                    "city": o.city,
                    "country": o.country,
                    "capacity": o.capacity,
                    "genres": o.genres,
                    "evidence": o.evidence,
                    "upcoming_events": o.upcoming_events,
                    "contact_hint": o.contact_hint,
                }
                for o in opportunities
            ],
            ensure_ascii=False,
        )

        prompt = build_rank_opportunities_prompt(ctx, payload, career_level)

        try:
            raw = await self._call_with_retry(
                task_name="rank_concerts",
                prompt=prompt,
                schema_cls=RankOpportunitiesOutput,
                request_id=rid,
            )
            parsed = RankOpportunitiesOutput.model_validate(raw)
            by_id = {r.source_id: r for r in parsed.rankings}
        except (ValueError, ValidationError) as exc:
            logger.warning(
                "rank_opportunities_failed_unranked_fallback",
                extra={"request_id": rid, "error": str(exc)},
            )
            by_id = {}

        ranked = [
            RankedOpportunity(
                **o.model_dump(),
                fit_score=by_id[o.source_id].fit_score if o.source_id in by_id else 0,
                fit_reason=(
                    by_id[o.source_id].fit_reason
                    if o.source_id in by_id
                    else "Not scored — ranking was unavailable for this result."
                ),
                suggested_channel=(
                    by_id[o.source_id].suggested_channel
                    if o.source_id in by_id
                    else o.contact_hint
                ),
            )
            for o in opportunities
        ]

        ranked.sort(key=lambda o: o.fit_score, reverse=True)
        return ranked

    # ── draft_outreach (Phase 4 / Block B2) ──────────────────────────────────

    async def draft_outreach(
        self,
        ctx: CreatorContext,
        opportunity: Opportunity,
        extra_notes: str = "",
        request_id: str | None = None,
    ) -> DraftOutreachOutput:
        """
        Draft a booking enquiry for the artist to review and send themselves.
        Chimera never transmits this message — see services/opportunities.py.
        """
        rid = request_id or str(uuid.uuid4())
        payload = json.dumps(opportunity.model_dump(), ensure_ascii=False)
        prompt = build_outreach_prompt(ctx, payload, extra_notes)

        raw = await self._call_with_retry(
            task_name="draft_outreach_dm",
            prompt=prompt,
            schema_cls=DraftOutreachOutput,
            request_id=rid,
        )
        return DraftOutreachOutput.model_validate(raw)

    # ── Concurrent captions (CONVENTIONS.md §4 — asyncio.gather) ─────────────

    async def write_captions_concurrent(
        self,
        ctx: CreatorContext,
        context: str,
        platform: str,
        n_variants: int = 3,
        request_id: str | None = None,
    ) -> WriteCaptionsOutput:
        """
        Fire N independent single-variant calls concurrently, then merge.
        Each call is bounded by the per-user rate limit applied at the route layer.
        Falls back to a single batched call if n_variants == 1.
        """
        if n_variants <= 1:
            return await self.write_captions(ctx, context, platform, 1, request_id)

        rid = request_id or str(uuid.uuid4())
        tasks = [
            self._call_single_caption(ctx, context, platform, idx, rid)
            for idx in range(n_variants)
        ]
        variants_list = await asyncio.gather(*tasks)
        # Take only the first variant from each call to maintain N total
        all_variants = [output.variants[0] for output in variants_list if output.variants]
        return WriteCaptionsOutput(variants=all_variants)

    async def _call_single_caption(
        self,
        ctx: CreatorContext,
        context: str,
        platform: str,
        idx: int,
        request_id: str,
    ) -> WriteCaptionsOutput:
        prompt = build_captions_prompt(ctx, context, platform, n_variants=1)
        raw = await self._call_with_retry(
            task_name="write_captions",
            prompt=prompt,
            schema_cls=WriteCaptionsOutput,
            request_id=f"{request_id}-{idx}",
        )
        return WriteCaptionsOutput.model_validate(raw)

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _call_with_retry(
        self,
        task_name: str,
        prompt: str,
        schema_cls: type,
        request_id: str,
    ) -> dict[str, Any]:
        """
        Calls the LLM, parses JSON, validates schema.
        On parse/validation failure: ONE repair retry, then raises.
        """
        llm = get_llm_service()
        params = TASK_PARAMS[task_name]
        messages = [HumanMessage(content=prompt)]

        logger.info(
            "task_start",
            extra={"task": task_name, "request_id": request_id, "provider": llm.provider_name},
        )

        # ── First attempt ──
        raw_text = await llm.generate(task_name, messages, params)
        parsed = _try_parse(raw_text)

        if parsed is not None:
            try:
                schema_cls.model_validate(parsed)
                logger.info("task_success", extra={"task": task_name, "request_id": request_id})
                return parsed
            except ValidationError as e:
                error_detail = str(e)
        else:
            error_detail = f"Response was not valid JSON. Raw: {raw_text[:200]}"

        # ── Repair retry ──
        logger.warning(
            "task_repair_retry",
            extra={"task": task_name, "request_id": request_id, "error": error_detail},
        )
        repair_prompt = prompt + _REPAIR_INSTRUCTION.format(error=error_detail)
        repair_messages = [HumanMessage(content=repair_prompt)]
        raw_text2 = await llm.generate(task_name, repair_messages, params)
        parsed2 = _try_parse(raw_text2)

        if parsed2 is None:
            raise ValueError(
                f"Task '{task_name}' failed after repair retry: "
                f"response is not valid JSON. Raw: {raw_text2[:300]}"
            )

        # Validate (let ValidationError propagate — caller gets a clean 422)
        schema_cls.model_validate(parsed2)
        logger.info("task_success_after_repair", extra={"task": task_name, "request_id": request_id})
        return parsed2

    # ── Streaming variant (CONVENTIONS.md §2 — token-by-token) ────────────────
    async def stream_task(
        self,
        task_name: str,
        prompt: str,
        schema_cls: type,
        request_id: str,
    ) -> AsyncIterator[tuple[str, Any]]:
        """
        Stream a task token-by-token.

        Yields:
            ("token", <text delta>)  for each chunk as the model generates, then
            ("result", <validated dict>)  once, at the end.

        The full text is accumulated and parsed after the stream. On parse or
        schema-validation failure it falls back to ONE non-streamed repair call
        (whose result is emitted as the final "result"); a second failure raises.
        """
        llm = get_llm_service()
        params = TASK_PARAMS[task_name]
        messages = [HumanMessage(content=prompt)]

        logger.info(
            "task_stream_start",
            extra={"task": task_name, "request_id": request_id, "provider": llm.provider_name},
        )

        full = ""
        async for delta in llm.generate_stream(task_name, messages, params):
            full += delta
            yield ("token", delta)

        parsed = _try_parse(full)
        error_detail = ""
        valid = False
        if parsed is not None:
            try:
                schema_cls.model_validate(parsed)
                valid = True
            except ValidationError as e:
                error_detail = str(e)
        else:
            error_detail = f"Response was not valid JSON. Raw: {full[:200]}"

        if not valid:
            logger.warning(
                "task_stream_repair",
                extra={"task": task_name, "request_id": request_id, "error": error_detail},
            )
            repair_prompt = prompt + _REPAIR_INSTRUCTION.format(error=error_detail)
            raw2 = await llm.generate(task_name, [HumanMessage(content=repair_prompt)], params)
            parsed = _try_parse(raw2)
            if parsed is None:
                raise ValueError(
                    f"Task '{task_name}' failed after repair retry: "
                    f"response is not valid JSON. Raw: {raw2[:300]}"
                )
            schema_cls.model_validate(parsed)  # let ValidationError propagate

        logger.info("task_stream_success", extra={"task": task_name, "request_id": request_id})
        yield ("result", parsed)


def _try_parse(text: str) -> dict[str, Any] | None:
    """
    Attempt to extract and parse a JSON object from a model response.
    Handles responses that wrap JSON in markdown fences or add leading prose.
    """
    text = text.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(
            line for line in lines
            if not line.startswith("```")
        ).strip()
    # Find first { and last }
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


# ── Module-level singleton ────────────────────────────────────────────────────
_executor: TaskExecutor | None = None


def get_executor() -> TaskExecutor:
    global _executor
    if _executor is None:
        _executor = TaskExecutor()
    return _executor
