"""
Paystack provider client.

Per-organization, in one of two modes (``PaymentsConfig.provider_config["mode"]``):

* ``byok``    — the org brings its own Paystack account; its keys live on its
  ``PaymentsConfig.provider_config`` (secret key encrypted) and funds settle
  straight to it.
* ``managed`` — the org has no Paystack account. ValidBridge creates a Paystack
  *subaccount* (just a bank account) under the platform account; charges run on
  the platform keys with ``subaccount=ACCT_…`` and Paystack splits the payout.

There is no silent fallback: an org with neither is "not configured".
Webhook signatures are HMAC-SHA512 of the raw body with the account's SECRET key
(there is no separate webhook secret).
"""

import hashlib
import hmac
import json
import math
import os
import time
import uuid
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.payments.payments import PaymentsConfig
from src.security.secret_crypto import resolve_secret

PAYSTACK_BASE_URL = "https://api.paystack.co"

MODE_BYOK = "byok"
MODE_MANAGED = "managed"


@dataclass
class PaystackCredentials:
    secret_key: str
    public_key: str
    mode: str = MODE_BYOK
    subaccount_code: str | None = None


class PaymentsNotConfiguredError(Exception):
    """Raised when an org has no usable Paystack credentials."""


class PaystackError(Exception):
    """Paystack refused a request; ``str(exc)`` is Paystack's own message,
    safe to show to the org admin (it never contains the secret key)."""


# ── Platform account (managed mode) ──────────────────────────────────────────

def platform_credentials() -> PaystackCredentials | None:
    """ValidBridge's own Paystack account, or None when it is not configured.

    The same account backs platform billing, so its single webhook URL
    (``/billing/paystack/webhook``) receives managed course sales too.
    """
    from config.config import get_validbridge_config
    from src.core.billing_flags import (
        platform_paystack_public_key,
        platform_paystack_secret_key,
    )

    yaml_keys = get_validbridge_config().payments_config.paystack
    secret = platform_paystack_secret_key() or (yaml_keys.secret_key or "").strip()
    if not secret:
        return None
    public = platform_paystack_public_key() or (yaml_keys.public_key or "").strip()
    return PaystackCredentials(secret_key=secret, public_key=public, mode=MODE_MANAGED)


def settlement_currency() -> str:
    """Currency of the platform account's country. Paystack subaccounts must
    settle to a bank in the platform account's own country."""
    return (os.environ.get("VALIDBRIDGE_PAYSTACK_SETTLEMENT_CURRENCY") or "KES").strip().upper()


def platform_fee_percent() -> float:
    """ValidBridge's cut of each managed sale (``percentage_charge``)."""
    try:
        value = float(os.environ.get("VALIDBRIDGE_PAYMENTS_PLATFORM_FEE_PERCENT") or 0)
    except ValueError:
        return 0.0
    return min(max(value, 0.0), 100.0)


def fee_bearer() -> str:
    """Who pays Paystack's processing fee on managed sales. ``subaccount``
    (the school) by default — with ``account`` the platform pays every fee out
    of its own share, which loses money whenever the platform fee is low."""
    value = (os.environ.get("VALIDBRIDGE_PAYMENTS_FEE_BEARER") or "subaccount").strip().lower()
    return value if value in ("account", "subaccount") else "subaccount"


# ── Learner-pays-fees (managed mode) ─────────────────────────────────────────
#
# ValidBridge takes 0% of course sales. For M-PESA, Paystack's processing fee
# is added on top for the learner so the instructor receives the full price.
# Cards are charged the plain price — no card surcharge — and Paystack's card
# fee comes out of the instructor's share (``bearer=subaccount``). Checkout
# offers one button per method, each restricted to that channel, so the fee
# added always matches the method used. Kenya pricing (paystack.com/ke/
# pricing): M-PESA 1.5%; cards 2.9% local, 3.8% international.

CHECKOUT_METHODS = ("mobile_money", "card")
# Percent added on top for the learner, per method (0 = instructor bears it).
_FEE_RATE_ENV = {
    "mobile_money": ("VALIDBRIDGE_PAYSTACK_FEE_MOBILE_MONEY_PERCENT", 1.5),
    "card": ("VALIDBRIDGE_PAYSTACK_FEE_CARD_PERCENT", 0.0),
}


def learner_pays_fees() -> bool:
    """Add Paystack's fee to managed-mode checkouts (default on)."""
    value = (os.environ.get("VALIDBRIDGE_PAYMENTS_LEARNER_PAYS_FEES") or "true").strip().lower()
    return value not in ("0", "false", "no", "off")


