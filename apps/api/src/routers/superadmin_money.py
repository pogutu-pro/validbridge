"""Money dashboard and system health for the superadmin console. Read-only."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.billing_flags import billing_enabled, platform_paystack_secret_key
from src.core.events.database import get_db_session
from src.core.redis import get_redis_client
from src.db.billing import BillingSubscription, Invoice, LedgerEntry, PaymentAttempt
from src.db.courses.exams import ExamSession, ExamSessionStatus
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.organizations import Organization
from src.security.staff import require_staff
from config.config import get_validbridge_config

logger = logging.getLogger(__name__)
router = APIRouter()

MONTHS = 6
# Invoice age buckets in days: 0-30, 31-60, 61+.
AGING = ((0, 30), (31, 60), (61, None))
TOP_SCHOOLS = 5


def _months_back(now: datetime, count: int) -> list[datetime]:
    """First day of each of the last ``count`` months, oldest first."""
    year, month = now.year, now.month
    out = []
    for _ in range(count):
        out.append(datetime(year, month, 1, tzinfo=timezone.utc))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return out[::-1]


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value is not None and value.tzinfo is None else value


@router.get("/money")
async def money_dashboard(
    current_user: Any = Depends(require_staff("billing_read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    db = db_session
    now = datetime.now(timezone.utc)
    starts = _months_back(now, MONTHS)

    # Cash collected through the platform's Paystack, per month. Wallet top-ups and card
    # verifications are excluded, matching the billing report.
    attempts = (
        await db.execute(
            select(PaymentAttempt.amount_cents, PaymentAttempt.created_at).where(
                PaymentAttempt.status == "success",
                PaymentAttempt.created_at >= starts[0],
                PaymentAttempt.reference.like("vb%"),
                ~PaymentAttempt.reference.like("vbw_%"),
                ~PaymentAttempt.reference.like("vbc_%"),
            )
        )
    ).all()
    collected = {s.strftime("%Y-%m"): 0 for s in starts}
    for amount, created in attempts:
        key = _aware(created).strftime("%Y-%m")
        if key in collected:
            collected[key] += int(amount)

    unpaid = (await db.execute(select(Invoice).where(Invoice.status.in_(("open", "failed"))))).scalars().all()
    aging = [{"label": f"{lo}-{hi} days" if hi else f"{lo}+ days", "count": 0, "cents": 0} for lo, hi in AGING]
    for inv in unpaid:
        age = (now - _aware(inv.created_at)).days
        for bucket, (lo, hi) in zip(aging, AGING):
            if age >= lo and (hi is None or age <= hi):
                bucket["count"] += 1
                bucket["cents"] += int(inv.total_cents)
                break

    manual = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Invoice.total_cents), 0)).where(Invoice.status == "paid", Invoice.paid_via == "manual")
        )
    ).one()
    by_plan = dict((await db.execute(select(BillingSubscription.plan, func.count()).group_by(BillingSubscription.plan))).all())

    wallets = (
        await db.execute(
            select(LedgerEntry.org_id, func.sum(LedgerEntry.amount_cents).label("balance")).group_by(LedgerEntry.org_id)
        )
    ).all()
    held = sum(int(b) for _, b in wallets if b and b > 0)
    top = sorted(((o, int(b)) for o, b in wallets if b and b > 0), key=lambda r: r[1], reverse=True)[:TOP_SCHOOLS]
    names = dict((await db.execute(select(Organization.id, Organization.name).where(Organization.id.in_([o for o, _ in top])))).all()) if top else {}

    return {
        "collected_by_month": [{"month": k, "cents": v} for k, v in collected.items()],
        "unpaid_aging": aging,
        "unpaid_total_cents": sum(b["cents"] for b in aging),
        "recorded_manually": {"count": int(manual[0]), "cents": int(manual[1])},
        "subscriptions_by_plan": {k: int(v) for k, v in by_plan.items()},
        "wallet_held_cents": held,
        "largest_wallets": [{"org_id": o, "org_name": names.get(o), "cents": b} for o, b in top],
    }


class Problem(Exception):
    """A deliberate, safe-to-show finding. Anything else is reported generically."""


MANUAL_PREFIX = "manual:"


def _month_key(value: datetime) -> str:
    return _aware(value).strftime("%Y-%m")


@router.get("/schools-payments")
async def schools_payments(
    current_user: Any = Depends(require_staff("billing_read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    """What each school has paid ValidBridge: Paystack payments and payments staff recorded by hand.

    Spending a wallet balance is not counted (the top-up already was), nor are card checks.
    An invoice recorded by hand counts in the month it was last updated, which is when it was marked paid."""
    db = db_session
    now = datetime.now(timezone.utc)
    this_month = _month_key(now)
    year, month = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    last_month = f"{year:04d}-{month:02d}"

    rows: dict[int, dict] = {}

    def row(org_id: int) -> dict:
        return rows.setdefault(org_id, {"online": 0, "manual": 0, "this_month": 0, "last_month": 0, "payments": 0})

    def add(org_id: int, kind: str, cents: int, when: datetime) -> None:
        r = row(org_id)
        r[kind] += cents
        r["payments"] += 1
        key = _month_key(when)
        if key == this_month:
            r["this_month"] += cents
        elif key == last_month:
            r["last_month"] += cents

    attempts = (
        await db.execute(
            select(PaymentAttempt.org_id, PaymentAttempt.amount_cents, PaymentAttempt.created_at).where(
                PaymentAttempt.status == "success",
                PaymentAttempt.reference.like("vb%"),
                ~PaymentAttempt.reference.like("vbw_%"),
                ~PaymentAttempt.reference.like("vbc_%"),
            )
        )
    ).all()
    for org_id, cents, created in attempts:
        add(org_id, "online", int(cents), created)

    manual = (
        await db.execute(
            select(Invoice.org_id, Invoice.total_cents, Invoice.updated_at).where(
                Invoice.status == "paid", Invoice.paid_via.like(f"{MANUAL_PREFIX}%")
            )
        )
    ).all()
    for org_id, cents, updated in manual:
        add(org_id, "manual", int(cents), updated)

    unpaid = dict(
        (
            await db.execute(
                select(Invoice.org_id, func.coalesce(func.sum(Invoice.total_cents), 0))
                .where(Invoice.status.in_(("open", "failed")))
                .group_by(Invoice.org_id)
            )
        ).all()
    )
    for org_id in unpaid:
        row(org_id)
    plans = dict((await db.execute(select(BillingSubscription.org_id, BillingSubscription.plan))).all())
    wallets = dict((await db.execute(select(LedgerEntry.org_id, func.sum(LedgerEntry.amount_cents)).group_by(LedgerEntry.org_id))).all())
    names = {i: (n, sl) for i, n, sl in (await db.execute(select(Organization.id, Organization.name, Organization.slug))).all()}

    items = []
    for org_id, r in rows.items():
        name, slug = names.get(org_id, (f"School {org_id}", ""))
        items.append({
            "org_id": org_id, "org_name": name, "org_slug": slug, "plan": plans.get(org_id),
            "paid_cents": r["online"] + r["manual"], "paid_online_cents": r["online"], "paid_manual_cents": r["manual"],
            "this_month_cents": r["this_month"], "last_month_cents": r["last_month"], "payments": r["payments"],
            "unpaid_cents": int(unpaid.get(org_id, 0)), "wallet_cents": int(wallets.get(org_id) or 0),
        })
    items.sort(key=lambda i: i["paid_cents"], reverse=True)
    return {
        "currency": "KES",
        "items": items,
        "totals": {
            "paid_cents": sum(i["paid_cents"] for i in items),
            "this_month_cents": sum(i["this_month_cents"] for i in items),
            "unpaid_cents": sum(i["unpaid_cents"] for i in items),
            "schools_paying": sum(1 for i in items if i["paid_cents"]),
        },
    }


async def _check(name: str, probe) -> dict:
    """Run one probe and report ok / fail without letting it break the page."""
    try:
        detail = await probe()
        return {"name": name, "ok": True, "detail": detail}
    except Problem as exc:
        return {"name": name, "ok": False, "detail": str(exc)}
    except Exception as exc:
        logger.warning("health check %s failed: %s", name, exc)
        return {"name": name, "ok": False, "detail": "check failed"}


@router.get("/health")
async def system_health(
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Is the platform healthy? Never returns secrets, only whether they are set."""
    db = db_session
    now = datetime.now(timezone.utc)

    async def database():
        await db.execute(text("SELECT 1"))
        try:
            rev = (await db.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
        except Exception:
            rev = None
        return f"reachable, schema {rev}" if rev else "reachable"

    async def redis_probe():
        client = get_redis_client()
        if client is None:
            raise Problem("not configured")
        client.ping()
        return "reachable"

    async def stuck_live():
        n = (
            await db.execute(
                select(func.count()).select_from(LiveSession).where(
                    LiveSession.status.in_((LiveSessionStatus.LIVE, LiveSessionStatus.READY)),
                    LiveSession.scheduled_at < now - timedelta(hours=8),
                )
            )
        ).scalar_one()
        if n:
            raise Problem(f"{n} live classes still open after 8 hours")
        return "none stuck"

    async def stuck_exams():
        n = (
            await db.execute(
                select(func.count()).select_from(ExamSession).where(
                    ExamSession.status == ExamSessionStatus.IN_PROGRESS.value,
                    ExamSession.deadline_at < now - timedelta(minutes=10),
                )
            )
        ).scalar_one()
        if n:
            raise Problem(f"{n} exam sessions past their deadline and not submitted")
        return "none overdue"

    async def email():
        cfg = get_validbridge_config().mailing_config
        ok = bool(cfg.resend_api_key) if cfg.email_provider == "resend" else bool(cfg.smtp_host)
        if not ok:
            raise Problem("provider not configured")
        return f"{cfg.email_provider} configured"

    async def payments():
        if not billing_enabled():
            raise Problem("billing is switched off (VALIDBRIDGE_BILLING_ENABLED)")
        if not platform_paystack_secret_key():
            raise Problem("Paystack key missing")
        return "billing on, Paystack key set"

    checks = [
        await _check("Database", database),
        await _check("Redis", redis_probe),
        await _check("Email", email),
        await _check("Payments", payments),
        await _check("Live classes", stuck_live),
        await _check("Exam sweeper", stuck_exams),
    ]
    return {"ok": all(c["ok"] for c in checks), "checked_at": now.isoformat(), "checks": checks}
