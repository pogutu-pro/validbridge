"""Front desk (reception) operations.

Everything here is a read, or one of three narrow writes: invite students,
add or remove a student from a group, and resend a class link to one student.
Each call checks the front-desk right for the organisation and then enforces the
limits in ``access``: students only, no role changes, one organisation.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import Assignment
from src.db.courses.courses import Course
from src.db.courses.exams import ExamSettings, ExamSession, ExamSessionStatus
from src.db.live_sessions import LiveSession, LiveSessionStatus
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import InternalUser, PublicUser, User
from src.services.frontdesk.access import get_org, is_student_in_org, require_frontdesk, student_role_id

logger = logging.getLogger(__name__)

MAX_PAGE = 50
MAX_INVITES = 50
MAX_TEXT = 120


def _name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _like(value: str) -> str:
    escaped = value.strip()[:MAX_TEXT].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def _student_by_uuid(db: AsyncSession, org_id: int, user_uuid: str) -> User:
    student = (await db.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    # The same 404 for "no such person" and "not a student here": the front desk
    # must not be able to probe who the staff are.
    if student is None or not await is_student_in_org(db, student.id, org_id):
        raise HTTPException(status_code=404, detail="Student not found")
    return student


async def _groups_for(db: AsyncSession, org_id: int, user_ids: list[int]) -> dict[int, list[dict]]:
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(UserGroupUser.user_id, UserGroup.id, UserGroup.name)
            .join(UserGroup, UserGroup.id == UserGroupUser.usergroup_id)
            .where(UserGroupUser.user_id.in_(user_ids), UserGroup.org_id == org_id)
            .order_by(UserGroup.name)
        )
    ).all()
    out: dict[int, list[dict]] = {}
    for uid, gid, gname in rows:
        out.setdefault(uid, []).append({"id": gid, "name": gname})
    return out


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------


async def list_students(
    request: Request, db: AsyncSession, user, org_id: int, *, search: str = "", group_id: Optional[int] = None, page: int = 1, limit: int = 20
) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "read")
    role_id = await student_role_id(db)
    page, limit = max(page, 1), max(1, min(limit, MAX_PAGE))

    base = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .where(UserOrganization.org_id == org.id, UserOrganization.role_id == role_id)
    )
    if search.strip():
        pattern = _like(search)
        base = base.where(
            or_(
                User.first_name.ilike(pattern, escape="\\"),
                User.last_name.ilike(pattern, escape="\\"),
                User.username.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    if group_id is not None:
        base = base.where(
            User.id.in_(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group_id, UserGroupUser.org_id == org.id))
        )
    total = int((await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0)
    users = (
        await db.execute(base.order_by(User.first_name, User.last_name, User.id).offset((page - 1) * limit).limit(limit))
    ).scalars().all()

    ids = [u.id for u in users]
    groups = await _groups_for(db, org.id, ids)
    course_counts: dict[int, int] = {}
    if ids:
        course_counts = {
            uid: n
            for uid, n in (
                await db.execute(
                    select(TrailRun.user_id, func.count(func.distinct(TrailRun.course_id)))
                    .where(TrailRun.user_id.in_(ids), TrailRun.org_id == org.id)
                    .group_by(TrailRun.user_id)
                )
            ).all()
        }
    items = [
        {
            "user_uuid": u.user_uuid, "name": _name(u), "username": u.username, "email": u.email,
            "avatar_image": u.avatar_image or "", "email_verified": bool(u.email_verified),
            "last_login_at": u.last_login_at, "groups": groups.get(u.id, []), "courses_enrolled": int(course_counts.get(u.id, 0)),
        }
        for u in users
    ]
    return {"items": items, "total": total, "page": page, "limit": limit}


def _scalar_details(extra: Optional[dict]) -> dict:
    """What the student told the school at sign-up (phone, admission number, and so on)."""
    out = {}
    for key, value in (extra or {}).items():
        if isinstance(value, (str, int, float, bool)) and len(str(value)) <= 300:
            out[str(key)[:60]] = value
    return out


async def _course_access(db: AsyncSession, course: Course, student_id: int) -> str:
    """free | paid | unpaid | unknown: read-only, from the platform's own paywall check."""
    try:
        from src.services.payments.payments_access import check_enrollment_access, get_paywall_offer

        if await get_paywall_offer(course.course_uuid, db) is None:
            return "free"
        return "paid" if await check_enrollment_access(course.course_uuid, student_id, db) else "unpaid"
    except Exception:
        logger.warning("Front desk: could not read payment status for course %s", course.course_uuid, exc_info=True)
        return "unknown"