def fee_rate(method: str) -> float:
    """Fee added on top for the learner paying by ``method``, as a fraction
    (0.015 = 1.5%); 0 means the instructor bears Paystack's fee."""
    env, default = _FEE_RATE_ENV[method]
    try:
        percent = float(os.environ.get(env) or default)
    except ValueError:
        percent = default
    return min(max(percent, 0.0), 20.0) / 100


def gross_up_minor(base_minor: int, rate: float) -> int:
    """Smallest whole-currency amount (in minor units) whose Paystack fee at
    ``rate`` still leaves at least ``base_minor`` for the instructor. Whole
    units because M-PESA cannot charge cents."""
    if rate <= 0 or base_minor <= 0:
        return max(base_minor, 0)
    # Exact arithmetic: a float could round a boundary amount down a unit.
    gross = Fraction(base_minor) / (1 - Fraction(str(rate)))
    return math.ceil(gross / 100) * 100


def max_fee_minor(base_minor: int) -> int:
    """The largest fee any checkout method may add on top of ``base_minor``."""
    return max(gross_up_minor(base_minor, fee_rate(m)) - base_minor for m in CHECKOUT_METHODS)


async def _load_config(org_id: int, db_session: AsyncSession) -> PaymentsConfig | None:
    return (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()


def config_mode(provider_config: dict | None) -> str:
    return MODE_MANAGED if (provider_config or {}).get("mode") == MODE_MANAGED else MODE_BYOK


async def resolve_paystack_credentials(
    org_id: int, db_session: AsyncSession, *, require_active: bool = False
) -> PaystackCredentials:
    """Return the credentials this org's charges run on.

    ``require_active`` is for starting NEW charges: a disabled or inactive
    config refuses. Webhooks, refunds and subscription management for past
    sales pass False so history keeps working after a school pauses payments.
    """
    config = await _load_config(org_id, db_session)
    if config is None:
        raise PaymentsNotConfiguredError(
            "This organization has not set up payments yet."
        )
    if require_active and not (config.enabled and config.active):
        raise PaymentsNotConfiguredError("Payments are paused for this organization.")

    provider_config = config.provider_config or {}
    if config_mode(provider_config) == MODE_MANAGED:
        platform = platform_credentials()
        code = provider_config.get("subaccount_code")
        if platform is None or not code:
            raise PaymentsNotConfiguredError(
                "This organization's payout account is not available."
            )
        return PaystackCredentials(
            secret_key=platform.secret_key,
            public_key=platform.public_key,
            mode=MODE_MANAGED,
            subaccount_code=code,
        )

    secret_key = resolve_secret(provider_config.get("secret_key"))
    if not secret_key:
        raise PaymentsNotConfiguredError(
            "This organization has no Paystack credentials configured."
        )
    return PaystackCredentials(
        secret_key=secret_key, public_key=provider_config.get("public_key") or ""
    )


async def webhook_secret_keys(org_id: int, db_session: AsyncSession) -> list[str]:
    """Every key a genuine webhook for this org may be signed with.

    The org's current account, plus the platform account: a school that moved
    between modes still has live subscriptions on the account it left. Only
    Paystack (or ValidBridge itself) holds the platform key, and the org is
    taken from our own reference, so accepting it cannot cross orgs.
    """
    keys: list[str] = []
    config = await _load_config(org_id, db_session)
    if config is not None:
        own = resolve_secret((config.provider_config or {}).get("secret_key"))
        if own:
            keys.append(own)
    platform = platform_credentials()
    if platform is not None and platform.secret_key not in keys:
        keys.append(platform.secret_key)
    return keys


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
    subaccount: str | None = None,
    bearer: str | None = None,
    channels: list[str] | None = None,
) -> dict:
    """Initialize a Paystack transaction; returns {authorization_url, reference}.

    ``plan`` is a Paystack plan code: when set, Paystack starts a subscription
    instead of a one-time charge. ``subaccount`` routes the payout to a managed
    org's bank account; ``bearer`` says who pays Paystack's fee on that split.
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
    if subaccount:
        payload["subaccount"] = subaccount
        if bearer:
            payload["bearer"] = bearer
    if channels:
        payload["channels"] = list(channels)
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


# ── Banks, subaccounts and key checks (payout setup) ─────────────────────────

async def _call(method: str, path: str, secret_key: str, **kwargs) -> tuple[Any, dict]:
    """Call Paystack and return ``(data, meta)``; raise PaystackError with Paystack's
    message on refusal so the admin sees *why* (e.g. a wrong account number)."""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(
            method, f"{PAYSTACK_BASE_URL}{path}", headers=_auth_headers(secret_key), **kwargs
        )
    try:
        body = resp.json()
    except ValueError:
        raise PaystackError(f"Paystack returned an unexpected response ({resp.status_code}).")
    if resp.status_code >= 400 or not body.get("status"):
        raise PaystackError(body.get("message") or f"Paystack refused the request ({resp.status_code}).")
    return body.get("data"), body.get("meta") or {}


_BANK_CACHE: dict[str, tuple[float, list[dict]]] = {}
_BANK_CACHE_SECONDS = 6 * 3600


async def list_banks(secret_key: str, currency: str) -> list[dict]:
    """Active payout banks (and mobile-money providers, where Paystack offers
    them) for ``currency``, as ``[{code, name, type}]`` sorted by name."""
    cached = _BANK_CACHE.get(currency)
    if cached and time.monotonic() - cached[0] < _BANK_CACHE_SECONDS:
        return cached[1]
    banks: list[dict] = []
    params: dict[str, Any] = {"currency": currency, "perPage": 100, "use_cursor": "true"}
    seen: set[str] = set()
    for _ in range(20):  # cursor pages; Paystack lists are a few hundred at most
        data, meta = await _call("GET", "/bank", secret_key, params=params)
        for bank in data or []:
            code = str(bank.get("code") or "")
            if not code or code in seen or bank.get("active") is False or bank.get("is_deleted"):
                continue
            seen.add(code)
            banks.append({"code": code, "name": bank.get("name") or code, "type": bank.get("type") or ""})
        cursor = meta.get("next")
        if not cursor:
            break
        params["next"] = cursor
    banks.sort(key=lambda b: b["name"].lower())
    _BANK_CACHE[currency] = (time.monotonic(), banks)
    return banks


# Paystack lists M-PESA Paybill as a payout "bank", but a paybill payment also
# needs an account reference that a subaccount cannot carry, so money could be
# sent to a paybill with nothing telling the school it is theirs. Not offered.
_UNSUPPORTED_PAYOUT_CODES = frozenset({"MPPAYBILL"})


def payout_kind(bank: dict) -> str | None:
    """How a payout destination is addressed: ``bank`` (account number),
    ``mobile`` (phone number), ``till`` (M-PESA till number), or None when
    ValidBridge does not offer it."""
    code = str(bank.get("code") or "")
    kind = str(bank.get("type") or "").lower()
    if code in _UNSUPPORTED_PAYOUT_CODES:
        return None
    if code == "MPTILL":
        return "till"
    if kind == "mobile_money":
        return "mobile"
    if kind.startswith("mobile_money"):
        return None  # other business wallets: same reference problem as paybill
    return "bank"


def payout_destinations(banks: list[dict]) -> list[dict]:
    """``list_banks`` filtered to what managed payouts support, each tagged
    with its ``kind`` so the form asks for the right number."""
    out = []
    for bank in banks:
        kind = payout_kind(bank)
        if kind:
            out.append({**bank, "kind": kind})
    return out


def is_test_key(secret_key: str | None) -> bool:
    return bool(secret_key) and secret_key.startswith("sk_test_")


async def fetch_subaccount(secret_key: str, subaccount_code: str) -> dict:
    data, _ = await _call("GET", f"/subaccount/{subaccount_code}", secret_key)
    return data or {}


async def resolve_account_name(secret_key: str, account_number: str, bank_code: str) -> str | None:
    """The account holder's name, or None where Paystack cannot resolve
    accounts for that country/bank. Best effort — never blocks setup."""
    try:
        data, _ = await _call(
            "GET", "/bank/resolve", secret_key,
            params={"account_number": account_number, "bank_code": bank_code},
        )
    except (PaystackError, httpx.HTTPError):
        return None
    return (data or {}).get("account_name") or None


async def create_subaccount(secret_key: str, **fields: Any) -> dict:
    """Create a subaccount; returns Paystack's data (incl. ``subaccount_code``)."""
    data, _ = await _call("POST", "/subaccount", secret_key, json=fields)
    return data or {}


async def update_subaccount(secret_key: str, subaccount_code: str, **fields: Any) -> dict:
    data, _ = await _call("PUT", f"/subaccount/{subaccount_code}", secret_key, json=fields)
    return data or {}


async def check_secret_key(secret_key: str) -> None:
    """Raise PaystackError unless Paystack accepts ``secret_key``."""
    try:
        await _call("GET", "/transaction", secret_key, params={"perPage": 1})
    except httpx.HTTPError:
        raise PaystackError("Could not reach Paystack to check the key. Try again.")


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
