"""
Bench script: test candidate instruct models for captions + ghostwrite (lyrics).

Runs N consecutive generations of each task against each candidate model,
validates the response against the production Pydantic schema, and reports:
  - model id
  - task success rate (no repair needed = clean first-pass JSON)
  - average + p95 latency per task

Does NOT start the FastAPI server.  Reads credentials from .env via pydantic-settings.

Usage (from backend/):
    PYTHONPATH=. ./venv/bin/python3 tests/bench_instruct_models.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import time

os.environ.setdefault("CHIMERA_SERVICE_TOKEN", "bench-test")
os.environ.setdefault("APP_ENV", "development")

MODELS = [
    "ibm/granite-3-8b-instruct",
    "meta-llama/llama-3-3-70b-instruct",
]
N_RUNS = 8  # consecutive generations per task per model


# ── Minimal inline result tracker ─────────────────────────────────────────────

PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m~\033[0m"


class Run:
    def __init__(self) -> None:
        self.success = 0
        self.repair = 0
        self.fail = 0
        self.latencies: list[float] = []

    def record(self, ok: bool, repaired: bool, latency: float) -> None:
        self.latencies.append(latency)
        if ok and not repaired:
            self.success += 1
        elif ok and repaired:
            self.repair += 1
        else:
            self.fail += 1

    @property
    def total(self) -> int:
        return self.success + self.repair + self.fail

    def avg_ms(self) -> float:
        return (sum(self.latencies) / len(self.latencies) * 1000) if self.latencies else 0.0

    def p95_ms(self) -> float:
        if not self.latencies:
            return 0.0
        s = sorted(self.latencies)
        idx = max(0, int(len(s) * 0.95) - 1)
        return s[idx] * 1000

    def mark(self) -> str:
        if self.fail == 0 and self.repair == 0:
            return PASS
        if self.fail == 0:
            return WARN
        return FAIL

    def summary(self) -> str:
        return (
            f"{self.mark()}  clean={self.success}/{self.total}  "
            f"repaired={self.repair}  failed={self.fail}  "
            f"avg={self.avg_ms():.0f}ms  p95={self.p95_ms():.0f}ms"
        )


# ── Patch config to inject model_id per benchmark loop ────────────────────────

async def bench_model(model_id: str) -> dict[str, Run]:
    """
    Run N_RUNS captions + N_RUNS lyrics generations for model_id.
    Returns a dict of task_name → Run.
    """
    # Monkey-patch settings so GraniteLLMService picks up this model.
    from config import settings
    object.__setattr__(settings, "granite_model_id", model_id)

    # Force a fresh LLM service singleton for this model.
    import services.llm as llm_mod
    llm_mod._instance = None
    svc = llm_mod.get_llm_service()

    # Pre-warm clients for this model (reproduces production startup path).
    t_warm = time.perf_counter()
    await svc.prewarm()
    warm_s = time.perf_counter() - t_warm
    print(f"    prewarm: {warm_s:.2f}s")

    from models.creator_context import CreatorContext
    from services.output_schemas import WriteCaptionsOutput, WriteLyricsOutput
    from services.task_executor import TaskExecutor
    from services.task_params import TASK_PARAMS
    from langchain_core.messages import HumanMessage
    from services.prompts import build_captions_prompt, build_lyrics_prompt
    from services.task_executor import _try_parse
    from pydantic import ValidationError

    executor = TaskExecutor()  # fresh instance — not the module singleton
    ctx = CreatorContext(
        artist_name="Nova Veil",
        genre="dark pop",
        city="Berlin",
        brand_vibe="cinematic, introspective, night-drive energy",
    )

    runs: dict[str, Run] = {
        "write_captions": Run(),
        "write_lyrics": Run(),
    }

    # ── captions ───────────────────────────────────────────────────────────────
    print(f"    captions ({N_RUNS} runs):")
    for i in range(N_RUNS):
        prompt = build_captions_prompt(
            ctx,
            f"New single 'Neon Rain #{i+1}' — dark pop, Berlin vibes, out Friday.",
            "instagram",
            n_variants=3,
        )
        params = TASK_PARAMS["write_captions"]
        t0 = time.perf_counter()
        raw = await svc.generate("write_captions", [HumanMessage(content=prompt)], params)
        latency = time.perf_counter() - t0
        parsed = _try_parse(raw)
        repaired = False
        ok = False
        if parsed is not None:
            try:
                WriteCaptionsOutput.model_validate(parsed)
                ok = True
            except ValidationError as e:
                # Repair attempt
                from services.task_executor import _REPAIR_INSTRUCTION
                rp = prompt + _REPAIR_INSTRUCTION.format(error=str(e))
                t1 = time.perf_counter()
                raw2 = await svc.generate("write_captions", [HumanMessage(content=rp)], params)
                latency += time.perf_counter() - t1
                p2 = _try_parse(raw2)
                if p2 is not None:
                    try:
                        WriteCaptionsOutput.model_validate(p2)
                        ok = True
                        repaired = True
                    except ValidationError:
                        pass
        elif raw.strip():
            # Not valid JSON at all — try repair
            from services.task_executor import _REPAIR_INSTRUCTION
            err_detail = f"Response was not valid JSON. Raw: {raw[:200]}"
            rp = prompt + _REPAIR_INSTRUCTION.format(error=err_detail)
            t1 = time.perf_counter()
            raw2 = await svc.generate("write_captions", [HumanMessage(content=rp)], params)
            latency += time.perf_counter() - t1
            p2 = _try_parse(raw2)
            if p2 is not None:
                try:
                    WriteCaptionsOutput.model_validate(p2)
                    ok = True
                    repaired = True
                except ValidationError:
                    pass

        mark = PASS if (ok and not repaired) else (WARN if (ok and repaired) else FAIL)
        runs["write_captions"].record(ok, repaired, latency)
        print(f"      [{i+1:02d}] {mark}  {latency*1000:.0f}ms" + ("  (repaired)" if repaired else "") + ("  FAIL" if not ok else ""))

    # ── lyrics (ghostwrite) ────────────────────────────────────────────────────
    print(f"    ghostwrite/lyrics ({N_RUNS} runs):")
    for i in range(N_RUNS):
        prompt = build_lyrics_prompt(
            ctx,
            user_message=f"Write a verse about chasing light in a dark city, run {i+1}.",
            genre="dark pop",
            theme="chasing light",
            rhyme_scheme="ABAB",
            target_section="verse",
        )
        params = TASK_PARAMS["write_lyrics"]
        t0 = time.perf_counter()
        raw = await svc.generate("write_lyrics", [HumanMessage(content=prompt)], params)
        latency = time.perf_counter() - t0
        parsed = _try_parse(raw)
        repaired = False
        ok = False
        if parsed is not None:
            try:
                WriteLyricsOutput.model_validate(parsed)
                ok = True
            except ValidationError as e:
                from services.task_executor import _REPAIR_INSTRUCTION
                rp = prompt + _REPAIR_INSTRUCTION.format(error=str(e))
                t1 = time.perf_counter()
                raw2 = await svc.generate("write_lyrics", [HumanMessage(content=rp)], params)
                latency += time.perf_counter() - t1
                p2 = _try_parse(raw2)
                if p2 is not None:
                    try:
                        WriteLyricsOutput.model_validate(p2)
                        ok = True
                        repaired = True
                    except ValidationError:
                        pass
        elif raw.strip():
            from services.task_executor import _REPAIR_INSTRUCTION
            err_detail = f"Response was not valid JSON. Raw: {raw[:200]}"
            rp = prompt + _REPAIR_INSTRUCTION.format(error=err_detail)
            t1 = time.perf_counter()
            raw2 = await svc.generate("write_lyrics", [HumanMessage(content=rp)], params)
            latency += time.perf_counter() - t1
            p2 = _try_parse(raw2)
            if p2 is not None:
                try:
                    WriteLyricsOutput.model_validate(p2)
                    ok = True
                    repaired = True
                except ValidationError:
                    pass

        mark = PASS if (ok and not repaired) else (WARN if (ok and repaired) else FAIL)
        runs["write_lyrics"].record(ok, repaired, latency)
        print(f"      [{i+1:02d}] {mark}  {latency*1000:.0f}ms" + ("  (repaired)" if repaired else "") + ("  FAIL" if not ok else ""))

    return runs


async def main() -> None:
    all_results: dict[str, dict[str, Run]] = {}

    for model_id in MODELS:
        print(f"\n{'='*64}")
        print(f"  MODEL: {model_id}")
        print(f"{'='*64}")
        runs = await bench_model(model_id)
        all_results[model_id] = runs

    # ── Final report ────────────────────────────────────────────────────────────
    print(f"\n{'='*64}")
    print("  BENCHMARK SUMMARY")
    print(f"{'='*64}")
    winner_model = None
    winner_score = -1

    for model_id, tasks in all_results.items():
        print(f"\n  {model_id}")
        score = 0
        for task, run in tasks.items():
            print(f"    {task:25s}  {run.summary()}")
            # Score: clean firsts count for 2, repaired count for 1
            score += run.success * 2 + run.repair
        print(f"    composite score: {score}")
        if score > winner_score:
            winner_score = score
            winner_model = model_id

    print(f"\n  RECOMMENDED MODEL: {winner_model}  (score {winner_score})")
    print(f"{'='*64}\n")
    return winner_model


if __name__ == "__main__":
    result = asyncio.run(main())
    sys.exit(0)