async def student_card(request: Request, db: AsyncSession, user, org_id: int, user_uuid: str) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "read")
    student = await _student_by_uuid(db, org.id, user_uuid)

    courses = (
        await db.execute(
            select(Course)
            .join(TrailRun, TrailRun.course_id == Course.id)
            .where(TrailRun.user_id == student.id, Course.org_id == org.id)
            .distinct()
            .order_by(Course.name)
        )
    ).scalars().all()
    rows = []
    for course in courses:
        total = int((await db.execute(select(func.count()).select_from(Activity).where(Activity.course_id == course.id))).scalar() or 0)
        done = int(
            (
                await db.execute(
                    select(func.count(func.distinct(TrailStep.activity_id))).where(
                        TrailStep.user_id == student.id, TrailStep.course_id == course.id, TrailStep.complete.is_(True)
                    )
                )
            ).scalar()
            or 0
        )
        rows.append({
            "course_uuid": course.course_uuid, "name": course.name, "activities_total": total, "activities_done": min(done, total),
            "progress_percent": round(100 * min(done, total) / total) if total else 0, "access": await _course_access(db, course, student.id),
        })
    groups = (await _groups_for(db, org.id, [student.id])).get(student.id, [])
    return {
        "user_uuid": student.user_uuid, "name": _name(student), "username": student.username, "email": student.email,
        "email_verified": bool(student.email_verified), "joined": student.creation_date, "last_login_at": student.last_login_at,
        "details": _scalar_details(student.extra_metadata), "groups": groups, "courses": rows,
    }


# ---------------------------------------------------------------------------
# Invitations and groups
# ---------------------------------------------------------------------------


class InviteStudents(BaseModel):
    emails: list[str] = PydanticField(min_length=1, max_length=MAX_INVITES)


async def invite_students(request: Request, db: AsyncSession, user, org_id: int, payload: InviteStudents) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "create")
    from src.services.orgs.users import invite_batch_users

    # People who accept an invitation sign up with the default learner role. This
    # call has no role parameter, so the front desk cannot invite anyone as staff.
    emails = ",".join(e.strip() for e in payload.emails if e and e.strip())
    result = await invite_batch_users(request, org.id, emails, None, db, user, authorized=True)
    return result if isinstance(result, dict) else {"results": result}


async def list_groups(request: Request, db: AsyncSession, user, org_id: int) -> list[dict]:
    org = await require_frontdesk(request, db, user, org_id, "read")
    groups = (await db.execute(select(UserGroup).where(UserGroup.org_id == org.id).order_by(UserGroup.name))).scalars().all()
    counts = {
        gid: n
        for gid, n in (
            await db.execute(
                select(UserGroupUser.usergroup_id, func.count()).where(UserGroupUser.org_id == org.id).group_by(UserGroupUser.usergroup_id)
            )
        ).all()
    }
    return [{"id": g.id, "name": g.name, "members": int(counts.get(g.id, 0))} for g in groups]


async def _group_in_org(db: AsyncSession, org_id: int, usergroup_id: int) -> UserGroup:
    group = await db.get(UserGroup, usergroup_id)
    if group is None or group.org_id != org_id:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


async def add_to_group(request: Request, db: AsyncSession, user, org_id: int, usergroup_id: int, user_uuid: str) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "update")
    group = await _group_in_org(db, org.id, usergroup_id)
    student = await _student_by_uuid(db, org.id, user_uuid)
    from src.services.users.usergroups import add_users_to_usergroup

    await add_users_to_usergroup(request, db, InternalUser(), group.id, str(student.id))
    return {"added": True}


async def remove_from_group(request: Request, db: AsyncSession, user, org_id: int, usergroup_id: int, user_uuid: str) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "update")
    group = await _group_in_org(db, org.id, usergroup_id)
    student = await _student_by_uuid(db, org.id, user_uuid)
    from src.services.users.usergroups import remove_users_from_usergroup

    await remove_users_from_usergroup(request, db, InternalUser(), group.id, str(student.id))
    return {"removed": True}


# ---------------------------------------------------------------------------
# Class and exam days
# ---------------------------------------------------------------------------


