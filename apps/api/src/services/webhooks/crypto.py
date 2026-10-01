"""
Cryptographic helpers for webhook payload signatures.

Secret encryption lives in :mod:`src.security.secret_crypto` (shared with the
BYOK credential storage).
"""

import hashlib
import hmac


def compute_signature(payload: bytes, secret: str) -> str:
    """
    Compute an HMAC-SHA256 signature for a webhook payload.

    Returns a string in the form ``sha256=<hex_digest>``, matching the
    convention used by GitHub and supported by Zapier / Make.com.
    """
    mac = hmac.new(secret.encode(), payload, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"
