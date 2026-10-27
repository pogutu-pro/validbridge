"""What each school collects from its own students, for the platform owner.

This is the schools' own sales (course and bundle offers paid through Paystack),
not what they pay ValidBridge. Figures come from the processed payment webhook
ledger, so they cover payments the platform was told about. Amounts are in minor
units (cents) and kept per currency. Only school-level totals are exposed, never
individual students or payments. Owner and Finance only: it is private business
data of each school. Opening one school's detail is audited.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.payments.payments_enrollments import EnrollmentStatusEnum, PaymentsEnrollment
from src.db.payments.payments_events import PaymentsEvent
from src.db.payments.payments_offers import PaymentsOffer
from src.routers.superadmin import _acting_user_id
from src.security.staff import require_staff
from src.services.audit.superadmin_audit import record_superadmin_action
from src.services.payments import paystack
from src.services.payments.service import _amount_paid, _pays_in_parts

router = APIRouter()

PAYMENT_EVENT = "charge.success"
REFUND_EVENTS = ("refund.processed", "charge.refunded")
MONTHS = 12


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _month(value: datetime) -> str:
    return _aware(value).strftime("%Y-%m")


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _parse(event: PaymentsEvent) -> dict | None:
    """One payment or refund out of a stored webhook, or None if it is not for a school."""
    data = (event.payload or {}).get("data") or {}
    reference = data.get("reference") or data.get("transaction_reference") or (data.get("transaction") or {}).get("reference")
    org_id = paystack.reference_to_org_id(reference or "")
    if org_id is None:
        return None
    metadata = data.get("metadata") or {}
    if event.event_type == PAYMENT_EVENT:
        if data.get("status") != "success":
            return None
        amount = _int(data.get("amount")) - _int(metadata.get("fee_minor"))  # what the school is owed, not the processing fee
        sign = 1
    else:
        amount = _int(data.get("amount"))
        sign = -1
    return {
        "org_id": org_id, "currency": str(data.get("currency") or "KES").upper(), "amount": max(amount, 0) * sign,
        "paid": sign == 1, "at": event.processed_at, "reference": reference,
        "offer_id": _int(metadata.get("offer_id")) or None, "user_id": _int(metadata.get("user_id")) or None,
    }


async def _movements(db: AsyncSession) -> list[dict]:
    rows = (
        await db.execute(
            select(PaymentsEvent).where(PaymentsEvent.event_type.in_((PAYMENT_EVENT, *REFUND_EVENTS))).order_by(PaymentsEvent.id)
        )
    ).scalars().all()
    return [m for m in (_parse(e) for e in rows) if m]


async def _outstanding(db: AsyncSession) -> dict[tuple[int, str], int]:
    """What students of each school still owe on offers they are paying in parts."""
    rows = (
        await db.execute(
            select(PaymentsEnrollment, PaymentsOffer)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsEnrollment.offer_id)
            .where(PaymentsEnrollment.status == EnrollmentStatusEnum.completed, PaymentsOffer.total_amount.is_not(None))
        )
    ).all()
    owed: dict[tuple[int, str], int] = defaultdict(int)
    for enrollment, offer in rows:
        if _pays_in_parts(offer):
            owed[(offer.org_id, (offer.currency or "KES").upper())] += round(max(offer.total_amount - _amount_paid(enrollment, offer), 0) * 100)
    return owed


@router.get("/schools-revenue")
async def schools_revenue(
    current_user: Any = Depends(require_staff("revenue_read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    db = db_session
    now = datetime.now(timezone.utc)
    this_month = _month(now)
    year, month = (now.year, now.month - 1) if now.month > 1 else (now.year - 1, 12)
    last_month = f"{year:04d}-{month:02d}"

    per_school: dict[tuple[int, str], dict] = {}
    buyers: dict[tuple[int, str], set] = defaultdict(set)
    for m in await _movements(db):
        key = (m["org_id"], m["currency"])
        row = per_school.setdefault(key, {"collected": 0, "refunded": 0, "this_month": 0, "last_month": 0, "payments": 0})
        if m["paid"]:
            row["collected"] += m["amount"]
            row["payments"] += 1
            if m["user_id"]:
                buyers[key].add(m["user_id"])
            month_key = _month(m["at"])
            if month_key == this_month:
                row["this_month"] += m["amount"]
            elif month_key == last_month:
                row["last_month"] += m["amount"]
        else:
            row["refunded"] += -m["amount"]

    owed = await _outstanding(db)
    for key in owed:
        per_school.setdefault(key, {"collected": 0, "refunded": 0, "this_month": 0, "last_month": 0, "payments": 0})

    names = {i: (n, s) for i, n, s in (await db.execute(select(Organization.id, Organization.name, Organization.slug))).all()}
    items = []
    for (org_id, currency), row in per_school.items():
        name, slug = names.get(org_id, (f"School {org_id}", ""))
        items.append({
            "org_id": org_id, "org_name": name, "org_slug": slug, "currency": currency,
            "collected_cents": row["collected"], "refunded_cents": row["refunded"], "net_cents": row["collected"] - row["refunded"],
            "this_month_cents": row["this_month"], "last_month_cents": row["last_month"],
            "payments": row["payments"], "buyers": len(buyers[(org_id, currency)]), "outstanding_cents": owed.get((org_id, currency), 0),
        })
    items.sort(key=lambda i: i["net_cents"], reverse=True)

    totals: dict[str, dict] = {}
    for i in items:
        t = totals.setdefault(i["currency"], {"currency": i["currency"], "net_cents": 0, "this_month_cents": 0, "outstanding_cents": 0, "schools": 0})
        t["net_cents"] += i["net_cents"]
        t["this_month_cents"] += i["this_month_cents"]
        t["outstanding_cents"] += i["outstanding_cents"]
        t["schools"] += 1 if i["net_cents"] else 0
    return {"items": items, "totals": list(totals.values())}


@router.get("/schools-revenue/{org_id}")
async def school_revenue_detail(
    org_id: int,
    request: Request,
    current_user: Any = Depends(require_staff("revenue_read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    db = db_session
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="School not found")
    await record_superadmin_action(
        db, _acting_user_id(current_user), "revenue.view", org_id=org_id, request=request, diff_only=False,
    )

    moves = [m for m in await _movements(db) if m["org_id"] == org_id]
    offer_ids = {m["offer_id"] for m in moves if m["offer_id"]}
    offer_names = dict((await db.execute(select(PaymentsOffer.id, PaymentsOffer.name).where(PaymentsOffer.id.in_(offer_ids)))).all()) if offer_ids else {}

    monthly: dict[tuple[str, str], int] = defaultdict(int)
    by_offer: dict[tuple[int | None, str], dict] = {}
    for m in moves:
        monthly[(_month(m["at"]), m["currency"])] += m["amount"]
        if m["paid"]:
            row = by_offer.setdefault((m["offer_id"], m["currency"]), {"payments": 0, "collected": 0})
            row["payments"] += 1
            row["collected"] += m["amount"]

    now = datetime.now(timezone.utc)
    months = []
    year, month = now.year, now.month
    for _ in range(MONTHS):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    months.reverse()
    currencies = sorted({c for _, c in monthly}) or ["KES"]
    return {
        "org": {"id": org.id, "name": org.name, "slug": org.slug},
        "monthly": [{"month": mo, "currency": c, "cents": monthly.get((mo, c), 0)} for c in currencies for mo in months],
        "offers": sorted(
            ({"offer_id": oid, "name": offer_names.get(oid, "Deleted offer" if oid else "Unknown"), "currency": cur, **row} for (oid, cur), row in by_offer.items()),
            key=lambda o: o["collected"], reverse=True,
        ),
    }
