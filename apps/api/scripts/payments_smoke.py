"""Live Paystack smoke test (TEST MODE only).

Exercises the real Paystack test API with the credentials resolved from
``VALIDBRIDGE_PAYSTACK_SECRET_KEY`` / ``VALIDBRIDGE_PAYSTACK_PUBLIC_KEY``
(platform-level fallback in ``resolve_paystack_credentials``).

Refuses to run unless ``PAYSTACK_SMOKE=1`` so it can never fire in CI or on a
normal boot. Creates real TEST plans/transactions on the configured Paystack
account — do not point this at production keys.

Usage:
    PAYSTACK_SMOKE=1 uv run --no-sync python scripts/payments_smoke.py

Steps completed automatically:
  1. credentials resolve from env
  2. read-only: list customers + recent transactions
  3. create a unique test plan (subscription)
  4. initialize a one-time transaction + a subscription transaction
  5. ``verify_transaction`` lookup (abandoned unless paid)
  6. ``verify_webhook_signature`` + ``parse_webhook_body`` round trip

Manual step to close the loop end-to-end: open either ``authorization_url`` in
a browser and pay with the Paystack test card (card ``4084084084084081``, any
future expiry/CVV, OTP ``123456`` or PIN ``0000``). The ``charge.success``
webhook then lands on ``POST /payments/paystack/webhook``.
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

load_dotenv()  # picks up apps/api/.env when run from apps/api

from config.config import get_validbridge_config
from src.services.payments import paystack

SMOKE_ENABLED_ENV = "PAYSTACK_SMOKE"


def _require_gate() -> None:
    if os.environ.get(SMOKE_ENABLED_ENV) != "1":
        sys.exit(
            f"{SMOKE_ENABLED_ENV}=1 required — this hits the live Paystack test API."
        )


def _check(label: str, ok: bool, detail: str = "") -> bool:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}" + (f" — {detail}" if detail else ""))
    return ok


async def main() -> int:
    _require_gate()

    config = get_validbridge_config()
    creds = config.payments_config.paystack
    secret = creds.secret_key
    public = creds.public_key

    print(f"=> host {paystack.PAYSTACK_BASE_URL}")
    print(f"=> secret key {'set' if secret else 'MISSING'}, public key {'set' if public else 'MISSING'}")

    results: list[bool] = []
    if not secret and not public:
        sys.exit("No Paystack keys configured.")

    # 1. read-only reachability
    try:
        customers = await paystack.list_customer_transactions(secret, customer=None)
        results.append(_check("GET /transaction (list)", True, f"{len(customers)} recent txn(s)"))
    except Exception as exc:  # noqa: BLE001
        results.append(_check("GET /transaction (list)", False, str(exc)))

    # 2. create a unique test plan
    plan_code = None
    try:
        plan_code = await paystack.create_plan(
            secret,
            name="VB Smoke Test (delete me)",
            amount_major=25.0,
            currency="KES",
            interval="monthly",
        )
        results.append(_check("POST /plan (create)", True, plan_code))
    except Exception as exc:  # noqa: BLE001
        results.append(_check("POST /plan (create)", False, str(exc)))

    # 3. one-time transaction initialize
    one_off = None
    try:
        one_off = await paystack.initialize_transaction(
            secret,
            email="smoke@validbridge.com",
            amount_major=25.0,
            currency="KES",
            reference=paystack.make_reference(999999),
            callback_url="http://localhost:3000/marketplace",
            metadata={"smoke": "1"},
        )
        results.append(
            _check("POST /transaction/initialize (one-time)", True, one_off["reference"])
        )
    except Exception as exc:  # noqa: BLE001
        results.append(_check("POST /transaction/initialize (one-time)", False, str(exc)))

    # 4. subscription transaction initialize (plan-backed)
    sub = None
    if plan_code:
        try:
            sub = await paystack.initialize_transaction(
                secret,
                email="smoke@validbridge.com",
                amount_major=25.0,
                currency="KES",
                reference=paystack.make_reference(999999),
                callback_url="http://localhost:3000/marketplace",
                metadata={"smoke": "1"},
                plan=plan_code,
            )
            results.append(
                _check("POST /transaction/initialize (subscription)", True, sub["reference"])
            )
        except Exception as exc:  # noqa: BLE001
            results.append(_check("POST /transaction/initialize (subscription)", False, str(exc)))

    # 5. verify an unpurchased reference (should resolve, but not confirmed)
    if one_off:
        try:
            verified = await paystack.verify_transaction(secret, one_off["reference"])
            results.append(_check("GET /transaction/verify", True, f"status={verified and verified.get('status')}"))
        except Exception as exc:  # noqa: BLE001
            results.append(_check("GET /transaction/verify", False, str(exc)))

    # 6. webhook signature + body round trip (pure-local)
    body = b'{"event":"charge.success","data":{"reference":"vb_999999_deadbeef"}}'
    signed = paystack.verify_webhook_signature(secret, body, None)
    results.append(_check("webhook signature rejects missing header", signed is False))
    import hashlib

    import hmac

    expected = hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()
    valid = paystack.verify_webhook_signature(secret, body, expected)
    results.append(_check("webhook signature accepts matching header", valid is True))
    parsed = paystack.parse_webhook_body(body)
    results.append(_check("parse_webhook_body", parsed["event"] == "charge.success"))

    print()
    print("=> PAYSTACK SMOKE COMPLETE")
    if sub:
        print("=> complete the loop in a browser (test card 4084084084084081):")
        print(f"   {sub['authorization_url']}")
    print(f"{sum(results)}/{len(results)} automated checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))