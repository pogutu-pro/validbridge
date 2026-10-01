"""In-class interaction: chat, questions, polls, hand raise, reactions and
lecturer moderation.

ValidBridge is the authority for all of it. Learners hold no data-publish or
admin rights in LiveKit, so every action is a request here: it is authorized
against the caller's live role, persisted where it matters, and then fanned
out to the room with a server-sent LiveKit data message on a ``vb.*`` topic.
A failed broadcast never fails the request — clients also refetch.

Hand raise is a LiveKit participant attribute (``vb.hand``) set by the server,
so everyone sees it without a table. Reactions are broadcast only.
"""

import logging
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.live_sessions import (
    STAFF_ROLES,
    LiveAuthorRead,
    LiveMessageCreate,
    LiveMessageKind,
    LiveMessageRead,
    LiveParticipantRole,
    LivePoll,
    LivePollCreate,
    LivePollRead,
    LivePollStatus,
    LivePollVote,
    LiveQuestionStatus,
    LiveSession,
    LiveSessionMessage,
    LiveSessionParticipant,
    LiveSessionStatus,
    utcnow,
)
from src.db.users import PublicUser, User
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.services.live import livekit
from src.services.live.attendance import as_utc, locked_participant
from src.services.live.config import get_livekit_settings
from src.services.live.sessions import (
    _error,
    _get_course,
    _require_user,
    get_participant_row,
    get_session_by_uuid,
    publish_sources,
    require_livekit,
    require_not_removed,
    resolve_role,
)

logger = logging.getLogger(__name__)

HAND_ATTRIBUTE = "vb.hand"
ALLOWED_REACTIONS = {"👍", "👏", "❤️", "😂", "🎉", "🤔", "😮", "🙌"}

TOPIC_MESSAGES = "vb.messages"
TOPIC_POLLS = "vb.polls"
TOPIC_REACTIONS = "vb.reactions"
TOPIC_MODERATION = "vb.moderation"
TOPIC_QUIZ = "vb.quiz"

_CHAT_HISTORY_LIMIT = 200
_QUESTION_LIMIT = 300


@dataclass
class ClassroomContext:
    user: PublicUser
    session: LiveSession
    course: Course
    role: LiveParticipantRole

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF_ROLES


async def _context(
    request: Request, db: AsyncSession, user, session_uuid: str, *, interactive: bool = False
) -> ClassroomContext:
    user = _require_user(user)
    session = await get_session_by_uuid(db, session_uuid)
    course = await _get_course(db, session.course_id)
    role = await resolve_role(request, db, user, session, course)
    require_not_removed(await get_participant_row(db, session.id, user.id))
    ctx = ClassroomContext(user=user, session=session, course=course, role=role)
    if interactive:
        _require_interactive(ctx)
    return ctx


def _require_interactive(ctx: ClassroomContext) -> None:
    status = ctx.session.status
    if status == LiveSessionStatus.LIVE:
        return
    if status == LiveSessionStatus.READY and ctx.is_staff:
        return
    if status in (LiveSessionStatus.SCHEDULED, LiveSessionStatus.READY):
        raise _error(409, "SESSION_NOT_LIVE", "The lesson has not started yet")
    raise _error(409, "SESSION_ENDED", "This live session has ended")


def _require_staff(ctx: ClassroomContext) -> None:
    if not ctx.is_staff:
        raise _error(403, "LIVE_STAFF_REQUIRED", "Only the lecturer can do this")


async def _broadcast(
    session: LiveSession, topic: str, payload: dict, to: Optional[list[str]] = None
) -> None:
    settings = get_livekit_settings()
    if settings is None:
        return
    try:
        await livekit.send_data(settings, session.livekit_room_name, topic, payload, to)
    except livekit.LiveKitError as exc:
        logger.warning("Live session %s: broadcast on %s failed: %s", session.session_uuid, topic, exc)


async def _throttle(key: str, limit: int, window_seconds: int) -> None:
    """Fixed-window rate limit in Redis; allows when Redis is unavailable."""
    try:
        import asyncio

        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return
        full_key = f"validbridge:live:rl:{key}"
        count = await asyncio.to_thread(client.incr, full_key)
        if count == 1:
            await asyncio.to_thread(client.expire, full_key, window_seconds)
    except Exception:  # pragma: no cover - Redis is an optimisation here
        return
    if count > limit:
        raise _error(429, "SLOW_DOWN", "You're sending too quickly. Try again in a moment.")


