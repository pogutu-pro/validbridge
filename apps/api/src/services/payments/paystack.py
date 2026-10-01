"""
Paystack provider client.

Single-merchant, per-organization. Each org brings its own Paystack account;
its credentials are stored on its ``PaymentsConfig.provider_config`` and fall
back to the platform-level config when absent. Webhook signatures are verified
with the account's SECRET key (Paystack signs webhooks with HMAC-SHA512 of the
raw request body using the secret key — there is no separate webhook secret).
"""

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.payments.payments import PaymentsConfig
from src.security.secret_crypto import resolve_secret

PAYSTACK_BASE_URL = "https://api.paystack.co"


@dataclass
class PaystackCredentials:
    secret_key: str
    public_key: str


class PaymentsNotConfiguredError(Exception):
    """Raised when an org has no usable Paystack credentials."""


async def resolve_paystack_credentials(
    org_id: int, db_session: AsyncSession
) -> PaystackCredentials:
    """Return the org's Paystack credentials, falling back to platform config."""
    from config.config import get_validbridge_config

    platform = get_validbridge_config().payments_config.paystack

    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()

    provider_config = (config.provider_config or {}) if config else {}
    secret_key = resolve_secret(provider_config.get("secret_key")) or platform.secret_key
    public_key = provider_config.get("public_key") or platform.public_key or ""

    if not secret_key:
        raise PaymentsNotConfiguredError(
            "This organization has no Paystack credentials configured."
        )
    return PaystackCredentials(secret_key=secret_key, public_key=public_key)


def _auth_headers(secret_key: str) -> dict:
    return {"Authorization": f"Bearer {secret_key}"}


def make_reference(org_id: int) -> str:
    """A unique, org-routable transaction reference.

    Format ``vb_<org_id>_<hex>`` — the webhook handler extracts ``org_id`` from
    ``data.reference`` to resolve the correct credentials for verification.
    """
    return f"vb_{org_id}_{uuid.uuid4().hex[:16]}"


def reference_to_org_id(reference: str) -> int | None:
    parts = reference.split("_")
    if len(parts) >= 3 and parts[0] == "vb":
        try:
            return int(parts[1])
        except ValueError:
            return None
    return None


async def initialize_transaction(
    secret_key: str,
    *,
    email: str,
    amount_major: float,
    currency: str,
    reference: str,
    callback_url: str,
    metadata: dict,
    plan: str | None = None,
) -> dict:
    """Initialize a Paystack transaction; returns {authorization_url, reference}.

    ``plan`` is a Paystack plan code: when set, Paystack starts a subscription
    instead of a one-time charge.
    """
    payload: dict[str, Any] = {
        "email": email,
        "currency": currency,
        "reference": reference,
        "callback_url": callback_url,
        "metadata": metadata,
    }
    if plan:
        payload["plan"] = plan
    else:
        payload["amount"] = int(round(amount_major * 100))
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/transaction/initialize",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack transaction initialize failed"))
    return {
        "authorization_url": data["data"]["authorization_url"],
        "reference": data["data"]["reference"],
    }


async def create_plan(
    secret_key: str,
    *,
    name: str,
    amount_major: float,
    currency: str,
    interval: str,
) -> str:
    """Create a Paystack plan; returns its ``plan_code``."""
    payload = {
        "name": name,
        "amount": int(round(amount_major * 100)),
        "currency": currency,
        "interval": interval,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/plan",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack plan creation failed"))
    return data["data"]["plan_code"]