async def today(request: Request, db: AsyncSession, user, org_id: int, *, days: int = 7) -> dict:
    """What is on in the next few days: live classes and exams, with who is sitting."""
    org = await require_frontdesk(request, db, user, org_id, "read")
    now = datetime.now(timezone.utc)
    days = max(1, min(days, 30))
    horizon = now + timedelta(days=days)

    sessions = (
        await db.execute(
            select(LiveSession, Course.name, Course.course_uuid)
            .join(Course, Course.id == LiveSession.course_id)
            .where(
                LiveSession.org_id == org.id,
                LiveSession.status.in_([LiveSessionStatus.SCHEDULED, LiveSessionStatus.READY, LiveSessionStatus.LIVE]),
                LiveSession.scheduled_at <= horizon,
            )
            .order_by(LiveSession.scheduled_at)
            .limit(100)
        )
    ).all()
    classes = [
        {
            "session_uuid": s.session_uuid, "title": s.title, "course": cname, "course_uuid": cuuid,
            "scheduled_at": _aware(s.scheduled_at), "status": s.status.value if hasattr(s.status, "value") else str(s.status),
        }
        for s, cname, cuuid in sessions
    ]

    exam_rows = (
        await db.execute(
            select(ExamSettings, Assignment, Course.name)
            .join(Assignment, Assignment.id == ExamSettings.assignment_id)
            .join(Course, Course.id == ExamSettings.course_id)
            .where(ExamSettings.org_id == org.id, ExamSettings.enabled.is_(True))
        )
    ).all()
    exams = []
    for settings, assignment, cname in exam_rows:
        opens, closes = _aware(settings.opens_at), _aware(settings.closes_at)
        if closes and closes < now - timedelta(hours=6):
            continue  # finished a while ago
        if opens and opens > horizon:
            continue
        counts = {
            status: n
            for status, n in (
                await db.execute(
                    select(ExamSession.status, func.count()).where(ExamSession.assignment_id == assignment.id).group_by(ExamSession.status)
                )
            ).all()
        }
        exams.append({
            "assignment_uuid": assignment.assignment_uuid, "title": assignment.title, "course": cname, "opens_at": opens, "closes_at": closes,
            "duration_minutes": settings.duration_minutes, "in_progress": int(counts.get(ExamSessionStatus.IN_PROGRESS.value, 0)),
            "submitted": int(counts.get(ExamSessionStatus.SUBMITTED.value, 0)),
        })
    exams.sort(key=lambda e: (e["opens_at"] is None, e["opens_at"] or now))
    return {"classes": classes, "exams": exams, "server_time": now}


async def exam_roster(request: Request, db: AsyncSession, user, org_id: int, assignment_uuid: str):
    """The same live roster staff see, read-only: who has started, who is missing."""
    org = await require_frontdesk(request, db, user, org_id, "read")
    assignment = (
        await db.execute(select(Assignment).where(Assignment.assignment_uuid == assignment_uuid, Assignment.org_id == org.id))
    ).scalars().first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    from src.services.courses.activities.exams import build_monitor

    roster = await build_monitor(request, db, assignment)
    # The front desk sees status and connection, not the exam's supervision detail.
    for row in roster.students:
        row.violation_count = 0
    roster.counts["flagged"] = 0
    return roster


class ResendLink(BaseModel):
    user_uuid: str = PydanticField(max_length=64)


async def resend_class_link(request: Request, db: AsyncSession, user, org_id: int, session_uuid: str, payload: ResendLink) -> dict:
    org = await require_frontdesk(request, db, user, org_id, "update")
    session = (
        await db.execute(select(LiveSession).where(LiveSession.session_uuid == session_uuid, LiveSession.org_id == org.id))
    ).scalars().first()
    if session is None:
        raise HTTPException(status_code=404, detail="Class not found")
    student = await _student_by_uuid(db, org.id, payload.user_uuid)
    from src.services.live import invitations

    # At most 3 resends per student per class per hour, so this cannot be used to spam one inbox.
    await invitations._throttle(f"{session_uuid}:{student.user_uuid}", limit=3)
    # The email names who is inviting: the class's instructor, or failing that the front desk.
    instructor = await db.get(User, session.instructor_id) if session.instructor_id else None
    sender = PublicUser.model_validate(instructor) if instructor else user
    result = await invitations.send_invitations(
        request, db, sender, session_uuid, invitations.LiveInvitationCreate(emails=[student.email]), authorized=True, throttle=False
    )
    return {"queued": result.queued}