def _display_name(user: User) -> str:
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


# ---------------------------------------------------------------------------
# Chat + questions
# ---------------------------------------------------------------------------


async def _roles_by_user(db: AsyncSession, session_id: int) -> dict[int, LiveParticipantRole]:
    rows = (
        await db.execute(
            select(LiveSessionParticipant.user_id, LiveSessionParticipant.role).where(
                LiveSessionParticipant.session_id == session_id
            )
        )
    ).all()
    return {user_id: role for user_id, role in rows}


def _message_read(
    message: LiveSessionMessage,
    author: Optional[User],
    role: Optional[LiveParticipantRole],
    answered_by: Optional[User] = None,
) -> LiveMessageRead:
    return LiveMessageRead(
        message_uuid=message.message_uuid,
        kind=message.kind,
        body=message.body,
        status=message.status,
        author=(
            LiveAuthorRead(
                user_uuid=author.user_uuid,
                display_name=_display_name(author),
                role=role or LiveParticipantRole.LEARNER,
            )
            if author is not None
            else None
        ),
        created_at=as_utc(message.created_at),
        answered_at=as_utc(message.answered_at),
        answer=message.answer_body,
        answered_by=_display_name(answered_by) if answered_by is not None else None,
    )


async def list_messages(
    request: Request, db: AsyncSession, user, session_uuid: str, kind: str
) -> list[LiveMessageRead]:
    if kind not in (LiveMessageKind.CHAT, LiveMessageKind.QUESTION):
        raise HTTPException(status_code=400, detail="Unknown message kind")
    ctx = await _context(request, db, user, session_uuid)
    limit = _CHAT_HISTORY_LIMIT if kind == LiveMessageKind.CHAT else _QUESTION_LIMIT
    rows = (
        await db.execute(
            select(LiveSessionMessage, User)
            .outerjoin(User, User.id == LiveSessionMessage.user_id)
            .where(
                LiveSessionMessage.session_id == ctx.session.id,
                LiveSessionMessage.kind == kind,
                LiveSessionMessage.deleted_at.is_(None),
            )
            .order_by(LiveSessionMessage.created_at.desc(), LiveSessionMessage.id.desc())
            .limit(limit)
        )
    ).all()
    roles = await _roles_by_user(db, ctx.session.id)
    answerer_ids = {m.answered_by_id for m, _ in rows if m.answered_by_id}
    answerers = {}
    if answerer_ids:
        answerers = {
            u.id: u for u in (await db.execute(select(User).where(User.id.in_(answerer_ids)))).scalars().all()
        }
    return [
        _message_read(message, author, roles.get(message.user_id), answerers.get(message.answered_by_id))
        for message, author in reversed(rows)
    ]


async def create_message(
    request: Request, db: AsyncSession, user, session_uuid: str, payload: LiveMessageCreate
) -> LiveMessageRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message is empty")
    if payload.kind == LiveMessageKind.CHAT:
        await _throttle(f"chat:{ctx.session.id}:{ctx.user.id}", limit=5, window_seconds=10)
    else:
        await _throttle(f"question:{ctx.session.id}:{ctx.user.id}", limit=3, window_seconds=60)

    message = LiveSessionMessage(
        message_uuid=f"livemsg_{uuid4()}",
        session_id=ctx.session.id,
        org_id=ctx.session.org_id,
        user_id=ctx.user.id,
        kind=payload.kind,
        body=body,
        status=LiveQuestionStatus.OPEN.value if payload.kind == LiveMessageKind.QUESTION else None,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)

    author = await db.get(User, ctx.user.id)
    read = _message_read(message, author, ctx.role)
    await _broadcast(ctx.session, TOPIC_MESSAGES, {"type": "created", "message": read.model_dump(mode="json")})
    return read


