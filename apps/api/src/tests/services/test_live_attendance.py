"""Attendance ledger + projection for live sessions."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import select

from src.db.live_sessions import (
    LiveParticipantRole,
    LiveSession,
    LiveSessionEvent,
    LiveSessionEventType,
    LiveSessionParticipant,
    LiveSessionStatus,
)
from src.services.live.attendance import (
    open_connections,
    record_connection_event,
    recompute_session,
    summarize_connections,
)

T0 = datetime(2026, 9, 23, 10, 0, tzinfo=timezone.utc)
JOIN = LiveSessionEventType.PARTICIPANT_JOINED
LEAVE = LiveSessionEventType.PARTICIPANT_LEFT


def _ev(event_type, sid, minutes, role=None):
    return LiveSessionEvent(
        session_id=1,
        org_id=1,
        user_id=1,
        event_type=event_type,
        participant_sid=sid,
        occurred_at=T0 + timedelta(minutes=minutes),
        data={"role": role} if role else None,
    )


class TestSummarizeConnections:
    def test_single_connection(self):
        s = summarize_connections([_ev(JOIN, "PA", 0), _ev(LEAVE, "PA", 30)], None)
        assert s.duration_seconds == 30 * 60
        assert s.joined_at == T0
        assert s.left_at == T0 + timedelta(minutes=30)
        assert s.connection_count == 1
        assert not s.is_connected

    def test_refresh_overlap_counted_once(self):
        # Browser refresh: new connection joins before the old one times out.
        events = [
            _ev(JOIN, "PA", 0),
            _ev(JOIN, "PB", 20),
            _ev(LEAVE, "PA", 21),
            _ev(LEAVE, "PB", 40),
        ]
        s = summarize_connections(events, None)
        assert s.duration_seconds == 40 * 60
        assert s.connection_count == 2

    def test_gap_between_connections_not_counted(self):
        events = [_ev(JOIN, "PA", 0), _ev(LEAVE, "PA", 10), _ev(JOIN, "PB", 15), _ev(LEAVE, "PB", 25)]
        s = summarize_connections(events, None)
        assert s.duration_seconds == 20 * 60
        assert s.joined_at == T0
        assert s.left_at == T0 + timedelta(minutes=25)

    def test_out_of_order_leave_before_join(self):
        events = [_ev(LEAVE, "PA", 30), _ev(JOIN, "PA", 0)]
        assert summarize_connections(events, None).duration_seconds == 30 * 60

    def test_leave_without_join_is_ignored(self):
        s = summarize_connections([_ev(LEAVE, "PX", 5)], None)
        assert s.duration_seconds == 0
        assert s.connection_count == 0

    def test_open_connection_is_live_until_session_ends(self):
        events = [_ev(JOIN, "PA", 0), _ev(LEAVE, "PA", 10), _ev(JOIN, "PB", 12)]
        live = summarize_connections(events, None)
        assert live.is_connected
        assert live.connected_since == T0 + timedelta(minutes=12)
        assert live.duration_seconds == 10 * 60
        assert live.left_at is None

        ended = summarize_connections(events, T0 + timedelta(minutes=50))
        assert not ended.is_connected
        assert ended.duration_seconds == (10 + 38) * 60
        assert ended.left_at == T0 + timedelta(minutes=50)

    def test_latest_join_role_wins(self):
        events = [_ev(JOIN, "PA", 0, "learner"), _ev(JOIN, "PB", 5, "moderator")]
        assert summarize_connections(events, None).role == LiveParticipantRole.MODERATOR


@pytest.fixture
async def live_session(db, org, course, admin_user):
    s = LiveSession(
        session_uuid="livesession_test",
        org_id=org.id,
        course_id=course.id,
        instructor_id=admin_user.id,
        title="Lesson",
        status=LiveSessionStatus.LIVE,
        scheduled_at=T0,
        started_at=T0,
        livekit_room_name="vb-live-test",
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def _participant(db, session_id, user_id):
    return (
        await db.execute(
            select(LiveSessionParticipant).where(
                LiveSessionParticipant.session_id == session_id,
                LiveSessionParticipant.user_id == user_id,
            )
        )
    ).scalars().one()


class TestLedger:
    async def test_duplicate_webhook_is_noop(self, db, live_session, regular_user):
        kwargs = dict(
            user_id=regular_user.id,
            event_type=JOIN,
            participant_sid="PA",
            occurred_at=T0,
            source="webhook",
            external_id="EV_1",
            role=LiveParticipantRole.LEARNER,
        )
        assert await record_connection_event(db, live_session, **kwargs) is True
        assert await record_connection_event(db, live_session, **kwargs) is False
        # Same connection reported again by the reconciler (no external id).
        kwargs.update(external_id=None, source="reconcile")
        assert await record_connection_event(db, live_session, **kwargs) is False

        await record_connection_event(
            db, live_session, user_id=regular_user.id, event_type=LEAVE,
            participant_sid="PA", occurred_at=T0 + timedelta(minutes=20), source="webhook",
        )
        p = await _participant(db, live_session.id, regular_user.id)
        assert p.duration_seconds == 20 * 60
        assert p.connection_count == 1
        assert not p.is_connected

    async def test_session_end_closes_open_connections(self, db, live_session, regular_user):
        await record_connection_event(
            db, live_session, user_id=regular_user.id, event_type=JOIN,
            participant_sid="PA", occurred_at=T0, source="webhook",
        )
        assert await open_connections(db, live_session) == {"PA": regular_user.id}

        live_session.ended_at = T0 + timedelta(minutes=45)
        live_session.status = LiveSessionStatus.ENDED
        db.add(live_session)
        await db.commit()
        await recompute_session(db, live_session)

        p = await _participant(db, live_session.id, regular_user.id)
        assert not p.is_connected
        assert p.duration_seconds == 45 * 60
