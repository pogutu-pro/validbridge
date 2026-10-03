import logging
import secrets
from typing import List
from uuid import uuid4
from datetime import datetime
from sqlmodel import select, func
from sqlalchemy import and_, or_
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException, Request
from src.db.courses.certifications import (
    AwardKind,
    Certifications,
    CredentialScopeKind,
    CertificationCreate,
    CertificationRead,
    CertificationUpdate,
    CertificateUser,
    CertificateUserRead,
)
from src.db.courses.courses import Course
from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.trail_steps import TrailStep
from src.db.users import PublicUser, AnonymousUser
from src.security.rbac import check_resource_access, AccessAction
from src.services.analytics.analytics import track
from src.services.analytics import events as analytics_events
from src.services.audit.audit import record_audit_event
from src.db.user_audit_events import UserAuditEventType
from src.services.webhooks.dispatch import dispatch_webhooks

logger = logging.getLogger(__name__)


####################################################
# CRUD
####################################################


async def create_certification(
    request: Request,
    certification_object: CertificationCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> CertificationRead:
    """Create a new certification for a course"""
    
    # Check if course exists
    statement = select(Course).where(Course.id == certification_object.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Create certification
    certification = Certifications(
        course_id=certification_object.course_id,
        config=certification_object.config or {},
        certification_uuid=str(f"certification_{uuid4()}"),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert certification in DB
    db_session.add(certification)
    await db_session.commit()
    await db_session.refresh(certification)

    return CertificationRead(**certification.model_dump())


async def get_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> CertificationRead:
    """Get a single certification by certification_id"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = (await db_session.execute(statement)).scalars().first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    return CertificationRead(**certification.model_dump())


async def get_certifications_by_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[CertificationRead]:
    """Get all certifications for a course"""
    
    # Get course for RBAC check
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    # Get certifications for this course
    statement = select(Certifications).where(Certifications.course_id == course.id)
    certifications = (await db_session.execute(statement)).scalars().all()

    return [CertificationRead(**certification.model_dump()) for certification in certifications]


async def update_certification(
    request: Request,
    certification_uuid: str,
    certification_object: CertificationUpdate,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> CertificationRead:
    """Update a certification"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = (await db_session.execute(statement)).scalars().first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(certification_object).items():
        if value is not None:
            setattr(certification, var, value)

    # Update the update_date
    certification.update_date = str(datetime.now())

    db_session.add(certification)
    await db_session.commit()
    await db_session.refresh(certification)

    return CertificationRead(**certification.model_dump())


async def delete_certification(
    request: Request,
    certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    """Delete a certification"""
    
    statement = select(Certifications).where(Certifications.certification_uuid == certification_uuid)
    certification = (await db_session.execute(statement)).scalars().first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course for RBAC check
    statement = select(Course).where(Course.id == certification.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # CertificateUser.certification_id is declared ON DELETE CASCADE, so deleting
    # the template also destroys every certificate ever awarded from it — the
    # learners' "my certificates" list empties and every verification link they
    # shared, including the QR code printed on already-downloaded PDFs, starts
    # reporting the certificate as revoked. That is irreversible: re-creating the
    # template mints a new id, and nothing re-issues to past graduates.
    #
    # Refuse instead. Awarded certificates must be revoked deliberately, one at a
    # time, through revoke_user_certificate — which also emits the revocation
    # analytics and webhooks that a silent cascade skips entirely.
    awarded_count = (await db_session.execute(
        select(func.count(CertificateUser.id)).where(
            CertificateUser.certification_id == certification.id
        )
    )).scalar_one()

    if awarded_count:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This certification has {awarded_count} awarded "
                f"certificate{'s' if awarded_count != 1 else ''}. Deleting it would "
                "permanently destroy them and break the verification links their "
                "holders have shared. Disable the certification instead, or revoke "
                "the certificates individually first."
            ),
        )

    await db_session.delete(certification)
    await db_session.commit()

    return {"detail": "Certification deleted successfully"}


####################################################
# Certificate User Functions
####################################################


async def create_certificate_user(
    request: Request,
    user_id: int,
    certification_id: int,
    db_session: AsyncSession,
    current_user: PublicUser | AnonymousUser | None = None,
) -> CertificateUserRead:
    """
    Create a certificate user link
    
    SECURITY NOTES:
    - This function should only be called by authorized users (course owners, instructors, or system)
    - When called from check_course_completion_and_create_certificate, it's a system operation
    - When called directly, requires proper RBAC checks
    """
    
    # Check if certification exists
    statement = select(Certifications).where(Certifications.id == certification_id)
    certification = (await db_session.execute(statement)).scalars().first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # SECURITY: If current_user is provided, perform RBAC check
    if current_user:
        # Get course for RBAC check
        statement = select(Course).where(Course.id == certification.course_id)
        course = (await db_session.execute(statement)).scalars().first()

        if not course:
            raise HTTPException(
                status_code=404,
                detail="Course not found",
            )

        # Require course ownership or instructor role for creating certificates
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Check if certificate user already exists
    statement = select(CertificateUser).where(
        CertificateUser.user_id == user_id,
        CertificateUser.certification_id == certification_id
    )
    existing_certificate_user = (await db_session.execute(statement)).scalars().first()

    if existing_certificate_user:
        raise HTTPException(
            status_code=400,
            detail="User already has a certificate for this course",
        )

    # Generate readable certificate user UUID
    current_year = datetime.now().year
    current_month = datetime.now().month
    current_day = datetime.now().day
    
    # Get user to extract user_uuid
    from src.db.users import User
    statement = select(User).where(User.id == user_id)
    user = (await db_session.execute(statement)).scalars().first()
    
    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )
    
    # Extract last 4 characters from user_uuid for uniqueness (since all start with "user_")
    user_uuid_short = user.user_uuid[-4:] if user.user_uuid else "USER"
    
    _alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    random_prefix = secrets.choice(_alpha) + secrets.choice(_alpha)

    today_user_prefix = f"{random_prefix}-{current_year}{current_month:02d}{current_day:02d}-{user_uuid_short}-"

    next_number_str = secrets.token_hex(4)  # 8-char hex suffix, collision-safe

    user_certification_uuid = f"{today_user_prefix}{next_number_str}"

    # Create certificate user
    certificate_user = CertificateUser(
        user_id=user_id,
        certification_id=certification_id,
        user_certification_uuid=user_certification_uuid,
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )

    db_session.add(certificate_user)
    try:
        await db_session.commit()
    except IntegrityError:
        # A concurrent completion check inserted the certificate first. The
        # unique (user_id, certification_id) constraint tripped — treat it as
        # "already issued" and return the existing row instead of 500-ing.
        await db_session.rollback()
        existing = (
            await db_session.execute(
                select(CertificateUser).where(
                    CertificateUser.user_id == user_id,
                    CertificateUser.certification_id == certification_id,
                )
            )
        ).scalars().first()
        if existing:
            return CertificateUserRead(**existing.model_dump())
        raise
    await db_session.refresh(certificate_user)

    # Track certificate_claimed event for analytics and webhooks
    try:
        course = (await db_session.execute(
            select(Course).where(Course.id == certification.course_id)
        )).scalars().first()
        if course:
            await track(
                event_name=analytics_events.CERTIFICATE_CLAIMED,
                org_id=course.org_id,
                user_id=user_id,
                properties={
                    "course_uuid": course.course_uuid,
                },
            )
            await record_audit_event(
                event_type=UserAuditEventType.CERTIFICATE_CLAIMED,
                user_id=user_id,
                org_id=course.org_id,
                target_uuid=user_certification_uuid,
                metadata={
                    "course_uuid": course.course_uuid,
                    "course_name": course.name,
                },
            )
            await dispatch_webhooks(
                event_name=analytics_events.CERTIFICATE_CLAIMED,
                org_id=course.org_id,
                data={
                    "user": {
                        "user_uuid": user.user_uuid,
                        "email": user.email,
                        "username": user.username,
                    },
                    "course": {
                        "course_uuid": course.course_uuid,
                        "name": course.name,
                    },
                    "certificate": {
                        "user_certification_uuid": certificate_user.user_certification_uuid,
                    },
                },
            )
    except Exception as e:
        logger.warning("Certificate tracking failed (non-critical): %s", e)

    return CertificateUserRead(**certificate_user.model_dump())


async def revoke_user_certificate(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
    reason: str = "revoked",
) -> bool:
    """Revoke any certificate this user holds for the given course.

    Deletes the CertificateUser row and emits a ``certificate_revoked``
    analytics + webhook event so downstream systems learn the certificate is no
    longer valid (previously the row was silently deleted on retry/reject with
    no signal, and a re-pass fired a second ``certificate_claimed``). No-ops and
    returns False when the course has no certification or the user holds none.
    The event dispatch is best-effort and never fails the caller.
    """
    from src.db.users import User

    certification = await get_course_certification(course_id, db_session)
    if not certification or not certification.id:
        return False

    cert_user = (await db_session.execute(
        select(CertificateUser).where(
            CertificateUser.user_id == user_id,
            CertificateUser.certification_id == certification.id,
        )
    )).scalars().first()
    if not cert_user:
        return False

    revoked_uuid = cert_user.user_certification_uuid
    await db_session.delete(cert_user)
    await db_session.commit()

    # Best-effort revocation event (mirrors the claimed-event payload shape).
    try:
        course = (await db_session.execute(
            select(Course).where(Course.id == course_id)
        )).scalars().first()
        user = (await db_session.execute(
            select(User).where(User.id == user_id)
        )).scalars().first()
        if course:
            await track(
                event_name=analytics_events.CERTIFICATE_REVOKED,
                org_id=course.org_id,
                user_id=user_id,
                properties={"course_uuid": course.course_uuid, "reason": reason},
            )
            await dispatch_webhooks(
                event_name=analytics_events.CERTIFICATE_REVOKED,
                org_id=course.org_id,
                data={
                    "user": {
                        "user_uuid": getattr(user, "user_uuid", None),
                        "email": getattr(user, "email", None),
                        "username": getattr(user, "username", None),
                    },
                    "course": {
                        "course_uuid": course.course_uuid,
                        "name": course.name,
                    },
                    "certificate": {"user_certification_uuid": revoked_uuid},
                    "reason": reason,
                },
            )
    except Exception as e:
        logger.warning("Certificate revocation tracking failed (non-critical): %s", e)

    return True


async def get_user_certificates_for_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[dict]:
    """Get all certificates for a user in a specific course with certification details"""
    
    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course_uuid, AccessAction.READ)

    # Get all certifications for this course
    statement = select(Certifications).where(Certifications.course_id == course.id)
    certifications = (await db_session.execute(statement)).scalars().all()

    if not certifications:
        return []

    # Get all certificate users for this user and these certifications
    certification_ids = [cert.id for cert in certifications if cert.id]
    if not certification_ids:
        return []

    # Batch fetch all certificate users for this user and these certifications
    statement = select(CertificateUser).where(
        CertificateUser.user_id == current_user.id,
        CertificateUser.certification_id.in_(certification_ids)  # type: ignore
    )
    cert_users = (await db_session.execute(statement)).scalars().all()

    if not cert_users:
        return []

    # Build a map of certification_id -> Certifications (already fetched above)
    cert_map = {cert.id: cert for cert in certifications if cert.id}

    # The recipient is always the requesting user (query filters on
    # current_user.id), so the name can be attached without an extra lookup.
    # Needed so the certificate page/PDF can show who it was awarded to.
    recipient = {
        "user_uuid": getattr(current_user, "user_uuid", None),
        "username": getattr(current_user, "username", None),
        "first_name": getattr(current_user, "first_name", None),
        "last_name": getattr(current_user, "last_name", None),
    }

    result = []
    for cert_user in cert_users:
        certification = cert_map.get(cert_user.certification_id)
        result.append({
            "certificate_user": CertificateUserRead(**cert_user.model_dump()),
            "certification": CertificationRead(**certification.model_dump()) if certification else None,
            "user": recipient,
        })

    return result


async def is_course_fully_completed(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Pure completion check: returns True iff every activity in the course has
    a completed TrailStep for the given user. No side effects, no certificate
    involvement.

    Uses COUNT aggregates instead of fetching all rows so this stays fast
    even on large courses.
    """
    # Only PUBLISHED activities count toward completion — a draft/unpublished
    # activity is never shown to the learner, so counting it in the total would
    # make the course impossible to complete (and permanently withhold the
    # certificate).
    #
    # DISTINCT on activity_id, matching the distinct count on the numerator
    # below. Counting ChapterActivity *rows* would double-count any activity
    # placed in two chapters (the join table only forbids the same
    # chapter/activity pair, not the same activity in two different chapters),
    # inflating the denominator past the number of distinct completions and
    # making the course permanently uncompletable.
    total_activities = (await db_session.execute(
        select(func.count(func.distinct(ChapterActivity.activity_id)))
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(ChapterActivity.course_id == course_id, Activity.published == True)
    )).scalar_one()
    if not total_activities:
        return False

    completed_activities = (await db_session.execute(
        select(func.count(func.distinct(TrailStep.activity_id)))
        .join(
            ChapterActivity,
            (ChapterActivity.activity_id == TrailStep.activity_id)
            & (ChapterActivity.course_id == TrailStep.course_id),
        )
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course_id,
            TrailStep.complete == True,
            Activity.published == True,
        )
    )).scalar_one()

    return completed_activities >= total_activities


def _course_scope_filter():
    """
    Predicate matching only the course-level certificate for a course.

    Every ``.first()`` lookup that means "the certificate for this course" must
    go through this. Chapter milestones are rows in the same table, so a plain
    ``where(course_id == X)`` can return a milestone and the caller will then
    issue, revoke or gate on a chapter credential by mistake.

    NULL scope_kind is treated as COURSE because that is what every row written
    before scope existed has.
    """
    return and_(
        or_(
            Certifications.scope_kind.is_(None),
            Certifications.scope_kind == CredentialScopeKind.COURSE.value,
        ),
        Certifications.scope_id.is_(None),
    )


async def get_course_certification(
    course_id: int,
    db_session: AsyncSession,
) -> Certifications | None:
    """The single course-level Certifications row for a course, or None."""
    return (await db_session.execute(
        select(Certifications)
        .where(Certifications.course_id == course_id)
        .where(_course_scope_filter())
        .order_by(Certifications.id)
    )).scalars().first()


async def get_chapter_certification(
    course_id: int,
    chapter_id: int,
    db_session: AsyncSession,
) -> Certifications | None:
    """The milestone Certifications row for one chapter of a course, or None.

    Created on demand by the award path, so an author never has to remember to
    add one per chapter.
    """
    return (await db_session.execute(
        select(Certifications)
        .where(Certifications.course_id == course_id)
        .where(Certifications.scope_kind == CredentialScopeKind.CHAPTER.value)
        .where(Certifications.scope_id == chapter_id)
        .order_by(Certifications.id)
    )).scalars().first()


async def is_chapter_fully_completed(
    user_id: int,
    chapter_id: int,
    db_session: AsyncSession,
) -> bool:
    """
    Chapter-level counterpart to :func:`is_course_fully_completed`, and the
    trigger condition for awarding a chapter milestone.

    Pure check — no side effects, no credential writes. Awarding is a separate
    step so that this stays safe to call from a GET (the learner UI asks
    "have I earned this yet?" on every chapter load) without a write path
    hidden inside it.

    Same two invariants as the course version:
      * only PUBLISHED activities count, or a draft would withhold the
        milestone forever;
      * COUNT(DISTINCT) on both sides, so the numerator and denominator can
        never disagree about how many distinct activities there are.

    At chapter scope the DISTINCT is belt-and-braces rather than a live fix —
    filtering on chapter_id already collapses an activity shared with another
    chapter — but the numerator joins TrailStep back to ChapterActivity without
    repeating the chapter filter, so keeping both sides distinct is what
    guarantees they stay comparable if that join is ever loosened.

    An empty chapter is NOT complete. A chapter with nothing published in it is
    an authoring state, not a finished one, and treating it as complete would
    mint a milestone for a chapter that has no content.
    """
    total_activities = (await db_session.execute(
        select(func.count(func.distinct(ChapterActivity.activity_id)))
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(
            ChapterActivity.chapter_id == chapter_id,
            Activity.published == True,
        )
    )).scalar_one()
    if not total_activities:
        return False

    completed_activities = (await db_session.execute(
        select(func.count(func.distinct(TrailStep.activity_id)))
        .join(
            ChapterActivity,
            (ChapterActivity.activity_id == TrailStep.activity_id)
            & (ChapterActivity.chapter_id == chapter_id),
        )
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(
            TrailStep.user_id == user_id,
            TrailStep.complete == True,
            Activity.published == True,
        )
    )).scalar_one()

    return completed_activities >= total_activities


async def get_chapter_activities_for_learner(
    chapter_id: int,
    db_session: AsyncSession,
) -> list[int]:
    """
    The distinct published activity ids in a chapter, in author order.

    Returned alongside the completion check by the milestone award path so it
    can decide which assessment in the chapter represents the learner (for
    award_kind) without re-querying per candidate.
    """
    rows = (await db_session.execute(
        select(ChapterActivity.activity_id)
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(
            ChapterActivity.chapter_id == chapter_id,
            Activity.published == True,
        )
        .distinct()
        .order_by(ChapterActivity.order)
    )).scalars().all()
    return list(rows)


async def sync_trailrun_status(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
    is_complete: bool | None = None,
) -> None:
    """
    Keep the enrollment row (TrailRun.status) in sync with actual course
    completion. This is the single field every enrollment/analytics "completed"
    vs "in progress" number is derived from, yet nothing used to flip it — so
    fully completed, certified learners still counted as in-progress.

    Derives the status from :func:`is_course_fully_completed` and promotes the
    run to STATUS_COMPLETED when done, or demotes it back to STATUS_IN_PROGRESS
    if completion was lost (e.g. an activity was un-completed). PAUSED and
    CANCELLED runs are left untouched — those are explicit learner/teacher
    states, not derived from progress. No-ops when nothing needs to change.
    """
    from src.db.trail_runs import TrailRun, StatusEnum

    trailrun = (await db_session.execute(
        select(TrailRun).where(
            TrailRun.course_id == course_id,
            TrailRun.user_id == user_id,
        )
    )).scalars().first()

    if not trailrun:
        return

    # Only completion-derived states are managed here.
    if trailrun.status not in (
        StatusEnum.STATUS_IN_PROGRESS,
        StatusEnum.STATUS_COMPLETED,
    ):
        return

    # Callers that already know whether the course is complete pass it in —
    # this same pair of aggregates otherwise runs several times per submit.
    if is_complete is None:
        is_complete = await is_course_fully_completed(user_id, course_id, db_session)
    target = (
        StatusEnum.STATUS_COMPLETED if is_complete else StatusEnum.STATUS_IN_PROGRESS
    )

    if trailrun.status != target:
        trailrun.status = target
        trailrun.update_date = str(datetime.now())
        db_session.add(trailrun)
        await db_session.commit()


async def _load_course_assessments(
    course_id: int,
    db_session: AsyncSession,
) -> list:
    """
    The assessments that actually count toward a course's certification:
    assignments sitting on PUBLISHED activities that really are in this course.

    Drafts are excluded (a learner has never seen them, so they cannot gate a
    certificate) and the activity list comes from a subquery rather than a join,
    so an activity placed in two chapters is not counted twice.
    """
    from src.db.courses.assignments import Assignment

    return list((await db_session.execute(
        select(Assignment).where(
            Assignment.course_id == course_id,
            Assignment.activity_id.in_(
                select(ChapterActivity.activity_id)
                .join(Activity, Activity.id == ChapterActivity.activity_id)
                .where(
                    ChapterActivity.course_id == course_id,
                    Activity.published == True,
                )
            ),
        )
    )).scalars().all())


async def _evaluate_course_assessments(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
) -> list[dict]:
    """
    Score every gradable assessment in the course for one learner.

    Every assessment in the course gets a record, tagged with what it can
    contribute, because the three kinds are governed by three different rules
    and conflating them is how a course ends up with a certificate nobody
    expected:

      gradable   has gradable points and is not formative. Can pass or fail,
                 and is the only kind that carries weight.
      formative  marked ungraded. Has no grade, so it can never "pass"; the
                 legacy rule is that it is satisfied by being handed in at all.
      neither    no gradable points (no tasks / all-zero max). Vacuously
                 satisfied — there is nothing to pass or fail — and, like
                 formative work, cannot carry a weight.

    Each record carries:
      assignment     the row
      weight         the author's weight, or None
      gradable       bool — participates in pass/fail AND in the weighted total
      formative      bool — satisfied by submission alone
      percentage     the score 0-100, or None when not yet gradable
      passed         whether it clears the assignment's own threshold, or None
      submitted      whether anything was handed in
    """
    from src.db.courses.assignments import (
        AssignmentTask,
        AssignmentUserSubmission,
        AssignmentUserSubmissionStatus,
    )
    from src.services.courses.activities.assignments import (
        _HANDED_IN_STATUSES,
        compute_assignment_grade,
    )

    assignments = await _load_course_assessments(course_id, db_session)
    if not assignments:
        return []

    assignment_ids = [a.id for a in assignments if a.id is not None]

    # Max grade per assignment (sum of task max values), one grouped query.
    max_rows = (await db_session.execute(
        select(
            AssignmentTask.assignment_id,
            func.coalesce(func.sum(AssignmentTask.max_grade_value), 0),
        )
        .where(AssignmentTask.assignment_id.in_(assignment_ids))
        .group_by(AssignmentTask.assignment_id)
    )).all()
    max_by_assignment = {aid: int(m or 0) for aid, m in max_rows}

    # This user's submission per assignment (at most one row each).
    subs = (await db_session.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.user_id == user_id,
            AssignmentUserSubmission.assignment_id.in_(assignment_ids),
        )
    )).scalars().all()
    sub_by_assignment = {s.assignment_id: s for s in subs}

    results: list[dict] = []
    for assignment in assignments:
        formative = bool(getattr(assignment, "ungraded", False))
        has_points = max_by_assignment.get(assignment.id, 0) > 0
        gradable = has_points and not formative

        sub = sub_by_assignment.get(assignment.id)
        submitted = sub is not None and (
            sub.submission_status in _HANDED_IN_STATUSES
        )
        percentage = None
        passed = None
        # Only gradable work has a grade to read. A formative submission never
        # reaches GRADED, so gating this on `gradable` also keeps the legacy
        # rule that an ungraded assignment can never fail.
        if gradable and sub is not None and (
            sub.submission_status == AssignmentUserSubmissionStatus.GRADED
        ):
            computed = compute_assignment_grade(
                int(sub.grade or 0),
                max_by_assignment.get(assignment.id, 0),
                assignment.grading_type,
                pass_threshold_percentage=assignment.pass_threshold_percentage,
            )
            percentage = computed.get("percentage")
            passed = bool(computed.get("passed"))

        results.append({
            "assignment": assignment,
            "weight": getattr(assignment, "weight", None),
            "gradable": gradable,
            "formative": formative,
            "percentage": float(percentage) if percentage is not None else None,
            "passed": passed,
            "submitted": submitted,
        })
    return results


# Weights are authored as percentages by hand, so a total of exactly 100 is not a
# reasonable expectation. This tolerance absorbs float addition and lets
# 33.3 + 33.3 + 33.4 through.
_WEIGHT_SUM_TOLERANCE = 0.01

# Used when a course certifies by weighted aggregate but the author has not set
# a course-level threshold. Matches the per-assessment default most grading
# types already use, so switching modes does not silently move the bar.
DEFAULT_WEIGHTED_PASS_THRESHOLD = 50.0


def _gradable_records(records: list[dict]) -> list[dict]:
    """
    The assessments that can actually carry a weight and be scored.

    Formative work and zero-point assessments are excluded from the arithmetic
    entirely rather than counted as zero — an author who marks a third of the
    course ungraded should still get weighted mode over the rest, not a total
    that can never be reached.
    """
    return [r for r in records if r.get("gradable", True)]


def resolve_certification_mode(records: list[dict]) -> tuple[str, float]:
    """
    Decide whether a course certifies by weighted aggregate or all-must-pass.

    Weighted mode requires EVERY gradable assessment to carry a weight AND those
    weights to total 100 (+/- tolerance). Anything else — one NULL weight, a
    total of 95, a total of 140 — falls back to the legacy rule.

    That strictness is the whole safety story. An author who weights two of five
    assessments gets the old all-must-pass behaviour rather than a certificate
    computed from a 40% total, so the feature cannot be half-enabled into a
    wrong answer.

    Returns (mode, threshold) where mode is "WEIGHTED" or "AND".
    """
    gradable = _gradable_records(records)
    if not gradable:
        return "AND", DEFAULT_WEIGHTED_PASS_THRESHOLD

    weights = [r["weight"] for r in gradable]
    if any(w is None for w in weights):
        return "AND", DEFAULT_WEIGHTED_PASS_THRESHOLD

    total = float(sum(float(w) for w in weights))  # type: ignore[arg-type]
    if abs(total - 100.0) > _WEIGHT_SUM_TOLERANCE:
        return "AND", DEFAULT_WEIGHTED_PASS_THRESHOLD

    return "WEIGHTED", DEFAULT_WEIGHTED_PASS_THRESHOLD


async def get_course_pass_threshold(
    course_id: int,
    db_session: AsyncSession,
) -> float | None:
    """
    The course's own threshold for weighted mode, or None to use the default.

    Callers that re-evaluate the gate for an existing certificate (regrades,
    revocations) already have the certification row in hand and should read the
    field directly; this exists for the paths that don't.
    """
    certification = await get_course_certification(course_id, db_session)
    if certification is None:
        return None
    return certification.pass_threshold_percentage


async def compute_course_certification_score(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
    pass_threshold_percentage: float | None = None,
) -> dict:
    """
    The full picture behind a certification decision, for the gate and for the
    learner's "am I there yet?" view.

    mode          "WEIGHTED" or "AND"
    passed        the actual decision
    percentage    the weighted aggregate, or None in AND mode
    threshold     the bar that was applied
    breakdown     per-assessment detail, so a learner can be told exactly which
                  assessment is holding them up instead of just "not yet"

    An assessment with no submission, or one still awaiting grading, counts as
    zero in the weighted total. That is deliberate: it withholds the certificate
    exactly as AND mode does, so enabling weights cannot turn an unfinished
    course into a certified one.
    """
    records = await _evaluate_course_assessments(user_id, course_id, db_session)

    if not records:
        return {
            "mode": "AND",
            "passed": True,
            "percentage": None,
            "threshold": DEFAULT_WEIGHTED_PASS_THRESHOLD,
            "breakdown": [],
        }

    gradable = _gradable_records(records)
    mode, default_threshold = resolve_certification_mode(records)
    threshold = (
        float(pass_threshold_percentage)
        if pass_threshold_percentage is not None
        else default_threshold
    )

    breakdown = [{
        "assignment_uuid": r["assignment"].assignment_uuid,
        "assessment_kind": getattr(r["assignment"], "assessment_kind", None),
        "title": getattr(r["assignment"], "title", None),
        "weight": r["weight"],
        "gradable": r.get("gradable", True),
        "formative": r.get("formative", False),
        "percentage": r["percentage"],
        "passed": r["passed"],
        "submitted": r["submitted"],
    } for r in records]

    if mode == "AND":
        # Legacy rule, unchanged. Three cases, exactly as before this feature:
        #   gradable   must be graded AND pass
        #   formative  must have been handed in (it has no grade to pass)
        #   neither    vacuously satisfied — nothing to pass or fail
        blocked = False
        for r in records:
            if r.get("formative", False):
                if not r["submitted"]:
                    blocked = True
                    break
            elif r.get("gradable", True):
                if r["passed"] is not True:
                    blocked = True
                    break
        return {
            "mode": mode,
            "passed": not blocked,
            "percentage": None,
            "threshold": threshold,
            "breakdown": breakdown,
        }

    total = 0.0
    for r in gradable:
        weight = float(r["weight"])  # type: ignore[arg-type]
        # Not yet graded or not yet submitted contributes zero rather than being
        # skipped — skipping it would inflate the aggregate past 100 and let a
        # half-finished course certify.
        contribution = (r["percentage"] or 0.0) * (weight / 100.0)
        total += contribution

    total = max(0.0, min(100.0, total))
    return {
        "mode": mode,
        "passed": total >= threshold,
        "percentage": round(total, 2),
        "threshold": threshold,
        "breakdown": breakdown,
    }


async def are_course_assignments_passed(
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
    pass_threshold_percentage: float | None = None,
) -> bool:
    """
    Certificate eligibility gate: is this learner entitled to the certificate?

    Delegates to :func:`compute_course_certification_score` so the boolean the
    gate uses and the breakdown shown to the learner can never disagree — the
    two used to be separate code paths, which is how a "certified" learner ends
    up with a score display that says otherwise.

    ``pass_threshold_percentage`` is the course-level bar for weighted mode and
    is ignored in AND mode, where each assessment keeps using its own threshold.
    """
    result = await compute_course_certification_score(
        user_id, course_id, db_session,
        pass_threshold_percentage=pass_threshold_percentage,
    )
    return bool(result["passed"])


_AWARD_RANK = {
    AwardKind.COMPLETED.value: 0,
    AwardKind.PARTICIPATED.value: 1,
    AwardKind.PASSED.value: 2,
}


def _is_stronger_award(new_kind: str, existing_kind: str | None) -> bool:
    """Whether ``new_kind`` may replace ``existing_kind`` on an issued milestone.

    Escalation only, never downgrade. A learner who failed a CAT holds
    PARTICIPATED; passing later upgrades the same credential to PASSED. But a
    re-grade that lowers a score, or a re-run that finds no graded assessment,
    must not silently retract a "passed" claim from a link the learner has
    already shared — that would make an already-published credential change
    meaning without warning, which is exactly what the award snapshot exists to
    prevent.
    """
    if not existing_kind:
        return True
    return _AWARD_RANK.get(new_kind, 0) > _AWARD_RANK.get(existing_kind, 0)


async def _resolve_chapter_award_kind(
    user_id: int,
    course_id: int,
    chapter_id: int,
    db_session: AsyncSession,
) -> tuple[str, dict]:
    """
    Decide what a completed chapter actually earned, and build the snapshot.

    PASSED     the chapter's graded assessment was passed.
    PARTICIPATED the learner attempted it and did not pass.
    COMPLETED  the chapter has nothing graded in it — the work is done, but no
               skill has been demonstrated, so the credential must not imply one.

    Reuses the same grader and the same per-assignment threshold as the course
    certificate gate, so a milestone never disagrees with the score the learner
    was shown.
    """
    from src.db.courses.assignments import (
        Assignment,
        AssignmentTask,
        AssignmentUserSubmission,
        AssignmentUserSubmissionStatus,
    )
    from src.services.courses.activities.assignments import (
        _HANDED_IN_STATUSES,
        compute_assignment_grade,
    )

    assignments = (await db_session.execute(
        select(Assignment).where(
            Assignment.course_id == course_id,
            Assignment.activity_id.in_(
                select(ChapterActivity.activity_id)
                .join(Activity, Activity.id == ChapterActivity.activity_id)
                .where(
                    ChapterActivity.chapter_id == chapter_id,
                    Activity.published == True,
                )
            ),
        )
    )).scalars().all()

    if not assignments:
        return AwardKind.COMPLETED.value, {}

    assignment_ids = [a.id for a in assignments if a.id is not None]
    max_rows = (await db_session.execute(
        select(
            AssignmentTask.assignment_id,
            func.coalesce(func.sum(AssignmentTask.max_grade_value), 0),
        )
        .where(AssignmentTask.assignment_id.in_(assignment_ids))
        .group_by(AssignmentTask.assignment_id)
    )).all()
    max_by_assignment = {aid: int(m or 0) for aid, m in max_rows}

    subs = (await db_session.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.user_id == user_id,
            AssignmentUserSubmission.assignment_id.in_(assignment_ids),
        )
    )).scalars().all()
    sub_by_assignment = {s.assignment_id: s for s in subs}

    passed_any = False
    attempted_any = False
    best_percentage: float | None = None

    for assignment in assignments:
        max_grade = max_by_assignment.get(assignment.id, 0)
        sub = sub_by_assignment.get(assignment.id)
        if sub is None:
            continue

        # A formative assignment is never graded, so it can neither pass nor
        # fail. Handing it in counts as attempting the chapter, nothing more.
        if getattr(assignment, "ungraded", False):
            if sub.submission_status in _HANDED_IN_STATUSES:
                attempted_any = True
            continue

        # No gradable points: nothing to demonstrate.
        if max_grade <= 0:
            continue

        if sub.submission_status not in _HANDED_IN_STATUSES:
            continue
        attempted_any = True

        if sub.submission_status != AssignmentUserSubmissionStatus.GRADED:
            continue

        computed = compute_assignment_grade(
            int(sub.grade or 0),
            max_grade,
            assignment.grading_type,
            pass_threshold_percentage=assignment.pass_threshold_percentage,
        )
        percentage = computed.get("percentage")
        if percentage is not None:
            pct = float(percentage)
            if best_percentage is None or pct > best_percentage:
                best_percentage = pct
        if computed.get("passed"):
            passed_any = True

    if passed_any:
        kind = AwardKind.PASSED.value
    elif attempted_any:
        kind = AwardKind.PARTICIPATED.value
    else:
        kind = AwardKind.COMPLETED.value

    snapshot: dict = {}
    if best_percentage is not None:
        snapshot["percentage"] = best_percentage
    return kind, snapshot


async def award_chapter_milestone(
    request: Request,
    user_id: int,
    course_id: int,
    chapter_id: int,
    db_session: AsyncSession,
    is_complete: bool | None = None,
) -> dict | None:
    """
    Award (or escalate) the chapter milestone for one learner, if earned.

    Returns a small result dict, or None when nothing was awarded and nothing
    changed — so the caller can tell "not earned yet" from "already held".
    Mirrors ``check_course_completion_and_create_certificate``: it returns a
    value only when it actually wrote something.

    Milestones ride along with certification: a course with no course-level
    certification gets no milestones. That is the whole opt-in — an author
    enables certification once and every chapter becomes creditable, instead of
    toggling a flag per chapter and leaving some chapters silently uncredible.

    The chapter's Certifications row is created on demand and inherits the
    course certificate's ``config``, so branding, layout and the shared preview
    component apply to every milestone without per-chapter authoring.

    Idempotent and safe to call on every completion: re-running holds no second
    credential, and only ever escalates the award kind.
    """
    if is_complete is None:
        is_complete = await is_chapter_fully_completed(
            user_id, chapter_id, db_session
        )
    if not is_complete:
        return None

    course_certification = await get_course_certification(course_id, db_session)
    if not course_certification:
        # Certification is the opt-in for milestones too.
        return None

    chapter_certification = await get_chapter_certification(
        course_id, chapter_id, db_session
    )
    if not chapter_certification:
        chapter_certification = Certifications(
            course_id=course_id,
            config=dict(course_certification.config or {}),
            certification_uuid=f"milestone_{uuid4().hex[:16]}",
            scope_kind=CredentialScopeKind.CHAPTER.value,
            scope_id=chapter_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(chapter_certification)
        try:
            await db_session.commit()
        except IntegrityError:
            # Another completion for the same chapter created it first.
            await db_session.rollback()
            chapter_certification = await get_chapter_certification(
                course_id, chapter_id, db_session
            )
            if not chapter_certification:
                raise
        else:
            await db_session.refresh(chapter_certification)

    if not chapter_certification or not chapter_certification.id:
        return None

    award_kind, snapshot = await _resolve_chapter_award_kind(
        user_id, course_id, chapter_id, db_session
    )

    # Snapshot the chapter's position and title as awarded. Renaming a chapter
    # later must not rewrite a credential that is already in someone's feed.
    from src.db.courses.chapters import Chapter
    chapter = (await db_session.execute(
        select(Chapter).where(Chapter.id == chapter_id)
    )).scalars().first()
    if chapter is not None:
        snapshot["chapter_name"] = chapter.name

    total_chapters = (await db_session.execute(
        select(func.count(func.distinct(Chapter.id)))
        .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)
        .join(Activity, Activity.id == ChapterActivity.activity_id)
        .where(ChapterActivity.course_id == course_id, Activity.published == True)
    )).scalar_one()
    sibling_orders = (await db_session.execute(
        select(func.min(ChapterActivity.order))
        .where(
            ChapterActivity.chapter_id == chapter_id,
            ChapterActivity.course_id == course_id,
        )
    )).scalar_one()
    if sibling_orders is not None and total_chapters:
        snapshot["chapter_position"] = {
            "index": int(sibling_orders),
            "total": int(total_chapters),
        }

    existing = (await db_session.execute(
        select(CertificateUser).where(
            CertificateUser.user_id == user_id,
            CertificateUser.certification_id == chapter_certification.id,
        )
    )).scalars().first()

    if existing:
        if not _is_stronger_award(award_kind, existing.award_kind):
            return None
        existing.award_kind = award_kind
        existing.award_detail = snapshot
        existing.updated_at = str(datetime.now())
        db_session.add(existing)
        await db_session.commit()
        await db_session.refresh(existing)
        return {
            "certificate_user": CertificateUserRead(**existing.model_dump()),
            "certification": CertificationRead(**chapter_certification.model_dump()),
            "escalated": True,
        }

    from src.db.users import User
    user = (await db_session.execute(
        select(User).where(User.id == user_id)
    )).scalars().first()
    if not user:
        return None

    now = datetime.now()
    user_uuid_short = user.user_uuid[-4:] if user.user_uuid else "USER"
    _alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    random_prefix = secrets.choice(_alpha) + secrets.choice(_alpha)
    prefix = (
        f"{random_prefix}-{now.year}{now.month:02d}{now.day:02d}"
        f"-{user_uuid_short}-"
    )

    issued = CertificateUser(
        user_id=user_id,
        certification_id=chapter_certification.id,
        user_certification_uuid=f"{prefix}{secrets.token_hex(4)}",
        award_kind=award_kind,
        award_detail=snapshot,
        created_at=str(now),
        updated_at=str(now),
    )
    db_session.add(issued)
    try:
        await db_session.commit()
    except IntegrityError:
        # Concurrent award won the race; treat as already held rather than 500.
        await db_session.rollback()
        return None
    await db_session.refresh(issued)

    return {
        "certificate_user": CertificateUserRead(**issued.model_dump()),
        "certification": CertificationRead(**chapter_certification.model_dump()),
        "escalated": False,
    }


async def award_milestone_for_activity_completion(
    request: Request,
    user_id: int,
    course_id: int,
    activity_id: int,
    db_session: AsyncSession,
) -> dict | None:
    """
    Award the milestone for whichever chapter contains ``activity_id``.

    This is the shape the completion callers actually have: they know the
    activity they just finished, not the chapter. Resolving the chapter here
    keeps every call site to one line and stops them from having to remember
    which chapter an activity belongs to.

    An activity placed in two chapters awards both. That is the same shape the
    completion denominators already tolerate, and awarding only one of them
    would be arbitrary.

    Never raises. A milestone is a nice-to-have on top of a submission that has
    already been saved, so a failure here must not roll back or 500 the flow
    that triggered it — the next completion attempt retries it anyway, because
    the whole path is idempotent.
    """
    chapter_ids = (await db_session.execute(
        select(func.distinct(ChapterActivity.chapter_id))
        .where(
            ChapterActivity.course_id == course_id,
            ChapterActivity.activity_id == activity_id,
        )
    )).scalars().all()

    awarded = None
    for chapter_id in chapter_ids:
        try:
            result = await award_chapter_milestone(
                request, user_id, course_id, chapter_id, db_session
            )
        except Exception:
            continue
        if result and awarded is None:
            awarded = result
    return awarded


async def check_course_completion_and_create_certificate(
    request: Request,
    user_id: int,
    course_id: int,
    db_session: AsyncSession,
    is_complete: bool | None = None,
) -> bool:
    """
    Check if all activities in a course are completed and create certificate if so.

    NOTE: Returns True only when this call *creates a new certificate row*.
    That is False for courses without a certification even when the course is
    actually complete — do NOT use this return value as the trigger for
    ``course_completed`` webhooks. Use :func:`is_course_fully_completed` for
    that, and call this function purely for the certificate side effect.

    ``is_complete`` lets a caller that has already run
    :func:`is_course_fully_completed` hand the answer over. The completion
    aggregates are identical, and the submit path used to run them three times
    for one submission: once here, once inside ``sync_trailrun_status``, and
    once more in the caller to gate the ``course_completed`` event.

    SECURITY NOTES:
    - This function is called by the system when activities are completed
    - It should only create certificates for users who have actually completed the course
    - The function is called from mark_activity_as_done_for_user which already has RBAC checks
    """
    # Keep the enrollment status (TrailRun.status) in sync on every completion
    # check. Assignment activities render their own submit flow instead of going
    # through add_activity_to_trail, so when the last activity in a course is an
    # assignment nothing else would flip the run to COMPLETED — leaving a
    # certified learner reported as "in progress" in analytics/enrollment. This
    # is idempotent (no-op when already correct) and also demotes if completion
    # was lost.
    # Same rule as is_course_fully_completed: only PUBLISHED activities count,
    # so a draft activity can't permanently block completion + certificate
    # issuance.
    if is_complete is None:
        is_complete = await is_course_fully_completed(user_id, course_id, db_session)

    await sync_trailrun_status(user_id, course_id, db_session, is_complete=is_complete)

    if is_complete:
        # All activities completed, check if certification exists for this
        # course. Course-scoped lookup on purpose: a chapter milestone lives in
        # the same table, and picking one here would issue the chapter's
        # credential a second time under the course-completion path.
        certification = await get_course_certification(course_id, db_session)
        
        if certification and certification.id:
            # Certificate integrity: completion is necessary but not sufficient —
            # every graded assignment in the course must be passed. This withholds
            # the certificate from learners who finished all activities but failed
            # (or haven't yet been graded on) a required assessment.
            if not await are_course_assignments_passed(
                user_id, course_id, db_session,
                pass_threshold_percentage=certification.pass_threshold_percentage,
            ):
                return False
            # SECURITY: Create certificate user link (system operation, no RBAC needed here)
            # This is called from mark_activity_as_done_for_user which already has proper RBAC checks
            try:
                await create_certificate_user(request, user_id, certification.id, db_session)
                return True  # Newly completed
            except HTTPException as e:
                if e.status_code == 400 and "already has a certificate" in e.detail:
                    # Certificate already exists — course was completed before
                    return False
                else:
                    raise e
        
    return False


async def get_certificate_by_user_certification_uuid(
    request: Request,
    user_certification_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> dict:
    """Get a certificate by user_certification_uuid with certification details"""
    
    # Get certificate user by user_certification_uuid
    statement = select(CertificateUser).where(
        CertificateUser.user_certification_uuid == user_certification_uuid
    )
    certificate_user = (await db_session.execute(statement)).scalars().first()

    if not certificate_user:
        raise HTTPException(
            status_code=404,
            detail="Certificate not found",
        )

    # Get the associated certification
    statement = select(Certifications).where(Certifications.id == certificate_user.certification_id)
    certification = (await db_session.execute(statement)).scalars().first()

    if not certification:
        raise HTTPException(
            status_code=404,
            detail="Certification not found",
        )

    # Get course information
    statement = select(Course).where(Course.id == certification.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # No RBAC check - allow anyone to access certificates by UUID

    return {
        "certificate_user": CertificateUserRead(**certificate_user.model_dump()),
        "certification": CertificationRead(**certification.model_dump()),
        "course": {
            "id": course.id,
            "course_uuid": course.course_uuid,
            "name": course.name,
            "description": course.description,
            "thumbnail_image": course.thumbnail_image,
        }
    }


async def get_all_user_certificates(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
) -> List[dict]:
    """Get all certificates for the current user with complete linked information"""
    
    # Get all certificate users for this user
    statement = select(CertificateUser).where(CertificateUser.user_id == current_user.id)
    certificate_users = (await db_session.execute(statement)).scalars().all()

    if not certificate_users:
        return []

    # Batch fetch all certifications
    cert_ids = list({cu.certification_id for cu in certificate_users})
    statement = select(Certifications).where(Certifications.id.in_(cert_ids))  # type: ignore
    certifications = (await db_session.execute(statement)).scalars().all()
    cert_map = {cert.id: cert for cert in certifications}

    # Batch fetch all courses
    course_ids = list({cert.course_id for cert in certifications if cert.course_id})
    if course_ids:
        statement = select(Course).where(Course.id.in_(course_ids))  # type: ignore
        courses = (await db_session.execute(statement)).scalars().all()
        course_map = {course.id: course for course in courses}
    else:
        course_map = {}

    # Batch fetch user information (all cert_users belong to current_user, but keep generic)
    from src.db.users import User
    user_ids = list({cu.user_id for cu in certificate_users})
    statement = select(User).where(User.id.in_(user_ids))  # type: ignore
    users = (await db_session.execute(statement)).scalars().all()
    user_map = {user.id: user for user in users}

    result = []
    for cert_user in certificate_users:
        certification = cert_map.get(cert_user.certification_id)
        if not certification:
            continue

        course = course_map.get(certification.course_id)
        if not course:
            continue

        user = user_map.get(cert_user.user_id)

        result.append({
            "certificate_user": CertificateUserRead(**cert_user.model_dump()),
            "certification": CertificationRead(**certification.model_dump()),
            "course": {
                "id": course.id,
                "course_uuid": course.course_uuid,
                "name": course.name,
                "description": course.description,
                "thumbnail_image": course.thumbnail_image,
            },
            "user": {
                "id": user.id if user else None,
                "user_uuid": user.user_uuid if user else None,
                "username": user.username if user else None,
                "email": user.email if user else None,
                "first_name": user.first_name if user else None,
                "last_name": user.last_name if user else None,
            } if user else None
        })

    return result