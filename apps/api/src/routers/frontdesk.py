"""Front desk (reception) endpoints. Every route checks the front-desk right for the organisation."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.courses.exams import ExamMonitorRead
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.frontdesk import frontdesk

router = APIRouter()

Db = Depends(get_db_session)
Me = Depends(get_current_user)


@router.get("/orgs/{org_id}/students", summary="Find students")
async def api_students(
    request: Request, org_id: int, search: str = "", group_id: Optional[int] = None,
    page: int = Query(default=1, ge=1), limit: int = Query(default=20, ge=1, le=50),
    db: AsyncSession = Db, current_user: PublicUser = Me,
):
    return await frontdesk.list_students(request, db, current_user, org_id, search=search, group_id=group_id, page=page, limit=limit)


@router.get("/orgs/{org_id}/students/{user_uuid}", summary="One student: details, groups, courses, progress, payment status")
async def api_student(request: Request, org_id: int, user_uuid: str, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.student_card(request, db, current_user, org_id, user_uuid)


@router.post("/orgs/{org_id}/invitations", summary="Invite students by email")
async def api_invite(request: Request, org_id: int, payload: frontdesk.InviteStudents, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.invite_students(request, db, current_user, org_id, payload)


@router.get("/orgs/{org_id}/groups", summary="Groups")
async def api_groups(request: Request, org_id: int, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.list_groups(request, db, current_user, org_id)


@router.post("/orgs/{org_id}/groups/{usergroup_id}/students/{user_uuid}", summary="Add a student to a group")
async def api_group_add(request: Request, org_id: int, usergroup_id: int, user_uuid: str, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.add_to_group(request, db, current_user, org_id, usergroup_id, user_uuid)


@router.delete("/orgs/{org_id}/groups/{usergroup_id}/students/{user_uuid}", summary="Remove a student from a group")
async def api_group_remove(request: Request, org_id: int, usergroup_id: int, user_uuid: str, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.remove_from_group(request, db, current_user, org_id, usergroup_id, user_uuid)


@router.get("/orgs/{org_id}/today", summary="Classes and exams coming up")
async def api_today(request: Request, org_id: int, days: int = Query(default=7, ge=1, le=30), db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.today(request, db, current_user, org_id, days=days)


@router.get("/orgs/{org_id}/exams/{assignment_uuid}/roster", response_model=ExamMonitorRead, summary="Live exam roster (read-only)")
async def api_exam_roster(request: Request, org_id: int, assignment_uuid: str, db: AsyncSession = Db, current_user: PublicUser = Me):
    return await frontdesk.exam_roster(request, db, current_user, org_id, assignment_uuid)


@router.post("/orgs/{org_id}/live/{session_uuid}/resend", summary="Resend a class link to one student")
async def api_resend(
    request: Request, org_id: int, session_uuid: str, payload: frontdesk.ResendLink, db: AsyncSession = Db, current_user: PublicUser = Me
):
    return await frontdesk.resend_class_link(request, db, current_user, org_id, session_uuid, payload)
