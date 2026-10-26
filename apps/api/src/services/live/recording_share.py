"""Share a lesson's recording with the students who missed the live lesson.

Recordings exist for the people who could not be there. Two ways they reach them:

* automatically, when a recording becomes ready and its lesson is published
  (``auto_share``), once per lesson;
* by staff, with the Share action (``share_recording_api``), which can publish a
  draft recording first and can include everyone instead of only the absentees.

"Missed" means enrolled in the course and never connected to the lesson. The email
links to the recording lesson, and opening it still goes through the normal access
checks (enrolment, paywall, locks), so an email never grants access by itself.
"""

import asyncio
import html
import logging
from typing import Optional

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityUpdate
from src.db.courses.courses import Course
from src.db.live_sessions import LiveRecording, LiveRecordingShare, LiveRecordingState, LiveSession, LiveSessionParticipant, utcnow
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User
from src.services.live.attendance import as_utc
from src.services.live.reporting import enrolled_user_ids

logger = logging.getLogger(__name__)

MANUAL_SHARES_PER_HOUR = 3


async def missed_students(db: AsyncSession, session: LiveSession) -> list[User]:
    """Enrolled students with no connection to this lesson."""
    enrolled = set(await enrolled_user_ids(db, session.course_id))
    if not enrolled:
        return []
    attended = set(
        (
            await db.execute(
                select(LiveSessionParticipant.user_id).where(
                    LiveSessionParticipant.session_id == session.id, LiveSessionParticipant.connection_count > 0
                )
            )
        ).scalars().all()
    )
    ids = enrolled - attended
    if not ids:
        return []
    return list((await db.execute(select(User).where(User.id.in_(ids)).order_by(User.id))).scalars().all())


def _email_html(*, org_name: str, lecturer: str, title: str, course_name: str, when: str, watch_url: str, missed: bool, branding: dict) -> tuple[str, str]:
    from src.services.users.emails import STYLES, _brand_logo_html, _button_style, _email_layout

    safe = {k: html.escape(v) for k, v in {"lecturer": lecturer, "title": title, "course": course_name, "when": when, "org": org_name}.items()}
    lead = (
        f"You missed the live lesson <strong>{safe['title']}</strong> in <strong>{safe['course']}</strong> ({safe['when']})."
        if missed
        else f"The recording of the live lesson <strong>{safe['title']}</strong> in <strong>{safe['course']}</strong> ({safe['when']}) is ready."
    )
    body = f"""
        <h1 style="{STYLES['h1']}">{'Catch up on the lesson you missed' if missed else 'Lesson recording available'}</h1>
        <p style="{STYLES['p']}">{lead}</p>
        <p style="{STYLES['p']}">{safe['lecturer']} shared the recording with you. Watch it whenever suits you.</p>
        <a href="{html.escape(watch_url, quote=True)}" style="{_button_style(branding.get('brand_color'))}">Watch the recording</a>
        <p style="{STYLES['p']}; margin-top: 24px;">Or open: {html.escape(watch_url)}</p>
    """
    layout = _email_layout(
        title=safe["title"],
        body_content=body,
        footer_note=f"You received this because you're a student of {safe['org']} on LiveBridge.",
        logo_html=_brand_logo_html(branding.get("logo_url"), org_name),
        powered_by=branding.get("powered_by", True),
        preheader=f"Recording: {safe['title']}",
        lang="en",
    )
    subject = f"You missed {title}: watch the recording" if missed else f"Recording available: {title}"
    return subject, layout


