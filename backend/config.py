"""
Application configuration via pydantic-settings.
Reads from environment variables / .env file.
CONVENTIONS.md §3: pydantic-settings for all configuration.
"""
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Internal security ──
    chimera_service_token: str

    # ── CORS ──
    allowed_origins: List[str] = ["http://localhost:3000"]

    # ── IBM watsonx / Granite ──
    watsonx_api_key: str = ""
    watsonx_project_id: str = ""
    watsonx_url: str = "https://us-south.ml.cloud.ibm.com"
    granite_model_id: str = "meta-llama/llama-3-3-70b-instruct"

    # ── LangFlow ──
    langflow_base_url: str = "http://localhost:7860"
    langflow_api_key: str = ""
    # Comma-separated "task_name:flow_uuid" pairs, e.g.
    # "write_captions:abc-123,write_lyrics:def-456"
    # Empty string = no LangFlow configured, fall back to direct Granite.
    langflow_flow_ids: str = ""

    # ── HuggingFace ──
    huggingface_api_token: str = ""
    huggingface_image_model: str = "stabilityai/stable-diffusion-xl-base-1.0"

    # ── Supabase (service-role — never exposed to browser) ──
    supabase_url: str = ""
    supabase_service_role_key: str = ""

    # ── Google Calendar ──
    google_client_id: str = ""
    google_client_secret: str = ""
    # Must match the callback in routes/connections.py AND the URI registered in
    # Google Cloud Console — Google rejects the exchange on any mismatch.
    google_redirect_uri: str = "http://localhost:8000/api/connections/oauth/callback"
    oauth_token_encryption_key: str = ""

    # ── Ticketmaster ──
    ticketmaster_api_key: str = ""

    # ── Instagram ──
    instagram_username: str = ""
    instagram_password: str = ""

    # ── App ──
    app_env: str = "development"
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
