"""
Encrypted OAuth token vault.

Tokens are encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256) keyed by
OAUTH_TOKEN_ENCRYPTION_KEY, and stored in connection_secrets — a table the
anon-key client cannot read at all (migration 007).

Why encrypt when the table is already service-role-only: a database dump, a
backup, a support export, or a mis-scoped read replica all leak plaintext rows.
Ciphertext without the key (which lives only in the backend environment, never
in Postgres) is inert. This is the same reasoning that put password_hash in its
own table in migration 005 — defence in depth, cheap to apply.

Fernet also authenticates: a tampered ciphertext fails to decrypt rather than
silently yielding a wrong token.
"""
from __future__ import annotations

import base64
import hashlib
import logging

from config import settings

logger = logging.getLogger(__name__)


class VaultUnavailable(RuntimeError):
    """Raised when encryption is required but no key is configured."""


def _fernet():
    """
    Build the Fernet cipher, deriving a valid key from the configured secret.

    Fernet demands exactly 32 url-safe-base64 bytes. Rather than force the
    operator to generate that precise format (and fail confusingly if they use
    `openssl rand -hex 32`, which is what .env.example suggests), we accept any
    sufficiently long secret and derive the key with SHA-256. A raw
    32-byte-base64 key is passed through unchanged so existing keys keep working.
    """
    from cryptography.fernet import Fernet  # deferred: heavy import

    secret = settings.oauth_token_encryption_key
    if not secret:
        raise VaultUnavailable(
            "OAUTH_TOKEN_ENCRYPTION_KEY is not set. Connecting a service would "
            "store OAuth tokens unencrypted, so the connect flow is disabled. "
            "Generate one with: openssl rand -hex 32"
        )

    try:
        # Already a proper Fernet key?
        if len(base64.urlsafe_b64decode(secret.encode())) == 32:
            return Fernet(secret.encode())
    except Exception:  # noqa: BLE001 — not base64; fall through to derivation
        pass

    derived = base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest())
    return Fernet(derived)


def vault_available() -> bool:
    """
    Whether tokens can be stored safely. The connect flow checks this BEFORE
    starting an OAuth handshake, so we never send a user to Google only to
    discover at the callback that we cannot persist the result.
    """
    return bool(settings.oauth_token_encryption_key)


def encrypt(plaintext: str) -> str:
    """Encrypt a token. Empty input stays empty — absence is not a secret."""
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    """
    Decrypt a token.

    Returns "" on any failure (wrong key after a key rotation, corrupted row,
    tampering) instead of raising. The caller then treats the connection as
    needing re-authentication, which is the correct and recoverable outcome —
    an exception here would take down an entire sync tick over one bad row.
    """
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except Exception as exc:  # noqa: BLE001
        logger.warning("token_decrypt_failed", extra={"error": str(exc)})
        return ""
