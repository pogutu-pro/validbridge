"""Exam mode endpoints: settings, a student's sitting, and the staff monitor."""

from typing import List, Optional

from fastapi import APIRouter, Depends, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.exams import (
    ExamClient,
    ExamEventCreate,
    ExamEventRead,
    ExamHeartbeat,
    ExamMonitorRead,
    ExamSettingsRead,
    ExamSettingsWrite,
    ExamStatusRead,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.courses.activities import exams

router = APIRouter()


@router.get("/{assignment_uuid}", response_model=ExamStatusRead, summary="Exam rules and the caller's sitting")
async def api_exam_status(
    request: Request, assignment_uuid: str,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamStatusRead:
    return await exams.read_settings(request, db_session, current_user, assignment_uuid)


@router.put("/{assignment_uuid}", response_model=ExamSettingsRead, summary="Set up exam mode (staff)")
async def api_exam_settings(
    request: Request, assignment_uuid: str, payload: ExamSettingsWrite,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamSettingsRead:
    return await exams.write_settings(request, db_session, current_user, assignment_uuid, payload)


@router.post("/{assignment_uuid}/start", response_model=ExamStatusRead, summary="Start (or resume) your sitting")
async def api_exam_start(
    request: Request, assignment_uuid: str, payload: Optional[ExamClient] = None,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamStatusRead:
    return await exams.start_exam(request, db_session, current_user, assignment_uuid, payload)


@router.post("/{assignment_uuid}/heartbeat", response_model=ExamStatusRead, summary="Report that the exam screen is alive")
async def api_exam_heartbeat(
    request: Request, assignment_uuid: str, payload: ExamHeartbeat,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamStatusRead:
    return await exams.heartbeat(request, db_session, current_user, assignment_uuid, payload)


@router.post("/{assignment_uuid}/events", summary="Report something that happened in the exam screen")
async def api_exam_event(
    request: Request, assignment_uuid: str, payload: ExamEventCreate,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await exams.record_event(request, db_session, current_user, assignment_uuid, payload)


@router.post("/{assignment_uuid}/finish", response_model=ExamStatusRead, summary="Hand in the exam")
async def api_exam_finish(
    request: Request, assignment_uuid: str, payload: Optional[ExamClient] = None,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamStatusRead:
    return await exams.finish_exam(request, db_session, current_user, assignment_uuid, payload)


@router.get("/{assignment_uuid}/monitor", response_model=ExamMonitorRead, summary="Live roster of the sitting (staff)")
async def api_exam_monitor(
    request: Request, assignment_uuid: str,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> ExamMonitorRead:
    return await exams.monitor(request, db_session, current_user, assignment_uuid)


@router.get("/{assignment_uuid}/students/{user_uuid}/events", response_model=List[ExamEventRead], summary="One student's timeline (staff)")
async def api_exam_student_events(
    request: Request, assignment_uuid: str, user_uuid: str,
    db_session: AsyncSession = Depends(get_db_session), current_user: PublicUser = Depends(get_current_user),
) -> List[ExamEventRead]:
    return await exams.student_events(request, db_session, current_user, assignment_uuid, user_uuid)
