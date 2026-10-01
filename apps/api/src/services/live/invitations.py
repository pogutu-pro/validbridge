"""Email invitations to a live lesson.

The invitation is simply the classroom link: opening it still goes through the
full access check (course access, paywall, locks), and a student who can see
the course but hasn't enrolled gets a one-click "Enroll & join". So an email
never grants access by itself — it only makes it easy to arrive.

Emails reuse the organization-branded layout, sender name and base URL of the
existing org invitation emails, and are sent in the background so a large
class doesn't hold the request.
"""

import asyncio
import html
import logging
from datetime import timedelta
from typing import Optional
from urllib.parse import urlencode

from fastapi import HTTPException, Request
from pydantic import BaseModel, EmailStr, Field as PydanticField
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.live_sessions import LiveSession
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User
from src.services.live.attendance import as_utc
from src.services.live.reporting import enrolled_user_ids

logger = logging.getLogger(__name__)

MAX_RECIPIENTS = 500
# Per-session send budget so an invite button can't be turned into a spam cannon.
_SENDS_PER_HOUR = 5
_background: set = set()


class LiveInvitationCreate(BaseModel):
    emails: list[EmailStr] = PydanticField(default_factory=list, max_length=100)
    all_enrolled: bool = False
    message: Optional[str] = PydanticField(default=None, max_length=500)


class LiveInvitationResult(BaseModel):
    queued: int


def classroom_path(course_uuid: str, session_uuid: str) -> str:
    return (
        f"/course/{course_uuid.removeprefix('course_')}"
        f"/live/{session_uuid.removeprefix('livesession_')}"
    )


def google_calendar_url(title: str, details: str, start, minutes: int = 60) -> str:
    start = as_utc(start)
    end = start + timedelta(minutes=minutes)
    fmt = "%Y%m%dT%H%M%SZ"
    return "https://calendar.google.com/calendar/render?" + urlencode(
        {"action": "TEMPLATE", "text": title, "details": details, "dates": f"{start:{fmt}}/{end:{fmt}}"}
    )


def _email_html(
    *, org_name: str, lecturer: str, title: str, course_name: str, when: str, join_url: str,
    calendar_url: str, message: Optional[str], branding: dict,
) -> tuple[str, str]:
    from src.services.users.emails import STYLES, _brand_logo_html, _button_style, _email_layout

    safe = {k: html.escape(v) for k, v in {
        "lecturer": lecturer, "title": title, "course": course_name, "when": when, "org": org_name,
    }.items()}
    note = ""
    if message:
        note = f'<p style="{STYLES["p"]}"><em>&ldquo;{html.escape(message)}&rdquo;</em></p>'
    body = f"""
        <h1 style="{STYLES['h1']}">{safe['title']}</h1>
        <p style="{STYLES['p']}">
            {safe['lecturer']} invited you to a live lesson in <strong>{safe['course']}</strong>.
        </p>
        <p style="{STYLES['p']}"><strong>{safe['when']}</strong></p>
        {note}
        <a href="{html.escape(join_url, quote=True)}" style="{_button_style(branding.get('brand_color'))}">Join the live lesson</a>
        <p style="{STYLES['p']}; margin-top: 24px;">
            <a href="{html.escape(calendar_url, quote=True)}">Add to Google Calendar</a>
            &nbsp;·&nbsp; Or open: {html.escape(join_url)}
        </p>
    """
    subject = f"Live lesson: {title} — {course_name}"
    layout = _email_layout(
        title=safe["title"],
        body_content=body,
        footer_note=f"You received this because you're a student of {safe['org']} on LiveBridge.",
        logo_html=_brand_logo_html(branding.get("logo_url"), org_name),
        powered_by=branding.get("powered_by", True),
        preheader=f"{safe['lecturer']} · {safe['when']}",
        lang="en",
    )
    return subject, layout


