"""Symmetric encryption for secrets stored at rest.

Every secret an organization persists — outbound webhook signing secrets, BYOK
Paystack keys, OIDC client secrets — is Fernet-encrypted with a key derived from
the application JWT secret. **Never persist a secret in plaintext.**

``resolve_secret`` tolerates legacy plaintext rows (values written before this
module existed): a failed decrypt means the stored value is still raw, so it is
returned unchanged and re-encrypted on the next save.
"""

import base64
import functools
import hashlib

from cryptography.fernet import Fernet

from config.config import get_validbridge_config


@functools.lru_cache(maxsize=1)
def _fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from the application's JWT secret."""
    secret = get_validbridge_config().security_config.auth_jwt_secret_key
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a secret for database storage."""
    return Fernet(_fernet_key()).encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt a stored secret. Raises on a malformed/invalid token."""
    return Fernet(_fernet_key()).decrypt(ciphertext.encode()).decode()


def resolve_secret(stored: str | None) -> str | None:
    """Decrypt a stored secret, tolerating legacy plaintext rows."""
    if not stored:
        return None
    try:
        return decrypt_secret(stored)
    except Exception:  # noqa: BLE001 - InvalidToken/malformed base64 => legacy plaintext
        return stored
