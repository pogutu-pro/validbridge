"""Exam mode for assessments.

An exam (or CAT) is an ordinary assessment, so questions, grading, the gradebook
and certificates all keep working, plus a live, timed, supervised sitting:

* ``ExamSettings``  one row per assessment that runs in exam mode (the window,
  the duration, which supervision checks are required).
* ``ExamSession``   one row per student: when they started, when their own clock
  runs out, and the latest status the browser reported (camera, screen share,
  fullscreen).
* ``ExamEvent``     the ledger staff review: tab switches, leaving fullscreen,
  camera or screen sharing stopped, and so on.

Nothing here stores camera or screen pictures. The browser only reports whether
the camera and the screen share are still running.

Timestamps are real ``timestamptz`` values: deadlines are compared on the server.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _tz(nullable: bool = True) -> Column:
    return Column(DateTime(timezone=True), nullable=nullable)


class ExamSessionStatus(str, Enum):
    IN_PROGRESS = "in_progress"
    SUBMITTED = "submitted"  # the student finished, or the server submitted at the deadline


class ExamSettings(SQLModel, table=True):
    __tablename__ = "exam_settings"
    __table_args__ = (UniqueConstraint("assignment_id", name="uq_exam_settings_assignment"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("assignment.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    course_id: int = Field(sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True))
    enabled: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    duration_minutes: int = Field(default=60, sa_column=Column(Integer, nullable=False, default=60, server_default="60"))
    # New sittings may start between these; everyone finishes by closes_at.
    opens_at: Optional[datetime] = Field(default=None, sa_column=_tz())
    closes_at: Optional[datetime] = Field(default=None, sa_column=_tz())
    require_camera: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    require_screen_share: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    require_fullscreen: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    watermark: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default="true"))
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz(nullable=False))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=_tz(nullable=False))


class ExamSession(SQLModel, table=True):
    __tablename__ = "exam_session"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id", name="uq_exam_session_assignment_user"),
        Index("ix_exam_session_assignment", "assignment_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("assignment.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True))
    status: str = Field(
        default=ExamSessionStatus.IN_PROGRESS.value,
        sa_column=Column(String(16), nullable=False, default=ExamSessionStatus.IN_PROGRESS.value),
    )
    started_at: datetime = Field(default_factory=utcnow, sa_column=_tz(nullable=False))
    deadline_at: datetime = Field(sa_column=_tz(nullable=False))
    submitted_at: Optional[datetime] = Field(default=None, sa_column=_tz())
    # True when the server submitted for a student whose time ran out.
    auto_submitted: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default="false"))
    last_seen_at: Optional[datetime] = Field(default=None, sa_column=_tz())
    # Latest report from the browser; None until the first heartbeat.
    camera_on: Optional[bool] = Field(default=None, sa_column=Column(Boolean, nullable=True))
    screen_shared: Optional[bool] = Field(default=None, sa_column=Column(Boolean, nullable=True))
    fullscreen: Optional[bool] = Field(default=None, sa_column=Column(Boolean, nullable=True))
    violation_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0, server_default="0"))
    resume_count: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0, server_default="0"))
    # The one browser window allowed to sit the exam: the newest to start or resume wins.
    active_client: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz(nullable=False))


class ExamEvent(SQLModel, table=True):
    __tablename__ = "exam_event"
    __table_args__ = (Index("ix_exam_event_session", "session_id", "id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: int = Field(sa_column=Column(Integer, ForeignKey("exam_session.id", ondelete="CASCADE"), nullable=False))
    kind: str = Field(sa_column=Column(String(40), nullable=False))
    detail: Optional[str] = Field(default=None, sa_column=Column(String(300), nullable=True))
    # Counts towards the violation total shown to staff.
    is_violation: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default="false"))
    created_at: datetime = Field(default_factory=utcnow, sa_column=_tz(nullable=False))


# ---- API schemas ------------------------------------------------------------


class ExamSettingsWrite(BaseModel):
    enabled: bool = True
    duration_minutes: int = PydanticField(default=60, ge=1, le=600)
    opens_at: Optional[datetime] = None
    closes_at: Optional[datetime] = None
    require_camera: bool = True
    require_screen_share: bool = True
    require_fullscreen: bool = True
    watermark: bool = True


class ExamSettingsRead(ExamSettingsWrite):
    assignment_uuid: str


class ExamStatusRead(BaseModel):
    """What the exam screen needs before and during a sitting (never the questions)."""

    settings: Optional[ExamSettingsRead] = None
    window: str = "none"  # none | not_open | open | closed
    session_status: Optional[str] = None  # None until the student starts
    started_at: Optional[datetime] = None
    deadline_at: Optional[datetime] = None
    seconds_left: Optional[int] = None
    # True when the exam was opened in another browser or tab: this window must close.
    superseded: bool = False
    server_time: datetime = PydanticField(default_factory=utcnow)


class ExamClient(BaseModel):
    """Identifies the browser window making the request (random per tab, kept across reloads)."""

    client_id: Optional[str] = PydanticField(default=None, max_length=64)


class ExamHeartbeat(BaseModel):
    client_id: Optional[str] = PydanticField(default=None, max_length=64)
    camera_on: Optional[bool] = None
    screen_shared: Optional[bool] = None
    fullscreen: Optional[bool] = None


class ExamEventCreate(BaseModel):
    client_id: Optional[str] = PydanticField(default=None, max_length=64)
    kind: str = PydanticField(max_length=40)
    detail: Optional[str] = PydanticField(default=None, max_length=300)


class ExamEventRead(BaseModel):
    kind: str
    detail: Optional[str] = None
    is_violation: bool
    created_at: datetime


class ExamRosterRow(BaseModel):
    user_uuid: str
    username: str
    name: str
    status: str  # not_started | in_progress | submitted | time_up
    connected: bool = False
    started_at: Optional[datetime] = None
    deadline_at: Optional[datetime] = None
    seconds_left: Optional[int] = None
    submitted_at: Optional[datetime] = None
    auto_submitted: bool = False
    last_seen_at: Optional[datetime] = None
    camera_on: Optional[bool] = None
    screen_shared: Optional[bool] = None
    fullscreen: Optional[bool] = None
    violation_count: int = 0
    resume_count: int = 0


class ExamMonitorRead(BaseModel):
    assignment_uuid: str
    title: str
    server_time: datetime
    counts: dict
    students: list[ExamRosterRow]
