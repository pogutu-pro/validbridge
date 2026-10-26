"""Command center and platform-wide monitors for the superadmin console.

Read-only. The command center answers "what needs me right now": money to chase,
subscriptions about to change, suspended schools, and what is live this minute.
The monitors list every live class and every exam in progress across all schools.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.billing import BillingSubscription, Invoice
from src.db.courses.assignments import Assignment
from src.db.courses.exams import ExamSession, ExamSessionStatus
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.org_suspensions import OrgSuspension
from src.db.organizations import Organization
from src.db.users import User
from src.security.staff import require_staff

router = APIRouter()

LIST_LIMIT = 10
# A student whose browser has been silent this long is shown as disconnected.
STALE_SECONDS = 30


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def _org_names(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = (await db.execute(select(Organization.id, Organization.name).where(Organization.id.in_(ids)))).all()
    return {i: n for i, n in rows}


async def _live_now(db: AsyncSession, limit: int | None = None) -> list[dict]:
    q = select(LiveSession).where(LiveSession.status == LiveSessionStatus.LIVE).order_by(LiveSession.id.desc())
    if limit:
        q = q.limit(limit)
    sessions = (await db.execute(q)).scalars().all()
    names = await _org_names(db, {s.org_id for s in sessions})
    return [
        {"session_uuid": s.session_uuid, "title": s.title, "org_id": s.org_id, "org_name": names.get(s.org_id)}
        for s in sessions
    ]


async def _exams_in_progress(db: AsyncSession) -> list[dict]:
    """One row per exam that has students sitting it right now."""
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(Assignment.id, Assignment.title, Assignment.org_id, ExamSession)
            .join(ExamSession, ExamSession.assignment_id == Assignment.id)
            .where(ExamSession.status == ExamSessionStatus.IN_PROGRESS.value)
        )
    ).all()
    exams: dict[int, dict] = {}
    for assignment_id, title, org_id, session in rows:
        exam = exams.setdefault(
            assignment_id,
            {"assignment_id": assignment_id, "title": title, "org_id": org_id, "students": 0, "disconnected": 0, "violations": 0, "ends_at": None},
        )
        exam["students"] += 1
        exam["violations"] += session.violation_count or 0
        last_seen = _aware(session.last_seen_at)
        if last_seen is None or (now - last_seen).total_seconds() > STALE_SECONDS:
            exam["disconnected"] += 1
        deadline = _aware(session.deadline_at)
        if deadline and (exam["ends_at"] is None or deadline.isoformat() > exam["ends_at"]):
            exam["ends_at"] = deadline.isoformat()
    names = await _org_names(db, {e["org_id"] for e in exams.values()})
    out = sorted(exams.values(), key=lambda e: e["students"], reverse=True)
    for e in out:
        e["org_name"] = names.get(e["org_id"])
    return out


@router.get("/command-center")
async def command_center(
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    db = db_session
    now = datetime.now(timezone.utc)

    totals = {
        "schools": (await db.execute(select(func.count()).select_from(Organization))).scalar_one(),
        "suspended": (await db.execute(select(func.count()).select_from(OrgSuspension))).scalar_one(),
        "people": (await db.execute(select(func.count()).select_from(User))).scalar_one(),
    }

    overdue = (
        await db.execute(
            select(Invoice).where(Invoice.status.in_(("open", "failed"))).order_by(Invoice.created_at).limit(LIST_LIMIT)
        )
    ).scalars().all()
    unpaid_total = (
        await db.execute(
            select(func.count(), func.coalesce(func.sum(Invoice.total_cents), 0)).where(Invoice.status.in_(("open", "failed")))
        )
    ).one()

    # Plans that change soon: trials ending, scheduled downgrades.
    changing = (
        await db.execute(
            select(BillingSubscription)
            .where(
                BillingSubscription.pending_plan.is_not(None),
                BillingSubscription.period_end.is_not(None),
                BillingSubscription.period_end <= now + timedelta(days=7),
            )
            .order_by(BillingSubscription.period_end)
            .limit(LIST_LIMIT)
        )
    ).scalars().all()

    suspended = (await db.execute(select(OrgSuspension).order_by(OrgSuspension.suspended_at.desc()).limit(LIST_LIMIT))).scalars().all()
    live = await _live_now(db, LIST_LIMIT)
    exams = await _exams_in_progress(db)

    names = await _org_names(
        db, {i.org_id for i in overdue} | {s.org_id for s in changing} | {s.org_id for s in suspended}
    )
    return {
        "totals": totals,
        "unpaid": {"count": int(unpaid_total[0]), "cents": int(unpaid_total[1])},
        "overdue_invoices": [
            {"org_id": i.org_id, "org_name": names.get(i.org_id), "number": i.number, "total_cents": i.total_cents,
             "status": i.status, "created_at": _iso(i.created_at)}
            for i in overdue
        ],
        "plan_changes_soon": [
            {"org_id": s.org_id, "org_name": names.get(s.org_id), "plan": s.plan, "pending_plan": s.pending_plan, "on": _iso(s.period_end)}
            for s in changing
        ],
        "suspended_schools": [
            {"org_id": s.org_id, "org_name": names.get(s.org_id), "reason": s.reason, "since": _iso(s.suspended_at)}
            for s in suspended
        ],
        "live_now": live,
        "exams_now": exams[:LIST_LIMIT],
        "exam_students_now": sum(e["students"] for e in exams),
    }


@router.get("/monitor/live")
async def monitor_live(
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    return {"items": await _live_now(db_session)}


@router.get("/monitor/exams")
async def monitor_exams(
    current_user: Any = Depends(require_staff("read")),
    db_session: AsyncSession = Depends(get_db_session),
):
    return {"items": await _exams_in_progress(db_session)}
