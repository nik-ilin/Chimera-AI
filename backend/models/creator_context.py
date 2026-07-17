"""
CreatorContext Pydantic model.

CONVENTIONS.md §4: One schema, injected into every task's prompt.
This model is the central context object that makes Granite outputs
consistent across all modules for a given artist.
"""
from pydantic import BaseModel, Field


class CreatorContext(BaseModel):
    """
    Persisted in Supabase user_profile and injected into every AI task prompt.
    Ensures consistent, on-brand output across all modules.
    """

    artist_name: str = Field(
        default="",
        max_length=200,
        description="The artist's stage name.",
    )
    genre: str = Field(
        default="",
        max_length=100,
        description="Primary music genre (e.g. 'dark pop', 'lo-fi hip-hop').",
    )
    city: str = Field(
        default="",
        max_length=100,
        description="City the artist is based in.",
    )
    brand_vibe: str = Field(
        default="",
        max_length=500,
        description=(
            "Short description of the artist's brand and aesthetic. "
            "e.g. 'cinematic, introspective, night-drive energy'."
        ),
    )
    instagram_handle: str | None = Field(
        default=None,
        max_length=100,
    )
    tiktok_handle: str | None = Field(
        default=None,
        max_length=100,
    )
    recent_outputs: list[str] = Field(
        default_factory=list,
        max_length=3,
        description="Last 3 generated items for stylistic continuity.",
    )