async def share_recording(
    request: Optional[Request], db: AsyncSession, session: LiveSession, activity: Activity, *, audience: str = "absent", sender: Optional[User] = None
) -> int:
    """Email the recording link to the audience. Returns how many emails were queued; never raises."""
    try:
        from src.services.email.branding import resolve_org_email_branding
        from src.services.email.utils import gate_engagement_email, get_org_signup_base_url, send_email
        from src.services.live import invitations
        from src.services.security.profile_validation import sanitize_display_name

        course = await db.get(Course, session.course_id)
        org = await db.get(Organization, session.org_id)
        if course is None or org is None:
            return 0
        if audience == "everyone":
            ids = await enrolled_user_ids(db, session.course_id)
            people = list((await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()) if ids else []
        else:
            people = await missed_students(db, session)
        instructor = await db.get(User, session.instructor_id) if session.instructor_id else None
        sender_user = instructor or sender
        skip = {(sender_user.email or "").strip().lower()} if sender_user and sender_user.email else set()
        recipients = sorted({(u.email or "").strip().lower() for u in people if u.email and "@" in u.email} - skip)
        if not recipients:
            return 0

        org_config = (await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))).scalars().first()
        branding = resolve_org_email_branding(org, org_config, request).as_kwargs()
        base_url = (await get_org_signup_base_url(org.slug, request, db_session=db, org_id=org.id)).rstrip("/")
        watch_url = f"{base_url}/course/{course.course_uuid.removeprefix('course_')}/activity/{activity.activity_uuid.removeprefix('activity_')}"
        start = as_utc(session.started_at or session.scheduled_at)
        lecturer = sanitize_display_name(
            f"{getattr(sender_user, 'first_name', '') or ''} {getattr(sender_user, 'last_name', '') or ''}".strip()
            or getattr(sender_user, "username", "")
            or "Your instructor"
        )
        subject, body = _email_html(
            org_name=sanitize_display_name(org.name, fallback="Your school"), lecturer=lecturer, title=session.title, course_name=course.name,
            when=f"{start:%A %d %B %Y}", watch_url=watch_url, missed=audience != "everyone", branding=branding,
        )
        allowed = await gate_engagement_email(org.id, db, len(recipients))
        recipients = recipients[:allowed]
        if not recipients:
            return 0
        sender_name = branding.get("sender_name")

        async def _deliver(addresses: list[str]) -> None:
            sent = 0
            for address in addresses:
                try:
                    await asyncio.to_thread(send_email, address, subject, body, None, sender_name)
                    sent += 1
                except Exception:
                    logger.warning("Recording email to %s failed", address, exc_info=True)
            logger.info("Live session %s: recording sent to %s/%s students", session.session_uuid, sent, len(addresses))

        task = asyncio.create_task(_deliver(recipients))
        invitations._background.add(task)
        task.add_done_callback(invitations._background.discard)
        session.recording_shared_at = utcnow()
        db.add(session)
        await db.commit()
        return len(recipients)
    except Exception:
        logger.warning("Live session %s: sharing the recording failed", session.session_uuid, exc_info=True)
        try:
            await db.rollback()
        except Exception:  # pragma: no cover
            pass
        return 0


async def auto_share(db: AsyncSession, session: LiveSession, activity: Activity) -> int:
    """When a published recording is ready, send it to the students who missed the lesson, once."""
    if not activity.published or session.recording_shared_at is not None:
        return 0
    return await share_recording(None, db, session, activity, audience="absent")


async def _throttle(session_uuid: str) -> None:
    """At most a few manual shares per lesson per hour, so the button cannot be used to spam inboxes."""
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return
        key = f"validbridge:live:recording-share:{session_uuid}"
        count = await asyncio.to_thread(client.incr, key)
        if count == 1:
            await asyncio.to_thread(client.expire, key, 3600)
    except Exception:  # pragma: no cover - Redis is an optimisation
        return
    if count > MANUAL_SHARES_PER_HOUR:
        from src.services.live.sessions import _error

        raise _error(429, "SLOW_DOWN", "This recording was shared several times already. Try again later.")


async def share_recording_api(request: Request, db: AsyncSession, user, recording_uuid: str, payload: LiveRecordingShare) -> dict:
    from src.services.courses.activities.activities import update_activity
    from src.services.live.sessions import _error, _get_course, _require_staff, _require_user

    user = _require_user(user)
    recording = (await db.execute(select(LiveRecording).where(LiveRecording.recording_uuid == recording_uuid))).scalars().first()
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    session = await db.get(LiveSession, recording.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Live session not found")
    course = await _get_course(db, session.course_id)
    await _require_staff(request, db, user, course)

    if recording.status != LiveRecordingState.READY or recording.activity_id is None:
        raise _error(409, "RECORDING_NOT_READY", "The recording is not ready yet")
    activity = await db.get(Activity, recording.activity_id)
    if activity is None:
        raise _error(409, "RECORDING_NOT_READY", "The recording lesson no longer exists")

    published_now = False
    if not activity.published:
        if not payload.publish:
            raise _error(409, "RECORDING_NOT_PUBLISHED", "This recording is still a draft. Publish it to share it.")
        await update_activity(request, ActivityUpdate(published=True), activity.activity_uuid, user, db)
        await db.refresh(activity)
        published_now = True

    await _throttle(session.session_uuid)
    sender = await db.get(User, user.id)
    queued = await share_recording(request, db, session, activity, audience=payload.audience, sender=sender)
    return {"published": bool(activity.published), "published_now": published_now, "queued": queued, "audience": payload.audience}