async def update_plan(
    secret_key: str,
    plan_code: str,
    *,
    name: str,
    amount_major: float,
    currency: str,
    interval: str,
) -> str:
    """Update an existing Paystack plan; returns the (unchanged) plan code."""
    payload = {
        "name": name,
        "amount": int(round(amount_major * 100)),
        "currency": currency,
        "interval": interval,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.put(
            f"{PAYSTACK_BASE_URL}/plan/{plan_code}",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack plan update failed"))
    return plan_code


async def disable_subscription(
    secret_key: str,
    subscription_code: str,
    email_token: str,
) -> None:
    """Disable a Paystack subscription (cancel future billing)."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/subscription/disable",
            headers=_auth_headers(secret_key),
            json={"code": subscription_code, "token": email_token},
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack subscription disable failed"))


async def get_subscription(secret_key: str, subscription_code: str) -> dict | None:
    """Return Paystack subscription metadata (status, next_payment_date, …).

    Returns None when Paystack cannot resolve the code.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{PAYSTACK_BASE_URL}/subscription/{subscription_code}",
            headers=_auth_headers(secret_key),
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        return None
    return data["data"]


async def list_customer_transactions(
    secret_key: str,
    customer: str | None = None,
) -> list[dict]:
    """Return the customer's recent transactions from Paystack.

    ``customer`` is the Paystack customer id/code or email. Returns [] when
    Paystack does not know the customer.
    """
    params: dict[str, str] = {}
    if customer:
        params["customer"] = customer
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{PAYSTACK_BASE_URL}/transaction",
            headers=_auth_headers(secret_key),
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        return []
    return data.get("data") or []


async def verify_transaction(secret_key: str, reference: str) -> dict | None:
    """Return the full transaction data if successful, else None."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{PAYSTACK_BASE_URL}/transaction/verify/{reference}",
            headers=_auth_headers(secret_key),
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        return None
    return data["data"]


# ── Platform billing (ValidBridge's own account; amounts in integer cents) ────

PLATFORM_CHANNELS = ("card", "mobile_money", "bank_transfer")


async def initialize_transaction_cents(
    secret_key: str,
    *,
    email: str,
    amount_cents: int,
    currency: str,
    reference: str,
    callback_url: str,
    metadata: dict,
    channels: tuple[str, ...] = PLATFORM_CHANNELS,
) -> dict:
    """Initialize a one-time charge of ``amount_cents`` (integer minor units).

    Returns ``{authorization_url, access_code, reference}``.
    """
    payload: dict[str, Any] = {
        "email": email,
        "amount": int(amount_cents),
        "currency": currency,
        "reference": reference,
        "callback_url": callback_url,
        "metadata": metadata,
        "channels": list(channels),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/transaction/initialize",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack transaction initialize failed"))
    return {
        "authorization_url": data["data"]["authorization_url"],
        "access_code": data["data"].get("access_code"),
        "reference": data["data"]["reference"],
    }


async def charge_authorization(
    secret_key: str,
    *,
    authorization_code: str,
    email: str,
    amount_cents: int,
    currency: str,
    reference: str,
    metadata: dict,
) -> dict:
    """Charge a saved card. Returns Paystack's transaction ``data``; its
    ``status`` is ``success``, ``failed``, or a step the payer must complete
    (``send_otp``, ``pending``, …) — callers fall back to checkout then."""
    payload = {
        "authorization_code": authorization_code,
        "email": email,
        "amount": int(amount_cents),
        "currency": currency,
        "reference": reference,
        "metadata": metadata,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/transaction/charge_authorization",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        # Paystack answers declined cards with 4xx and a JSON body; surface the
        # body as a failed charge rather than an exception.
        try:
            data = resp.json()
        except ValueError:
            resp.raise_for_status()
            raise
    if not data.get("status"):
        return {"status": "failed", "gateway_response": data.get("message")}
    return data.get("data") or {"status": "failed"}


async def refund_transaction(
    secret_key: str, *, reference: str, amount_cents: int | None = None
) -> dict:
    """Refund a transaction in full, or ``amount_cents`` of it."""
    payload: dict[str, Any] = {"transaction": reference}
    if amount_cents is not None:
        payload["amount"] = int(amount_cents)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PAYSTACK_BASE_URL}/refund",
            headers=_auth_headers(secret_key),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
    if not data.get("status"):
        raise RuntimeError(data.get("message", "Paystack refund failed"))
    return data.get("data") or {}


def verify_webhook_signature(secret_key: str, raw_body: bytes, signature: str | None) -> bool:
    """Verify the ``x-paystack-signature`` header (HMAC-SHA512 of raw body)."""
    if not signature:
        return False
    expected = hmac.new(
        secret_key.encode("utf-8"), raw_body, hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def parse_webhook_body(raw_body: bytes) -> dict:
    return json.loads(raw_body.decode("utf-8"))
