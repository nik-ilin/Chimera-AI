"""
Phase 2 validation — pure async unit tests.
Tests the AI layer directly (no HTTP server needed).

Run:
  cd backend
  CHIMERA_SERVICE_TOKEN=test123 APP_ENV=development PYTHONPATH=. \\
      ./venv/bin/python3 tests/test_phase2.py
"""
from __future__ import annotations
import asyncio
import os
import sys

os.environ.setdefault("CHIMERA_SERVICE_TOKEN", "test123")
os.environ.setdefault("APP_ENV", "development")

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
results: list[bool] = []

SAMPLE_CONTEXT_DICT = {
    "artist_name": "Nova Veil",
    "genre": "dark pop",
    "city": "Berlin",
    "brand_vibe": "cinematic, introspective, night-drive energy",
    "instagram_handle": "@novaveil",
    "tiktok_handle": "@novaveil",
    "recent_outputs": [],
}


def check(label: str, cond: bool, detail: str = "") -> None:
    mark = PASS if cond else FAIL
    print(f"  {mark}  {label}" + (f"  [{detail}]" if detail else ""))
    results.append(cond)


async def run() -> None:
    # ─── Imports (after env is set) ────────────────────────────────────────────
    from models.creator_context import CreatorContext
    from services.llm import get_llm_service
    from services.output_schemas import (
        ClassifyCreatorOutput,
        WriteCaptionsOutput,
        WriteLyricsOutput,
        BuildImageBriefOutput,
    )
    from services.task_executor import get_executor
    from services.task_params import TASK_PARAMS
    from dependencies.auth import verify_service_token
    from fastapi.security import HTTPAuthorizationCredentials
    from fastapi import HTTPException

    ctx = CreatorContext(**SAMPLE_CONTEXT_DICT)

    # ── LLM abstraction ─────────────────────────────────────────────────────────
    print("\n[llm abstraction]")
    from config import settings as cfg
    svc = get_llm_service()
    has_creds = bool(cfg.watsonx_api_key and cfg.watsonx_project_id)
    if has_creds:
        check(
            "GraniteLLMService active (watsonx creds present)",
            svc.provider_name.startswith("granite/"),
            svc.provider_name,
        )
    else:
        check(
            "FakeLLMService active (no watsonx creds)",
            svc.provider_name == "fake/stub",
            svc.provider_name,
        )
    check("singleton — same instance returned twice", svc is get_llm_service())

    # ── Task params ─────────────────────────────────────────────────────────────
    print("\n[task params]")
    for task, (expected_temp, max_tok) in [
        ("classify_creator",  (0.2, 256)),
        ("write_captions",    (0.8, 512)),
        ("write_lyrics",      (0.8, 2048)),
        ("build_image_brief", (0.4, 512)),
    ]:
        p = TASK_PARAMS[task]
        check(f"{task}: temp={p.temperature}, max_tokens={p.max_tokens}",
              p.temperature == expected_temp and p.max_tokens == max_tok)

    # ── Auth guard (unit) ───────────────────────────────────────────────────────
    print("\n[auth guard — unit]")
    from config import settings as cfg
    import secrets
    good = HTTPAuthorizationCredentials(scheme="Bearer", credentials=cfg.chimera_service_token)
    bad  = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrongtoken")

    # Good token must not raise
    try:
        verify_service_token(good)
        check("correct token accepted", True)
    except HTTPException:
        check("correct token accepted", False, "raised HTTPException")

    # Bad token must raise 401
    try:
        verify_service_token(bad)
        check("wrong token rejected → 401", False, "did not raise")
    except HTTPException as e:
        check("wrong token rejected → 401", e.status_code == 401, str(e.status_code))

    # No token (None) must raise 401
    try:
        verify_service_token(None)  # type: ignore
        check("no token rejected → 401", False, "did not raise")
    except HTTPException as e:
        check("no token rejected → 401", e.status_code == 401, str(e.status_code))

    # ── classify_creator ────────────────────────────────────────────────────────
    print("\n[classify_creator]")
    executor = get_executor()
    result = await executor.classify_creator(ctx, "I'm a singer-songwriter making dreamy lo-fi music.")
    check("returns ClassifyCreatorOutput", isinstance(result, ClassifyCreatorOutput), type(result).__name__)
    check(f"creator_type == musician", result.creator_type == "musician", result.creator_type)
    check(f"confidence in [0,1]", 0.0 <= result.confidence <= 1.0, str(result.confidence))
    check("reasoning non-empty", bool(result.reasoning))
    print(f"     → {result.model_dump()}")

    # ── write_captions ──────────────────────────────────────────────────────────
    print("\n[write_captions]")
    result_caps = await executor.write_captions_concurrent(
        ctx,
        context="New single 'Neon Rain' out Friday — dark pop vibes, filmed in Berlin.",
        platform="instagram",
        n_variants=3,
    )
    check("returns WriteCaptionsOutput", isinstance(result_caps, WriteCaptionsOutput))
    check("3 variants returned", len(result_caps.variants) == 3, str(len(result_caps.variants)))
    check("each variant has text+char_count+hashtags",
          all(v.text and v.char_count >= 0 and isinstance(v.hashtags, list)
              for v in result_caps.variants))
    for i, v in enumerate(result_caps.variants):
        print(f"     variant {i+1}: {v.text[:60]}... | {v.char_count} chars | {v.hashtags[:2]}")

    # ── write_lyrics ────────────────────────────────────────────────────────────
    print("\n[write_lyrics]")
    result_lyrics = await executor.write_lyrics(
        ctx,
        user_message="Write a verse about chasing light in a dark city.",
        genre="dark pop",
        theme="chasing light",
        rhyme_scheme="ABAB",
        target_section="verse",
    )
    check("returns WriteLyricsOutput", isinstance(result_lyrics, WriteLyricsOutput))
    check("at least 1 section", len(result_lyrics.sections) >= 1)
    check("assistant_message present", bool(result_lyrics.assistant_message))
    section = result_lyrics.sections[0]
    check("section has lines", len(section.lines) >= 1)
    check("each line has rhyme_label+syllable_count",
          all(l.rhyme_label and l.syllable_count >= 0 for l in section.lines))
    for line in section.lines[:2]:
        print(f"     [{line.rhyme_label}] ({line.syllable_count}s) {line.text}")

    # ── build_image_brief ───────────────────────────────────────────────────────
    print("\n[build_image_brief]")
    result_brief = await executor.build_image_brief(
        ctx,
        user_brief="Dark, moody album cover. Lone figure in neon rain. Berlin underground.",
        variant="album_cover",
    )
    check("returns BuildImageBriefOutput", isinstance(result_brief, BuildImageBriefOutput))
    check("sd_prompt non-empty", bool(result_brief.sd_prompt))
    check("style_tokens list", isinstance(result_brief.style_tokens, list))
    print(f"     → sd_prompt: {result_brief.sd_prompt[:100]}...")
    print(f"     → style_tokens: {result_brief.style_tokens}")

    # ── LangFlow fallback path (no flow_id = direct Granite) ──────────────────
    print("\n[langflow fallback]")
    from services.langflow_client import get_langflow_client
    client = get_langflow_client()
    result_lf = await client.run("classify_creator", "test input")
    check("no flow_id configured → returns None (direct Granite path)", result_lf is None)

    # ── Summary ─────────────────────────────────────────────────────────────────
    passed = sum(results)
    total = len(results)
    print(f"\n{'='*52}")
    print(f"  {passed}/{total} checks passed")
    if passed < total:
        print("  FAILED — fix before proceeding.")
        sys.exit(1)
    else:
        print("  ALL PHASE 2 CHECKS PASSED ✓")


if __name__ == "__main__":
    asyncio.run(run())