async def _throttle(session_uuid: str) -> None:
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return
        key = f"validbridge:live:invites:{session_uuid}"
        count = await asyncio.to_thread(client.incr, key)
        if count == 1:
            await asyncio.to_thread(client.expire, key, 3600)
    except Exception:  # pragma: no cover - Redis is an optimisation
        return
    if count > _SENDS_PER_HOUR:
        from src.services.live.sessions import _error

        raise _error(429, "SLOW_DOWN", "Too many invitations for this lesson. Try again later.")


async def send_invitations(
    request: Request, db: AsyncSession, user, session_uuid: str, payload: LiveInvitationCreate
) -> LiveInvitationResult:
    from src.services.email.branding import resolve_org_email_branding
    from src.services.email.utils import get_org_signup_base_url, send_email
    from src.services.live.sessions import _get_course, _require_staff, _require_user, get_session_by_uuid
    from src.services.security.profile_validation import sanitize_display_name
    from src.db.live_sessions import ACTIVE_STATUSES, LiveSessionStatus

    user = _require_user(user)
    session: LiveSession = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)
    if session.status not in (LiveSessionStatus.SCHEDULED, *ACTIVE_STATUSES):
        from src.services.live.sessions import _error

        raise _error(409, "SESSION_ENDED", "This lesson has ended")

    recipients = {str(e).strip().lower() for e in payload.emails}
    if payload.all_enrolled:
        ids = await enrolled_user_ids(db, course.id)
        if ids:
            recipients |= {
                (email or "").strip().lower()
                for email in (await db.execute(select(User.email).where(User.id.in_(ids)))).scalars().all()
                if email
            }
    recipients.discard(str(user.email).strip().lower())
    recipients = {r for r in recipients if "@" in r}
    if not recipients:
        raise HTTPException(status_code=422, detail="Add at least one email or choose all enrolled students")
    if len(recipients) > MAX_RECIPIENTS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_RECIPIENTS} recipients per send")
    await _throttle(session.session_uuid)

    org = await db.get(Organization, course.org_id)
    org_config = (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
    ).scalars().first()
    branding = resolve_org_email_branding(org, org_config, request).as_kwargs()
    base_url = (await get_org_signup_base_url(org.slug, request, db_session=db, org_id=org.id)).rstrip("/")
    join_url = f"{base_url}{classroom_path(course.course_uuid, session.session_uuid)}"
    start = as_utc(session.started_at or session.scheduled_at)
    when = f"{start:%A %d %B %Y, %H:%M} UTC" if session.status == LiveSessionStatus.SCHEDULED else "Happening now"
    lecturer = sanitize_display_name(
        f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username
    )
    subject, body = _email_html(
        org_name=sanitize_display_name(org.name, fallback="Your school"),
        lecturer=lecturer,
        title=session.title,
        course_name=course.name,
        when=when,
        join_url=join_url,
        calendar_url=google_calendar_url(session.title, f"{course.name}\n{join_url}", start),
        message=(payload.message or "").strip() or None,
        branding=branding,
    )
    sender_name = branding.get("sender_name")

    # Live-class invitations are engagement mail (W4e): on the hosted service
    # they need managed email (counted against its quota) or the org's own
    # provider. Only what the quota covers is sent.
    from src.services.email.utils import gate_engagement_email

    ordered = sorted(recipients)
    allowed = await gate_engagement_email(org.id, db, len(ordered))
    ordered = ordered[:allowed]
    if not ordered:
        logger.info("Live session %s: invitations not sent (email_not_enabled)", session_uuid)
        return LiveInvitationResult(queued=0)

    async def _deliver(addresses: list[str]) -> None:
        sent = 0
        for address in addresses:
            try:
                await asyncio.to_thread(send_email, address, subject, body, None, sender_name)
                sent += 1
            except Exception:
                logger.warning("Live invite to %s failed", address, exc_info=True)
        logger.info("Live session %s: %s/%s invitations sent", session_uuid, sent, len(addresses))

    task = asyncio.create_task(_deliver(ordered))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return LiveInvitationResult(queued=len(ordered))