async def _get_message(db: AsyncSession, session: LiveSession, message_uuid: str) -> LiveSessionMessage:
    message = (
        await db.execute(
            select(LiveSessionMessage).where(
                LiveSessionMessage.message_uuid == message_uuid,
                LiveSessionMessage.session_id == session.id,
                LiveSessionMessage.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    return message


async def delete_message(
    request: Request, db: AsyncSession, user, session_uuid: str, message_uuid: str
) -> None:
    ctx = await _context(request, db, user, session_uuid)
    message = await _get_message(db, ctx.session, message_uuid)
    if not ctx.is_staff and message.user_id != ctx.user.id:
        raise _error(403, "LIVE_STAFF_REQUIRED", "You can only delete your own messages")
    message.deleted_at = utcnow()
    db.add(message)
    await db.commit()
    await _broadcast(
        ctx.session,
        TOPIC_MESSAGES,
        {"type": "deleted", "kind": message.kind, "message_uuid": message.message_uuid},
    )


async def update_question(
    request: Request,
    db: AsyncSession,
    user,
    session_uuid: str,
    message_uuid: str,
    status: LiveQuestionStatus,
    answer: Optional[str] = None,
) -> LiveMessageRead:
    ctx = await _context(request, db, user, session_uuid)
    _require_staff(ctx)
    message = await _get_message(db, ctx.session, message_uuid)
    if message.kind != LiveMessageKind.QUESTION:
        raise HTTPException(status_code=404, detail="Question not found")
    answer = (answer or "").strip() or None
    if answer is not None:
        # A written response always answers the question.
        status = LiveQuestionStatus.ANSWERED
        message.answer_body = answer
        message.answered_by_id = ctx.user.id
    message.status = status.value
    message.answered_at = utcnow() if status == LiveQuestionStatus.ANSWERED else None
    db.add(message)
    await db.commit()
    await db.refresh(message)

    author = await db.get(User, message.user_id) if message.user_id else None
    answered_by = await db.get(User, message.answered_by_id) if message.answered_by_id else None
    roles = await _roles_by_user(db, ctx.session.id)
    read = _message_read(message, author, roles.get(message.user_id), answered_by)
    await _broadcast(ctx.session, TOPIC_MESSAGES, {"type": "updated", "message": read.model_dump(mode="json")})
    return read


# ---------------------------------------------------------------------------
# Polls
# ---------------------------------------------------------------------------


async def _poll_counts(db: AsyncSession, poll_ids: list[int]) -> dict[int, dict[int, int]]:
    if not poll_ids:
        return {}
    rows = (
        await db.execute(
            select(LivePollVote.poll_id, LivePollVote.option_index, func.count(LivePollVote.id))
            .where(LivePollVote.poll_id.in_(poll_ids))
            .group_by(LivePollVote.poll_id, LivePollVote.option_index)
        )
    ).all()
    counts: dict[int, dict[int, int]] = {}
    for poll_id, option_index, count in rows:
        counts.setdefault(poll_id, {})[option_index] = count
    return counts


def _poll_read(
    poll: LivePoll, counts: dict[int, int], my_vote: Optional[int], is_staff: bool
) -> LivePollRead:
    options = list(poll.options or [])
    per_option = [counts.get(i, 0) for i in range(len(options))]
    reveal = is_staff or poll.status == LivePollStatus.CLOSED.value or my_vote is not None
    return LivePollRead(
        poll_uuid=poll.poll_uuid,
        question=poll.question,
        options=options,
        status=LivePollStatus(poll.status),
        created_at=as_utc(poll.created_at),
        closed_at=as_utc(poll.closed_at),
        duration_seconds=poll.duration_seconds,
        closes_at=as_utc(poll.closes_at),
        total_votes=sum(per_option),
        counts=per_option if reveal else None,
        my_vote=my_vote,
    )


async def _polls_for(ctx: ClassroomContext, db: AsyncSession, polls: list[LivePoll]) -> list[LivePollRead]:
    ids = [p.id for p in polls]
    counts = await _poll_counts(db, ids)
    mine = {}
    if ids:
        rows = (
            await db.execute(
                select(LivePollVote.poll_id, LivePollVote.option_index).where(
                    LivePollVote.poll_id.in_(ids), LivePollVote.user_id == ctx.user.id
                )
            )
        ).all()
        mine = {poll_id: option for poll_id, option in rows}
    return [_poll_read(p, counts.get(p.id, {}), mine.get(p.id), ctx.is_staff) for p in polls]


async def list_polls(request: Request, db: AsyncSession, user, session_uuid: str) -> list[LivePollRead]:
    ctx = await _context(request, db, user, session_uuid)
    await expire_polls(db, ctx.session)
    polls = (
        await db.execute(
            select(LivePoll)
            .where(LivePoll.session_id == ctx.session.id)
            .order_by(LivePoll.created_at.desc(), LivePoll.id.desc())
        )
    ).scalars().all()
    return await _polls_for(ctx, db, list(polls))


async def _get_poll(db: AsyncSession, session: LiveSession, poll_uuid: str) -> LivePoll:
    poll = (
        await db.execute(
            select(LivePoll).where(LivePoll.poll_uuid == poll_uuid, LivePoll.session_id == session.id)
        )
    ).scalars().first()
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    return poll


async def create_poll(
    request: Request, db: AsyncSession, user, session_uuid: str, payload: LivePollCreate
) -> LivePollRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    options = [o.strip() for o in payload.options]
    if any(not o or len(o) > 120 for o in options):
        raise HTTPException(status_code=422, detail="Poll options must be 1-120 characters")

    # One open poll at a time keeps the learner UI simple.
    now = utcnow()
    open_polls = (
        await db.execute(
            select(LivePoll).where(
                LivePoll.session_id == ctx.session.id, LivePoll.status == LivePollStatus.OPEN.value
            )
        )
    ).scalars().all()
    for existing in open_polls:
        await _close_poll(db, ctx.session, existing, broadcast=True)

    poll = LivePoll(
        poll_uuid=f"livepoll_{uuid4()}",
        session_id=ctx.session.id,
        org_id=ctx.session.org_id,
        created_by_id=ctx.user.id,
        question=payload.question.strip(),
        options=options,
        duration_seconds=payload.duration_seconds,
        closes_at=now + timedelta(seconds=payload.duration_seconds) if payload.duration_seconds else None,
    )
    db.add(poll)
    await db.commit()
    await db.refresh(poll)

    await _broadcast(ctx.session, TOPIC_POLLS, {"type": "created", "poll_uuid": poll.poll_uuid})
    return _poll_read(poll, {}, None, True)


async def close_poll(
    request: Request, db: AsyncSession, user, session_uuid: str, poll_uuid: str
) -> LivePollRead:
    ctx = await _context(request, db, user, session_uuid)
    _require_staff(ctx)
    poll = await _get_poll(db, ctx.session, poll_uuid)
    await _close_poll(db, ctx.session, poll, broadcast=True)
    return (await _polls_for(ctx, db, [poll]))[0]


async def vote_poll(
    request: Request, db: AsyncSession, user, session_uuid: str, poll_uuid: str, option_index: int
) -> LivePollRead:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    poll = await _get_poll(db, ctx.session, poll_uuid)
    if poll.status == LivePollStatus.OPEN.value and _poll_expired(poll, utcnow()):
        await _close_poll(db, ctx.session, poll, broadcast=True)
    if poll.status != LivePollStatus.OPEN.value:
        raise _error(409, "POLL_CLOSED", "This poll is closed")
    if option_index >= len(poll.options or []):
        raise HTTPException(status_code=422, detail="Unknown option")

    stmt = select(LivePollVote).where(LivePollVote.poll_id == poll.id, LivePollVote.user_id == ctx.user.id)
    vote = (await db.execute(stmt)).scalars().first()
    if vote is None:
        try:
            async with db.begin_nested():
                db.add(LivePollVote(poll_id=poll.id, user_id=ctx.user.id, option_index=option_index))
        except IntegrityError:
            vote = (await db.execute(stmt)).scalars().one()
    if vote is not None:
        vote.option_index = option_index
        db.add(vote)
    await db.commit()
    await _broadcast_poll_results(db, ctx.session, poll)
    return (await _polls_for(ctx, db, [poll]))[0]


def _poll_expired(poll: LivePoll, now) -> bool:
    closes_at = as_utc(poll.closes_at)
    return closes_at is not None and now >= closes_at


async def _close_poll(db: AsyncSession, session: LiveSession, poll: LivePoll, *, broadcast: bool) -> bool:
    """Close ``poll`` (idempotent). Emits the poll's analytics exactly once."""
    if poll.status == LivePollStatus.CLOSED.value:
        return False
    now = utcnow()
    closes_at = as_utc(poll.closes_at)
    poll.status = LivePollStatus.CLOSED.value
    poll.closed_at = min(now, closes_at) if closes_at else now
    db.add(poll)
    await db.commit()
    await db.refresh(poll)

    counts = await _poll_counts(db, [poll.id])
    per_option = [counts.get(poll.id, {}).get(i, 0) for i in range(len(poll.options or []))]
    try:
        await track(
            analytics_events.LIVE_POLL_CLOSED,
            org_id=session.org_id,
            user_id=poll.created_by_id or 0,
            properties={
                "session_uuid": session.session_uuid,
                "poll_uuid": poll.poll_uuid,
                "question": poll.question,
                "options": list(poll.options or []),
                "counts": per_option,
                "total_votes": sum(per_option),
                "duration_seconds": poll.duration_seconds,
            },
        )
    except Exception:  # pragma: no cover - analytics never blocks the classroom
        logger.warning("live_poll_closed analytics failed", exc_info=True)
    if broadcast:
        await _broadcast(session, TOPIC_POLLS, {"type": "closed", "poll_uuid": poll.poll_uuid})
    return True


async def expire_polls(db: AsyncSession, session: LiveSession) -> int:
    """Close open polls whose time is up. Returns how many were closed."""
    now = utcnow()
    open_polls = (
        await db.execute(
            select(LivePoll).where(
                LivePoll.session_id == session.id,
                LivePoll.status == LivePollStatus.OPEN.value,
                LivePoll.closes_at.is_not(None),
            )
        )
    ).scalars().all()
    closed = 0
    for poll in open_polls:
        if _poll_expired(poll, now) and await _close_poll(db, session, poll, broadcast=True):
            closed += 1
    return closed


async def _broadcast_poll_results(db: AsyncSession, session: LiveSession, poll: LivePoll) -> None:
    """Push live counts to the room, at most about once a second per poll.

    Results are a tiny payload clients merge into their cache — no refetch —
    so even 100 learners voting at once costs one small message per second.
    Clients only display them to staff and to learners who have voted.
    """
    try:
        import asyncio

        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is not None:
            fresh = await asyncio.to_thread(
                client.set, f"validbridge:live:pollcast:{poll.poll_uuid}", "1", nx=True, px=900
            )
            if not fresh:
                return
    except Exception:  # pragma: no cover - throttling is an optimisation
        pass
    counts = await _poll_counts(db, [poll.id])
    per_option = [counts.get(poll.id, {}).get(i, 0) for i in range(len(poll.options or []))]
    await _broadcast(
        session,
        TOPIC_POLLS,
        {"type": "results", "poll_uuid": poll.poll_uuid, "counts": per_option, "total_votes": sum(per_option)},
    )


# ---------------------------------------------------------------------------
# Stage (presentation vs camera focus)
# ---------------------------------------------------------------------------


async def set_stage_focus(request: Request, db: AsyncSession, user, session_uuid: str, focus: str) -> None:
    """Lecturer chooses what the room's main stage shows while presenting.

    Stored in LiveKit room metadata so late joiners and reconnecting clients
    get it from the room itself.
    """
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    require_livekit()
    from src.services.live.sessions import push_room_metadata

    ctx.session.stage_focus = focus
    ctx.session.updated_at = utcnow()
    db.add(ctx.session)
    await db.commit()
    await db.refresh(ctx.session)
    if not await push_room_metadata(ctx.session):
        raise _error(502, "LIVE_SERVER_UNAVAILABLE", "The live classroom server is unavailable")


async def close_open_interactions(db: AsyncSession, session: LiveSession, source: str) -> None:
    """Called once when a lesson finishes: final results for polls and quizzes."""
    try:
        open_polls = (
            await db.execute(
                select(LivePoll).where(
                    LivePoll.session_id == session.id, LivePoll.status == LivePollStatus.OPEN.value
                )
            )
        ).scalars().all()
        for poll in open_polls:
            await _close_poll(db, session, poll, broadcast=False)
        from src.services.live.quizzes import finish_running_quizzes

        await finish_running_quizzes(db, session)
    except Exception:
        logger.warning("Live session %s: closing interactions failed", session.session_uuid, exc_info=True)


# ---------------------------------------------------------------------------
# Hand raise + reactions
# ---------------------------------------------------------------------------


async def _set_hand(ctx: ClassroomContext, identity: str, raised: bool) -> None:
    settings = require_livekit()
    value = str(int(time.time() * 1000)) if raised else ""
    try:
        updated = await livekit.update_participant(
            settings, ctx.session.livekit_room_name, identity, attributes={HAND_ATTRIBUTE: value}
        )
    except livekit.LiveKitError as exc:
        logger.warning("Live session %s: hand update failed: %s", ctx.session.session_uuid, exc)
        raise _error(502, "LIVE_SERVER_UNAVAILABLE", "The live classroom server is unavailable") from exc
    if not updated:
        raise _error(409, "NOT_CONNECTED", "Join the classroom first")


async def set_own_hand(request: Request, db: AsyncSession, user, session_uuid: str, raised: bool) -> None:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    await _set_hand(ctx, ctx.user.user_uuid, raised)
    if raised:
        # Participation counter; the hand itself stays an ephemeral attribute.
        participant = await locked_participant(db, ctx.session, ctx.user.id, ctx.role)
        participant.hand_raises = (participant.hand_raises or 0) + 1
        db.add(participant)
        await db.commit()


async def send_reaction(request: Request, db: AsyncSession, user, session_uuid: str, emoji: str) -> None:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    if emoji not in ALLOWED_REACTIONS:
        raise HTTPException(status_code=422, detail="Unsupported reaction")
    await _throttle(f"reaction:{ctx.session.id}:{ctx.user.id}", limit=3, window_seconds=5)
    await _broadcast(ctx.session, TOPIC_REACTIONS, {"emoji": emoji, "identity": ctx.user.user_uuid})


# ---------------------------------------------------------------------------
# Moderation (staff)
# ---------------------------------------------------------------------------


async def _moderation_target(
    ctx: ClassroomContext, db: AsyncSession, identity: str
) -> tuple[User, LiveParticipantRole]:
    _require_staff(ctx)
    target = (await db.execute(select(User).where(User.user_uuid == identity))).scalars().first()
    if target is None:
        raise HTTPException(status_code=404, detail="Participant not found")
    if target.id == ctx.user.id:
        raise _error(400, "CANNOT_MODERATE_SELF", "You can't do this to yourself")
    row = await get_participant_row(db, ctx.session.id, target.id)
    role = row.role if row is not None else LiveParticipantRole.LEARNER
    if role == LiveParticipantRole.INSTRUCTOR or (
        role == LiveParticipantRole.MODERATOR and ctx.role != LiveParticipantRole.INSTRUCTOR
    ):
        raise _error(403, "CANNOT_MODERATE_STAFF", "You can't moderate this participant")
    return target, role


async def lower_hand(request: Request, db: AsyncSession, user, session_uuid: str, identity: str) -> None:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    _require_staff(ctx)
    await _set_hand(ctx, identity, False)


async def mute_participant(
    request: Request, db: AsyncSession, user, session_uuid: str, identity: str, source: str
) -> None:
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    target, _ = await _moderation_target(ctx, db, identity)
    settings = require_livekit()
    try:
        await livekit.mute_published_tracks(settings, ctx.session.livekit_room_name, identity, source)
    except livekit.LiveKitError as exc:
        raise _error(502, "LIVE_SERVER_UNAVAILABLE", "The live classroom server is unavailable") from exc
    await _broadcast(ctx.session, TOPIC_MODERATION, {"type": "muted", "source": source}, to=[target.user_uuid])


async def set_media_permission(
    request: Request, db: AsyncSession, user, session_uuid: str, identity: str, allowed: bool
) -> None:
    """Allow/revoke a learner's camera + microphone. Persisted so a rejoin
    token carries the same permission."""
    ctx = await _context(request, db, user, session_uuid, interactive=True)
    target, role = await _moderation_target(ctx, db, identity)
    participant = await locked_participant(db, ctx.session, target.id, role)
    participant.media_allowed = allowed
    participant.updated_at = utcnow()
    db.add(participant)
    await db.commit()

    settings = require_livekit()
    try:
        await livekit.update_participant(
            settings,
            ctx.session.livekit_room_name,
            identity,
            permission=livekit.participant_permission(publish_sources(role, allowed), can_publish_data=False),
        )
    except livekit.LiveKitError as exc:
        # Persisted already; it applies on their next connection.
        logger.warning("Live session %s: permission update failed: %s", ctx.session.session_uuid, exc)
    await _broadcast(ctx.session, TOPIC_MODERATION, {"type": "media", "allowed": allowed}, to=[target.user_uuid])


async def remove_participant(
    request: Request, db: AsyncSession, user, session_uuid: str, identity: str
) -> None:
    ctx = await _context(request, db, user, session_uuid)
    target, role = await _moderation_target(ctx, db, identity)
    participant = await locked_participant(db, ctx.session, target.id, role)
    participant.removed_at = utcnow()
    participant.updated_at = utcnow()
    db.add(participant)
    await db.commit()

    settings = get_livekit_settings()
    if settings is not None:
        try:
            await livekit.remove_participant(settings, ctx.session.livekit_room_name, identity)
        except livekit.LiveKitError as exc:
            # They can no longer obtain a token; the reconciler/leave will catch up.
            logger.warning("Live session %s: remove failed: %s", ctx.session.session_uuid, exc)
