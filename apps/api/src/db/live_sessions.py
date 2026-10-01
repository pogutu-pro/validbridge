"""Live classroom sessions.

A live session is a scheduled, instructor-led lesson inside a course, delivered
over a self-hosted LiveKit room. ValidBridge owns the session record, who may
join, and attendance; LiveKit only carries the media.

Timestamps here are real ``timestamptz`` values (like ``UserAuditEvent``), not
the legacy string dates the course models use: attendance is computed from
them.

Attendance is event-sourced. ``LiveSessionEvent`` rows for ``participant_joined``
/ ``participant_left`` — one pair per LiveKit connection (participant SID) — are
the ledger, and ``LiveSessionParticipant`` is a projection recomputed from that
ledger (see ``services/live/attendance.py``). A refresh or reconnect opens a new
connection rather than rewriting the old one, so duplicate, late or
out-of-order webhooks cannot corrupt the totals.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    BigInteger,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LiveSessionStatus(str, Enum):
    SCHEDULED = "scheduled"    # created, no room yet
    READY = "ready"            # room provisioned; staff may join, learners wait
    LIVE = "live"              # an instructor/moderator is connected
    ENDED = "ended"            # over; attendance and room teardown pending
    PROCESSING = "processing"  # over; waiting on the recording
    COMPLETED = "completed"    # final


# Statuses in which a LiveKit room exists (or should) for the session.
ACTIVE_STATUSES = (LiveSessionStatus.READY, LiveSessionStatus.LIVE)


class LiveRecordingStatus(str, Enum):
    NONE = "none"
    RECORDING = "recording"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class LiveParticipantRole(str, Enum):
    INSTRUCTOR = "instructor"  # the session's lecturer
    MODERATOR = "moderator"    # other course staff (authors, org admins)
    LEARNER = "learner"


STAFF_ROLES = (LiveParticipantRole.INSTRUCTOR, LiveParticipantRole.MODERATOR)


class LiveSessionEventType:
    """Event types persisted to the ledger.

    Deliberately small: only what attendance, lifecycle auditing and recording
    state need. Chat, polls, quizzes and questions get their own tables when
    they are built; ephemeral signals (hand raise, speaking, screen share) are
    not persisted at all.
    """

    PARTICIPANT_JOINED = "participant_joined"
    PARTICIPANT_LEFT = "participant_left"
    STATUS_CHANGED = "status_changed"
    RECORDING_STATUS_CHANGED = "recording_status_changed"


CONNECTION_EVENT_TYPES = (
    LiveSessionEventType.PARTICIPANT_JOINED,
    LiveSessionEventType.PARTICIPANT_LEFT,
)


def _tz_column(nullable: bool = True, **kwargs) -> Column:
    return Column(DateTime(timezone=True), nullable=nullable, **kwargs)


class LiveSession(SQLModel, table=True):
    __tablename__ = "live_session"
    __table_args__ = (
        Index("ix_live_session_course_scheduled", "course_id", "scheduled_at"),
        # The reconciler scans active/ended sessions on every tick.
        Index("ix_live_session_status", "status"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    session_uuid: str = Field(
        sa_column=Column(String(64), nullable=False, unique=True, index=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False)
    )
    # Optional link to the course activity this session is delivered through.
    activity_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    instructor_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    title: str = Field(sa_column=Column(String(200), nullable=False))
    description: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    status: LiveSessionStatus = Field(
        default=LiveSessionStatus.SCHEDULED,
        sa_column=Column(
            SAEnum(LiveSessionStatus, name="live_session_status"),
            nullable=False,
            default=LiveSessionStatus.SCHEDULED,
        ),
    )
    recording_status: LiveRecordingStatus = Field(
        default=LiveRecordingStatus.NONE,
        sa_column=Column(
            SAEnum(LiveRecordingStatus, name="live_recording_status"),
            nullable=False,
            default=LiveRecordingStatus.NONE,
        ),
    )
    livekit_room_name: str = Field(
        sa_column=Column(String(128), nullable=False, unique=True)
    )
    # What the main stage shows while presenting ("presentation" | "camera").
    stage_focus: str = Field(
        default="presentation",
        sa_column=Column(String(16), nullable=False, default="presentation", server_default="presentation"),
    )
    # Recording policy: start automatically when the lesson goes live, and
    # whether a finished recording is published to learners straight away
    # (otherwise it lands in the course as a draft lesson for review).
    record_automatically: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default="false")
    )
    publish_recordings: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true")
    )
    scheduled_at: datetime = Field(sa_column=_tz_column(nullable=False))
    ready_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    started_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    ended_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LiveSessionParticipant(SQLModel, table=True):
    """Per-(session, user) attendance, derived from the connection ledger."""

    __tablename__ = "live_session_participant"
    __table_args__ = (
        UniqueConstraint("session_id", "user_id", name="uq_live_participant_session_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    role: LiveParticipantRole = Field(
        default=LiveParticipantRole.LEARNER,
        sa_column=Column(
            SAEnum(LiveParticipantRole, name="live_participant_role"),
            nullable=False,
            default=LiveParticipantRole.LEARNER,
        ),
    )
    # First connection start / last disconnect (None while connected).
    joined_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    left_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    # Seconds connected across all connections, overlaps counted once. Excludes
    # the currently open stretch, which starts at ``connected_since``.
    duration_seconds: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    connection_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    is_connected: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))
    connected_since: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    # Moderation state; survives reconnects because join tokens honour it.
    media_allowed: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    # Participation counter (hand raises are otherwise ephemeral attributes).
    hand_raises: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0, server_default="0"))
    removed_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LiveRecordingState:
    """Lifecycle of one recording (one LiveKit egress).

    pending → recording → processing → ready | failed

    "ready" is set only after the file is verified in object storage and the
    course lesson that plays it exists — never earlier.
    """

    PENDING = "pending"
    RECORDING = "recording"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


IN_FLIGHT_RECORDING_STATES = (
    LiveRecordingState.PENDING,
    LiveRecordingState.RECORDING,
    LiveRecordingState.PROCESSING,
)


class LiveRecording(SQLModel, table=True):
    """A recording of (part of) a live session.

    The file is written by LiveKit Egress straight to object storage (R2) at
    the key a hosted-video activity uses, so once verified it becomes a normal
    course lesson — player, access control, HLS, captions and progress all
    come from the existing video pipeline. Captions later provide the
    transcript for the course knowledge base (RAG).
    """

    __tablename__ = "live_recording"
    __table_args__ = (Index("ix_live_recording_session_created", "session_id", "created_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    recording_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    started_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    egress_id: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True, unique=True))
    status: str = Field(default=LiveRecordingState.PENDING, sa_column=Column(String(16), nullable=False, index=True))
    # The lesson this recording becomes. The uuid is chosen up front because
    # it is part of the storage key the egress writes to.
    activity_uuid: str = Field(sa_column=Column(String(64), nullable=False))
    activity_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="SET NULL"), nullable=True),
    )
    storage_key: str = Field(sa_column=Column(String(500), nullable=False))
    file_size: Optional[int] = Field(default=None, sa_column=Column(BigInteger, nullable=True))
    duration_seconds: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    # Short internal code ("egress_failed", "storage_missing", ...) — never
    # shown raw to users.
    error: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    finalize_attempts: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    started_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    ended_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    ready_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LiveMessageKind:
    CHAT = "chat"
    QUESTION = "question"


class LiveQuestionStatus(str, Enum):
    OPEN = "open"
    ANSWERED = "answered"
    DISMISSED = "dismissed"


class LiveSessionMessage(SQLModel, table=True):
    """Chat messages and learner questions (Q&A) of a session."""

    __tablename__ = "live_session_message"
    __table_args__ = (
        Index("ix_live_message_session_kind_created", "session_id", "kind", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    message_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    kind: str = Field(sa_column=Column(String(16), nullable=False))
    body: str = Field(sa_column=Column(Text, nullable=False))
    # Questions only: open | answered | dismissed.
    status: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    answered_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    # Questions only: the lecturer's written response (optional — a question
    # can also be answered out loud and just marked answered).
    answer_body: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    answered_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    deleted_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LivePollStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"


class LivePoll(SQLModel, table=True):
    __tablename__ = "live_poll"
    __table_args__ = (Index("ix_live_poll_session_created", "session_id", "created_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    poll_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    created_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    question: str = Field(sa_column=Column(String(300), nullable=False))
    options: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    status: str = Field(default=LivePollStatus.OPEN.value, sa_column=Column(String(16), nullable=False))
    # Optional time limit; votes after closes_at are refused and the poll is
    # closed by the next read or reconciler tick.
    duration_seconds: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    closes_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    closed_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())


class LivePollVote(SQLModel, table=True):
    __tablename__ = "live_poll_vote"
    __table_args__ = (UniqueConstraint("poll_id", "user_id", name="uq_live_poll_vote_poll_user"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    poll_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_poll.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    option_index: int = Field(sa_column=Column(Integer, nullable=False))
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LiveQuizStatus(str, Enum):
    RUNNING = "running"
    FINISHED = "finished"


class LiveQuiz(SQLModel, table=True):
    """A quiz run live in the classroom, one timed question at a time.

    Questions are a snapshot of an existing ValidBridge quiz (an assignment
    QUIZ task or an editor quiz block), normalised to the assignment QUIZ shape
    so the existing grader (``quiz_modes``) scores it. Snapshotting keeps a
    running quiz stable if the source is edited mid-lesson.
    """

    __tablename__ = "live_quiz"
    __table_args__ = (Index("ix_live_quiz_session_created", "session_id", "created_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    quiz_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    created_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    # "assignment_task" | "quiz_block", and the source's stable reference.
    source_type: str = Field(sa_column=Column(String(32), nullable=False))
    source_ref: str = Field(sa_column=Column(String(200), nullable=False))
    title: str = Field(sa_column=Column(String(300), nullable=False))
    questions: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    grading_mode: str = Field(sa_column=Column(String(32), nullable=False))
    seconds_per_question: int = Field(sa_column=Column(Integer, nullable=False))
    status: str = Field(default=LiveQuizStatus.RUNNING.value, sa_column=Column(String(16), nullable=False))
    current_index: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0))
    question_started_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    question_deadline: Optional[datetime] = Field(default=None, sa_column=_tz_column())
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    finished_at: Optional[datetime] = Field(default=None, sa_column=_tz_column())


class LiveQuizAnswer(SQLModel, table=True):
    """One learner's answer to one question. Final once submitted."""

    __tablename__ = "live_quiz_answer"
    __table_args__ = (
        UniqueConstraint("quiz_id", "user_id", "question_index", name="uq_live_quiz_answer"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    quiz_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_quiz.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    question_index: int = Field(sa_column=Column(Integer, nullable=False))
    selected: list = Field(default_factory=list, sa_column=Column(JSONB, nullable=False))
    # 0..1 from quiz_modes.score_question; is_correct means full marks.
    score: float = Field(sa_column=Column(Float, nullable=False))
    is_correct: bool = Field(sa_column=Column(Boolean, nullable=False))
    answered_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


class LiveSessionEvent(SQLModel, table=True):
    """Append-only ledger of persisted live-session events."""

    __tablename__ = "live_session_event"
    __table_args__ = (
        Index("ix_live_event_session_user_type", "session_id", "user_id", "event_type"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(
        sa_column=Column(Integer, ForeignKey("live_session.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    event_type: str = Field(sa_column=Column(String(40), nullable=False))
    # LiveKit participant SID: identifies one connection of a user.
    participant_sid: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    # "webhook" | "reconcile" | "api"
    source: str = Field(default="api", sa_column=Column(String(16), nullable=False))
    # LiveKit webhook event id; unique so webhook retries are no-ops.
    external_id: Optional[str] = Field(
        default=None, sa_column=Column(String(128), nullable=True, unique=True)
    )
    occurred_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))
    data: Optional[dict] = Field(default=None, sa_column=Column(JSONB, nullable=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz_column(nullable=False))


# ---------------------------------------------------------------------------
# API schemas
# ---------------------------------------------------------------------------


class LiveSessionCreate(BaseModel):
    course_uuid: str
    activity_uuid: Optional[str] = None
    title: str = PydanticField(min_length=1, max_length=200)
    description: Optional[str] = PydanticField(default=None, max_length=5000)
    scheduled_at: datetime
    record_automatically: bool = False
    publish_recordings: bool = True


class LiveSessionRead(BaseModel):
    id: int
    session_uuid: str
    org_id: int
    course_id: int
    activity_id: Optional[int] = None
    instructor_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    status: LiveSessionStatus
    recording_status: LiveRecordingStatus
    record_automatically: bool = False
    publish_recordings: bool = True
    scheduled_at: datetime
    ready_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class LiveJoinResponse(BaseModel):
    """Everything a client needs to connect, and nothing else."""

    server_url: str
    token: str
    expires_at: datetime
    role: LiveParticipantRole


class LiveParticipantRead(BaseModel):
    user_id: int
    user_uuid: str
    username: str
    first_name: str
    last_name: str
    role: LiveParticipantRole
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None
    duration_seconds: int
    connection_count: int
    is_connected: bool
    # Share of the session's live duration this participant was connected.
    attendance_percent: Optional[float] = None
    # Seconds after the lesson went live that they first arrived / before it
    # ended that they last left (0 when on time / still there).
    late_by_seconds: int = 0
    left_early_by_seconds: int = 0
    # present | late | left_early | partial | absent
    attendance_status: str = "present"


class LiveAbsentRead(BaseModel):
    user_id: int
    user_uuid: str
    username: str
    first_name: str
    last_name: str


class LiveAttendanceSummary(BaseModel):
    present: int = 0
    late: int = 0
    left_early: int = 0
    partial: int = 0
    absent: int = 0
    average_attendance_percent: Optional[float] = None


class LiveAttendanceRead(BaseModel):
    session_uuid: str
    status: LiveSessionStatus
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    session_duration_seconds: Optional[int] = None
    enrolled_count: int
    attended_count: int
    summary: LiveAttendanceSummary = LiveAttendanceSummary()
    participants: list[LiveParticipantRead]
    # Enrolled learners who never connected (only once the lesson has started).
    absent: list[LiveAbsentRead] = []


class LiveMessageCreate(BaseModel):
    kind: str = PydanticField(pattern="^(chat|question)$")
    body: str = PydanticField(min_length=1, max_length=1000)


class LiveQuestionUpdate(BaseModel):
    status: LiveQuestionStatus
    # Optional written response from the lecturer; implies "answered".
    answer: Optional[str] = PydanticField(default=None, max_length=2000)


class LiveAuthorRead(BaseModel):
    user_uuid: str
    display_name: str
    role: LiveParticipantRole


class LiveMessageRead(BaseModel):
    message_uuid: str
    kind: str
    body: str
    status: Optional[str] = None
    author: Optional[LiveAuthorRead] = None
    created_at: datetime
    answered_at: Optional[datetime] = None
    answer: Optional[str] = None
    answered_by: Optional[str] = None


class LivePollCreate(BaseModel):
    question: str = PydanticField(min_length=1, max_length=300)
    options: list[str] = PydanticField(min_length=2, max_length=6)
    duration_seconds: Optional[int] = PydanticField(default=None, ge=10, le=3600)


class LivePollVoteCreate(BaseModel):
    option_index: int = PydanticField(ge=0, le=5)


class LivePollRead(BaseModel):
    poll_uuid: str
    question: str
    options: list[str]
    status: LivePollStatus
    created_at: datetime
    closed_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    closes_at: Optional[datetime] = None
    total_votes: int
    # Hidden from learners until they have voted or the poll is closed.
    counts: Optional[list[int]] = None
    my_vote: Optional[int] = None


class LiveHandUpdate(BaseModel):
    raised: bool


class LiveReactionCreate(BaseModel):
    emoji: str = PydanticField(min_length=1, max_length=16)


class LiveMuteRequest(BaseModel):
    source: str = PydanticField(pattern="^(microphone|camera|screen_share)$")


class LiveMediaPermissionUpdate(BaseModel):
    allowed: bool


class LiveClassroomRead(BaseModel):
    """Classroom bootstrap: the session plus the caller's standing in it."""

    session: LiveSessionRead
    course_uuid: str
    course_name: str
    role: LiveParticipantRole
    user_uuid: str
    media_allowed: bool
    # Staff: can a recording be started here (LiveKit egress + R2 configured)?
    recording_available: bool = False


class LiveStageUpdate(BaseModel):
    focus: str = PydanticField(pattern="^(presentation|camera)$")


class LiveQuizSourceRead(BaseModel):
    source_id: str
    origin: str  # "assignment" | "lesson"
    title: str
    context: Optional[str] = None
    question_count: int


class LiveQuizCreate(BaseModel):
    source_id: str = PydanticField(min_length=1, max_length=300)
    seconds_per_question: int = PydanticField(default=30, ge=10, le=300)


class LiveQuizAnswerCreate(BaseModel):
    question_index: int = PydanticField(ge=0)
    option_uuids: list[str] = PydanticField(max_length=20)


class LiveQuizOptionRead(BaseModel):
    option_uuid: str
    text: str
    # Only revealed once the question has closed (or to staff).
    correct: Optional[bool] = None
    # Staff only: how many picked this option.
    picks: Optional[int] = None


class LiveQuizQuestionStats(BaseModel):
    answered: int
    correct: int
    incorrect: int
    average_percent: Optional[float] = None


class LiveQuizQuestionRead(BaseModel):
    index: int
    text: str
    response_type: str
    options: list[LiveQuizOptionRead]
    closed: bool
    my_answer: Optional[list[str]] = None
    my_correct: Optional[bool] = None
    my_score: Optional[float] = None
    stats: Optional[LiveQuizQuestionStats] = None


class LiveQuizResults(BaseModel):
    participants: int
    correct: int
    incorrect: int
    average_percent: Optional[float] = None
    my_percent: Optional[float] = None
    my_correct: Optional[int] = None


class LiveQuizRead(BaseModel):
    quiz_uuid: str
    title: str
    status: LiveQuizStatus
    question_count: int
    current_index: int
    seconds_per_question: int
    question_deadline: Optional[datetime] = None
    server_time: datetime
    current: Optional[LiveQuizQuestionRead] = None
    # Staff: every question so far with stats. Learners: none.
    questions: Optional[list[LiveQuizQuestionRead]] = None
    results: Optional[LiveQuizResults] = None


class LiveRecordingRead(BaseModel):
    recording_uuid: str
    session_uuid: str
    session_title: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    ready_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    # The course lesson that plays it (only once ready).
    activity_uuid: Optional[str] = None
    published: Optional[bool] = None


# ---------------------------------------------------------------------------
# Live analytics (course staff)
# ---------------------------------------------------------------------------


class LiveParticipationCounts(BaseModel):
    messages: int = 0
    questions: int = 0
    poll_votes: int = 0
    quiz_answers: int = 0
    hand_raises: int = 0

    @property
    def total(self) -> int:
        return self.messages + self.questions + self.poll_votes + self.quiz_answers + self.hand_raises


class LivePollReport(BaseModel):
    poll_uuid: str
    question: str
    options: list[str]
    counts: list[int]
    total_votes: int
    # Share of the lesson's learner attendees who voted.
    response_rate: Optional[float] = None
    status: str


class LiveQuizReport(BaseModel):
    quiz_uuid: str
    title: str
    question_count: int
    participants: int
    correct: int
    incorrect: int
    average_percent: Optional[float] = None
    status: str


class LiveSessionLearnerRow(BaseModel):
    user_id: int
    user_uuid: str
    name: str
    attendance_status: str
    attendance_percent: Optional[float] = None
    duration_seconds: int = 0
    late_by_seconds: int = 0
    left_early_by_seconds: int = 0
    participation: LiveParticipationCounts
    quiz_percent: Optional[float] = None


class LiveSessionReport(BaseModel):
    session: LiveSessionRead
    enrolled: int
    attendees: int
    attendance_rate: Optional[float] = None  # attendees / enrolled
    average_attendance_percent: Optional[float] = None  # share of the lesson attended
    average_duration_seconds: Optional[int] = None
    late_arrivals: int = 0
    early_departures: int = 0
    partial: int = 0
    absent: int = 0
    participating_learners: int = 0
    participation_rate: Optional[float] = None  # participating / attendees
    participation: LiveParticipationCounts
    questions_answered: int = 0
    polls: list[LivePollReport] = []
    quizzes: list[LiveQuizReport] = []
    completed: bool = False
    duration_seconds: Optional[int] = None
    recordings: list[LiveRecordingRead] = []
    learners: list[LiveSessionLearnerRow] = []


class LiveSessionSummaryRow(BaseModel):
    session_uuid: str
    title: str
    status: LiveSessionStatus
    scheduled_at: datetime
    started_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None
    attendees: int = 0
    attendance_rate: Optional[float] = None
    average_attendance_percent: Optional[float] = None
    questions: int = 0
    quiz_average_percent: Optional[float] = None
    recording_status: LiveRecordingStatus


class LiveCourseOverview(BaseModel):
    enrolled: int
    sessions_held: int
    sessions_upcoming: int
    average_attendance_rate: Optional[float] = None
    average_attendance_percent: Optional[float] = None
    average_duration_seconds: Optional[int] = None
    late_arrivals: int = 0
    early_departures: int = 0
    total_questions: int = 0
    total_poll_votes: int = 0
    live_quiz_average_percent: Optional[float] = None
    recordings_ready: int = 0
    sessions: list[LiveSessionSummaryRow] = []


class LiveLearnerEngagement(BaseModel):
    """One enrolled learner across LMS progress and the live classroom."""

    user_id: int
    user_uuid: str
    name: str
    username: str
    progress_percent: float
    activities_completed: int
    activities_total: int
    assignments_submitted: int
    assignments_total: int
    assignment_average_percent: Optional[float] = None
    quiz_average_percent: Optional[float] = None  # graded assignment QUIZ tasks
    live_quiz_average_percent: Optional[float] = None
    live_sessions_attended: int
    live_sessions_held: int
    live_attendance_rate: Optional[float] = None
    live_average_attendance_percent: Optional[float] = None
    live_participation: int
    last_active_on: Optional[str] = None


class LiveMySession(BaseModel):
    session_uuid: str
    title: str
    status: LiveSessionStatus
    scheduled_at: datetime
    started_at: Optional[datetime] = None
    course_uuid: str
    course_name: str
    course_thumbnail: Optional[str] = None
    is_staff: bool = False


class LiveMyRecording(BaseModel):
    recording_uuid: str
    session_title: str
    course_uuid: str
    course_name: str
    activity_uuid: str
    ready_at: Optional[datetime] = None
    duration_seconds: Optional[int] = None


class LiveMyLessons(BaseModel):
    """A signed-in user's live lessons across the courses they learn or teach."""

    sessions: list[LiveMySession] = []
    recordings: list[LiveMyRecording] = []
