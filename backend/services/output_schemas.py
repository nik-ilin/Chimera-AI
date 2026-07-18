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
    assistant_message: str = Field(
        max_length=1000,
        description="A short assistant note about the generated lyrics.",
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
