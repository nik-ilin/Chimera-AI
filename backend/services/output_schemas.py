"""
Pydantic v2 output schemas for every AI task.  (CONVENTIONS.md §4)

Each schema is the ONLY accepted shape of a model response.
FastAPI routes validate against these before returning to the client.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# ─── classify_creator ─────────────────────────────────────────────────────────

class ClassifyCreatorOutput(BaseModel):
    creator_type: Literal["musician", "influencer", "video_creator"]
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str = Field(max_length=500)


# ─── write_captions ───────────────────────────────────────────────────────────

class CaptionVariant(BaseModel):
    text: str = Field(max_length=2200)   # Instagram hard limit ~2200 chars
    char_count: int = Field(ge=0)
    hashtags: list[str] = Field(default_factory=list)


class WriteCaptionsOutput(BaseModel):
    variants: list[CaptionVariant] = Field(min_length=1, max_length=5)


# ─── write_lyrics ─────────────────────────────────────────────────────────────

class LyricLine(BaseModel):
    text: str
    rhyme_label: str = Field(max_length=4)   # e.g. "A", "B", "AA"
    syllable_count: int = Field(ge=0)


class LyricSection(BaseModel):
    type: Literal["verse", "chorus", "bridge", "outro", "intro", "hook"]
    lines: list[LyricLine]


class WriteLyricsOutput(BaseModel):
    sections: list[LyricSection] = Field(min_length=1)
    # Optional: a friendly note is non-essential and models (esp. code-tuned
    # Granite variants) frequently omit it. The lyric `sections` are the real
    # output, so a missing note must NOT fail the whole generation. The frontend
    # already renders an empty note as nothing.
    assistant_message: str = Field(
        default="",
        max_length=1000,
        description=(
            "A short assistant note about the generated lyrics. Optional: the "
            "prompt asks for it, but code-tuned models (e.g. granite-8b-code-"
            "instruct) routinely omit it. Requiring it made an otherwise-valid "
            "streamed generation fail validation and pay a full non-streamed "
            "repair retry, so it defaults to empty instead."
        ),
    )


# ─── build_image_brief ────────────────────────────────────────────────────────

class BuildImageBriefOutput(BaseModel):
    sd_prompt: str = Field(
        max_length=1500,
        description="Fully expanded Stable Diffusion prompt with style tokens.",
    )
    style_tokens: list[str] = Field(
        default_factory=list,
        description="Individual style descriptors extracted from the brief.",
    )


# ─── rank_concerts (opportunity fit ranking) ──────────────────────────────────

class OpportunityRanking(BaseModel):
    """One venue/promoter scored against the creator context."""

    source_id: str = Field(
        description="Echoes back the opportunity's source_id so we can rejoin."
    )
    fit_score: int = Field(ge=0, le=100)
    fit_reason: str = Field(
        max_length=400,
        description="Why this is or isn't a fit — grounded in the given evidence.",
    )
    suggested_channel: str = Field(default="", max_length=120)


class RankOpportunitiesOutput(BaseModel):
    rankings: list[OpportunityRanking] = Field(default_factory=list)


# ─── draft_outreach_dm ────────────────────────────────────────────────────────

class DraftOutreachOutput(BaseModel):
    """
    A message the MUSICIAN sends themselves. Chimera never sends it for them —
    see the note in services/opportunities.py.
    """

    subject: str = Field(max_length=200)
    body: str = Field(max_length=2000)
    channel: str = Field(
        default="",
        max_length=120,
        description="Where to send it — e.g. 'Venue booking form'.",
    )
