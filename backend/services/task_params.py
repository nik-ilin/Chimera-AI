"""
Per-task model parameters.  (CONVENTIONS.md §4 — Task registry)

Each task carries its own temperature and max_tokens.
These values are consumed by the LLM abstraction layer.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class TaskParams:
    temperature: float
    max_tokens: int


# ─── Canonical per-task parameters ────────────────────────────────────────────
# Keep in sync with CONVENTIONS.md §4 task table.

TASK_PARAMS: dict[str, TaskParams] = {
    "classify_creator":  TaskParams(temperature=0.2, max_tokens=256),
    "write_captions":    TaskParams(temperature=0.8, max_tokens=512),
    "write_lyrics":      TaskParams(temperature=0.8, max_tokens=2048),
    "build_image_brief": TaskParams(temperature=0.4, max_tokens=512),
    "draft_outreach_dm": TaskParams(temperature=0.7, max_tokens=512),
    "rank_concerts":     TaskParams(temperature=0.2, max_tokens=1024),
}
