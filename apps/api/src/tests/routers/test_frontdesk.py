"""Front desk (reception): what the role may do, and the limits it can never cross."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.assignments import Assignment, GradingTypeEnum
from src.db.courses.exams import ExamSettings
from src.db.live_sessions import LiveSession
from src.db.roles import Role, RoleTypeEnum, Rights
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import PublicUser, User
from src.routers.frontdesk import router as frontdesk_router
from src.security.auth import get_current_user
from src.services.orgs.users import update_user_role
from src.services.setup.setup import install_default_elements
from src.tests.conftest import USER_RIGHTS


def _public(u: User) -> PublicUser:
    return PublicUser(id=u.id, username=u.username, first_name=u.first_name, last_name=u.last_name, email=u.email, user_uuid=u.user_uuid)


async def _make_user(db, org, role, uid, username, first, last, **extra):
    u = User(id=uid, username=username, first_name=first, last_name=last, email=f"{username}@test.com", password="x",
             user_uuid=f"user_{username}", creation_date=str(datetime.now()), update_date=str(datetime.now()), **extra)
    db.add(u)
    await db.commit()
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=role.id, creation_date="now", update_date="now"))
    await db.commit()
    return u


@pytest.fixture
async def roles(db, org, admin_role, user_role):
    """The roles as production names them: the learner role is role_global_user."""
    user_role.role_uuid = "role_global_user"
    db.add(user_role)
    reception_rights = USER_RIGHTS.model_copy(deep=True)
    reception_rights.frontdesk = reception_rights.frontdesk.model_copy(update=dict(action_create=True, action_read=True, action_update=True))
    reception = Role(id=5, name="Reception", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL, role_uuid="role_global_reception",
                     rights=reception_rights.model_dump(), creation_date="now", update_date="now")
    instructor = Role(id=3, name="Instructor", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL, role_uuid="role_global_instructor",
                      rights=USER_RIGHTS.model_dump(), creation_date="now", update_date="now")
    db.add_all([reception, instructor])
    await db.commit()
    return {"admin": admin_role, "student": user_role, "reception": reception, "instructor": instructor}


@pytest.fixture
async def people(db, org, roles):
    ids = {}
    ids["admin"] = await _make_user(db, org, roles["admin"], 1, "admin", "Admin", "Boss")
    ids["reception"] = await _make_user(db, org, roles["reception"], 10, "reception", "Rita", "Desk")
    ids["instructor"] = await _make_user(db, org, roles["instructor"], 11, "teacher", "Tom", "Teacher")
    ids["amina"] = await _make_user(db, org, roles["student"], 20, "amina", "Amina", "Otieno", extra_metadata={"phone": "+254700000001", "admission_no": "A-17"})
    ids["brian"] = await _make_user(db, org, roles["student"], 21, "brian", "Brian", "Kamau")
    return ids


@pytest.fixture
def state(people):
    return {"user": _public(people["reception"])}


@pytest.fixture
def app(db, state):
    application = FastAPI()
    application.include_router(frontdesk_router, prefix="/api/v1/frontdesk")
    application.dependency_overrides[get_db_session] = lambda: db
    application.dependency_overrides[get_current_user] = lambda: state["user"]
    yield application
    application.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _as(state, people, who):
    state["user"] = _public(people[who])


class TestRoleDefinition:
    async def test_reception_gets_no_admin_rights_at_all(self, db):
        await install_default_elements(db)
        role = (await db.execute(select(Role).where(Role.role_uuid == "role_global_reception"))).scalars().one()
        rights = role.rights
        assert rights["frontdesk"] == {"action_create": True, "action_read": True, "action_update": True, "action_delete": False}
        for bucket in ("users", "roles", "organizations"):
            assert not any(rights[bucket].values()), bucket
        for bucket in ("assignments", "coursechapters", "activities", "usergroups"):
            assert not any(rights[bucket][a] for a in ("action_create", "action_update", "action_delete")), bucket
        assert rights["dashboard"] == {"action_access": False}, "no admin dashboard; the front desk has its own screen"
        assert rights["courses"]["action_create"] is False and rights["courses"]["action_update"] is False

    async def test_installing_twice_changes_nothing_and_never_overwrites_a_custom_role(self, db):
        db.add(Role(id=5, name="Evening tutors", org_id=None, role_type=RoleTypeEnum.TYPE_GLOBAL, role_uuid="role_custom_tutors",
                    rights=Rights.model_validate(USER_RIGHTS.model_dump()).model_dump(), creation_date="now", update_date="now"))
        await db.commit()
        await install_default_elements(db)
        await install_default_elements(db)
        custom = await db.get(Role, 5)
        assert custom.name == "Evening tutors" and custom.role_uuid == "role_custom_tutors", "a school's own role with id 5 is left alone"
        receptions = (await db.execute(select(Role).where(Role.role_uuid == "role_global_reception"))).scalars().all()
        assert len(receptions) == 1 and receptions[0].id != 5

    async def test_other_roles_have_no_front_desk_rights(self, db):
        await install_default_elements(db)
        for role in (await db.execute(select(Role).where(Role.role_uuid != "role_global_reception"))).scalars().all():
            assert not any(role.rights["frontdesk"].values()), role.name


class TestWhoMayUseIt:
    async def test_reception_and_admin_may(self, client, state, people):
        assert (await client.get("/api/v1/frontdesk/orgs/1/students")).status_code == 200
        _as(state, people, "admin")
        assert (await client.get("/api/v1/frontdesk/orgs/1/students")).status_code == 200

    async def test_students_and_instructors_may_not(self, client, state, people):
        for who in ("amina", "instructor"):
            _as(state, people, who)
            for path in ("students", "groups", "today", "students/user_brian"):
                assert (await client.get(f"/api/v1/frontdesk/orgs/1/{path}")).status_code == 403, (who, path)
            assert (await client.post("/api/v1/frontdesk/orgs/1/invitations", json={"emails": ["x@y.co"]})).status_code == 403

    async def test_reception_of_one_school_has_no_access_to_another(self, db, client, other_org):
        res = await client.get(f"/api/v1/frontdesk/orgs/{other_org.id}/students")
        assert res.status_code == 403

    async def test_anonymous_is_refused(self, app, db):
        from src.db.users import AnonymousUser

        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            assert (await c.get("/api/v1/frontdesk/orgs/1/students")).status_code == 401


class TestStudents:
    async def test_only_students_are_listed(self, client):
        body = (await client.get("/api/v1/frontdesk/orgs/1/students")).json()
        assert [i["username"] for i in body["items"]] == ["amina", "brian"], "no admin, instructor, or other reception account"
        assert body["total"] == 2

    async def test_search_by_name_and_email_and_wildcards_are_literal(self, client):
        assert [i["username"] for i in (await client.get("/api/v1/frontdesk/orgs/1/students?search=oti")).json()["items"]] == ["amina"]
        assert [i["username"] for i in (await client.get("/api/v1/frontdesk/orgs/1/students?search=BRIAN@test")).json()["items"]] == ["brian"]
        assert (await client.get("/api/v1/frontdesk/orgs/1/students?search=%25")).json()["total"] == 0, "a % in the box is not a wildcard"
        assert (await client.get("/api/v1/frontdesk/orgs/1/students?search=tea")).json()["total"] == 0, "the teacher is not a student"

    async def test_card_shows_details_groups_courses_progress_and_payment_status(self, db, client, org, course, chapter, activity, people):
        group = UserGroup(org_id=org.id, name="Cohort A", description="", usergroup_uuid="usergroup_a")
        db.add(group)
        trail = Trail(org_id=org.id, user_id=20, trail_uuid="trail_amina", creation_date="now", update_date="now")
        db.add(trail)
        await db.commit()
        db.add(UserGroupUser(usergroup_id=group.id, user_id=20, org_id=org.id, creation_date="now", update_date="now"))
        db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=20, creation_date="now", update_date="now"))
        await db.commit()
        card = (await client.get("/api/v1/frontdesk/orgs/1/students/user_amina")).json()
        assert card["name"] == "Amina Otieno" and card["email"] == "amina@test.com"
        assert card["details"] == {"phone": "+254700000001", "admission_no": "A-17"}
        assert card["groups"] == [{"id": group.id, "name": "Cohort A"}]
        assert card["courses"][0]["name"] == "Test Course" and card["courses"][0]["progress_percent"] == 0
        assert card["courses"][0]["access"] == "free"
        assert "password" not in str(card).lower()

    async def test_staff_and_strangers_look_like_nobody(self, client, other_org, db):
        for who in ("user_teacher", "user_admin", "user_reception", "user_nobody"):
            assert (await client.get(f"/api/v1/frontdesk/orgs/1/students/{who}")).status_code == 404, who

    async def test_a_student_of_another_school_is_not_found(self, db, client, other_org, roles):
        await _make_user(db, other_org, roles["student"], 30, "zuri", "Zuri", "Elsewhere")
        assert (await client.get("/api/v1/frontdesk/orgs/1/students/user_zuri")).status_code == 404


class TestInviteAndGroups:
    async def test_invitations_go_out_as_the_front_desk_and_cannot_choose_a_role(self, client):
        with patch("src.services.orgs.users.invite_batch_users", new_callable=AsyncMock, return_value={"results": []}) as invite:
            res = await client.post("/api/v1/frontdesk/orgs/1/invitations", json={"emails": ["new@kid.co", " two@kid.co "]})
        assert res.status_code == 200
        args, kwargs = invite.call_args
        assert args[2] == "new@kid.co,two@kid.co" and args[3] is None, "no invite code, so the invitee gets the default learner role"
        assert kwargs == {"authorized": True}
        assert "role" not in invite.call_args.kwargs

    async def test_invitation_batch_is_limited(self, client):
        res = await client.post("/api/v1/frontdesk/orgs/1/invitations", json={"emails": [f"a{i}@x.co" for i in range(60)]})
        assert res.status_code == 422
        assert (await client.post("/api/v1/frontdesk/orgs/1/invitations", json={"emails": []})).status_code == 422

    async def test_add_and_remove_a_student_from_a_group(self, db, client, org):
        group = UserGroup(org_id=org.id, name="Cohort A", description="", usergroup_uuid="usergroup_a")
        db.add(group)
        await db.commit()
        listing = (await client.get("/api/v1/frontdesk/orgs/1/groups")).json()
        assert listing == [{"id": group.id, "name": "Cohort A", "members": 0}]
        base = f"/api/v1/frontdesk/orgs/1/groups/{group.id}/students/user_amina"
        assert (await client.post(base)).json() == {"added": True}
        members = (await db.execute(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group.id))).scalars().all()
        assert members == [20]
        assert (await client.get(f"/api/v1/frontdesk/orgs/1/students?group_id={group.id}")).json()["total"] == 1
        assert (await client.delete(base)).json() == {"removed": True}
        assert (await db.execute(select(UserGroupUser))).scalars().all() == []

    async def test_staff_cannot_be_grouped_and_groups_of_other_schools_are_off_limits(self, db, client, org, other_org):
        mine = UserGroup(org_id=org.id, name="Mine", description="", usergroup_uuid="usergroup_mine")
        theirs = UserGroup(org_id=other_org.id, name="Theirs", description="", usergroup_uuid="usergroup_theirs")
        db.add_all([mine, theirs])
        await db.commit()
        assert (await client.post(f"/api/v1/frontdesk/orgs/1/groups/{mine.id}/students/user_teacher")).status_code == 404
        assert (await client.post(f"/api/v1/frontdesk/orgs/1/groups/{mine.id}/students/user_reception")).status_code == 404
        assert (await client.post(f"/api/v1/frontdesk/orgs/1/groups/{theirs.id}/students/user_amina")).status_code == 404
        assert (await db.execute(select(UserGroupUser))).scalars().all() == []


class TestCannotEscalate:
    async def test_reception_cannot_change_anyones_role_through_the_admin_path(self, db, org, people, roles):
        reception = _public(people["reception"])
        with pytest.raises(HTTPException) as exc:
            await update_user_role(None, org.id, 20, "role_admin", db, reception)
        assert exc.value.status_code == 403
        row = (await db.execute(select(UserOrganization).where(UserOrganization.user_id == 20))).scalars().one()
        assert row.role_id == roles["student"].id

    async def test_reception_cannot_promote_itself(self, db, org, people, roles):
        reception = _public(people["reception"])
        with pytest.raises(HTTPException) as exc:
            await update_user_role(None, org.id, 10, "role_admin", db, reception)
        assert exc.value.status_code == 403

    async def test_front_desk_endpoints_have_no_role_parameter(self, app):
        for route in app.routes:
            assert "role" not in getattr(route, "path", ""), route.path


class TestClassAndExamDays:
    async def _exam(self, db, org, course, chapter, activity, **settings):
        a = Assignment(id=1, title="CAT 1", description="d", published=True, grading_type=GradingTypeEnum.NUMERIC, org_id=org.id,
                       course_id=course.id, chapter_id=chapter.id, activity_id=activity.id, assignment_uuid="assignment_cat1",
                       creation_date="now", update_date="now")
        db.add(a)
        await db.commit()
        db.add(ExamSettings(assignment_id=a.id, org_id=org.id, course_id=course.id, enabled=True, duration_minutes=45,
                            opens_at=datetime.now(timezone.utc) - timedelta(minutes=5), closes_at=datetime.now(timezone.utc) + timedelta(hours=2), **settings))
        await db.commit()
        return a

    async def test_today_lists_classes_and_exams(self, db, client, org, course, chapter, activity, people):
        db.add(LiveSession(session_uuid="livesession_1", org_id=org.id, course_id=course.id, instructor_id=11, title="Maths live",
                           scheduled_at=datetime.now(timezone.utc) + timedelta(hours=3), livekit_room_name="room1"))
        await db.commit()
        await self._exam(db, org, course, chapter, activity)
        body = (await client.get("/api/v1/frontdesk/orgs/1/today")).json()
        assert [c["title"] for c in body["classes"]] == ["Maths live"] and body["classes"][0]["course"] == "Test Course"
        assert [e["title"] for e in body["exams"]] == ["CAT 1"] and body["exams"][0]["duration_minutes"] == 45

    async def test_exam_roster_is_read_only_and_hides_the_flags(self, db, client, org, course, chapter, activity, people):
        await self._exam(db, org, course, chapter, activity)
        trail = Trail(org_id=org.id, user_id=20, trail_uuid="trail_a", creation_date="now", update_date="now")
        db.add(trail)
        await db.commit()
        db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=20, creation_date="now", update_date="now"))
        await db.commit()
        roster = (await client.get("/api/v1/frontdesk/orgs/1/exams/assignment_cat1/roster")).json()
        assert roster["counts"]["not_started"] == 1 and roster["students"][0]["name"] == "Amina Otieno"
        assert roster["students"][0]["violation_count"] == 0 and roster["counts"]["flagged"] == 0

    async def test_an_exam_of_another_school_is_not_found(self, db, client, org, other_org, course, chapter, activity):
        await self._exam(db, org, course, chapter, activity)
        # Reception works at school 1 only, so school 2's address is refused outright.
        assert (await client.get(f"/api/v1/frontdesk/orgs/{other_org.id}/exams/assignment_cat1/roster")).status_code == 403
        assert (await client.get("/api/v1/frontdesk/orgs/1/exams/assignment_missing/roster")).status_code == 404

    async def test_resend_a_class_link_to_one_student(self, db, client, org, course, people):
        db.add(LiveSession(session_uuid="livesession_1", org_id=org.id, course_id=course.id, instructor_id=11, title="Maths live",
                           scheduled_at=datetime.now(timezone.utc) + timedelta(hours=3), livekit_room_name="room1"))
        await db.commit()
        import asyncio
        from src.services.live import invitations

        with patch("src.services.email.utils.send_email") as send, patch(
            "src.services.email.utils.get_org_signup_base_url", new_callable=AsyncMock, return_value="https://school.example.test/"
        ):
            res = await client.post("/api/v1/frontdesk/orgs/1/live/livesession_1/resend", json={"user_uuid": "user_amina"})
            assert res.status_code == 200 and res.json() == {"queued": 1}
            if invitations._background:
                await asyncio.gather(*list(invitations._background))
        assert [c.args[0] for c in send.call_args_list] == ["amina@test.com"]
        assert "https://school.example.test/course/test/live/1" in send.call_args_list[0].args[2]

    async def test_resend_is_for_students_of_this_school_only(self, db, client, org, course, people):
        db.add(LiveSession(session_uuid="livesession_1", org_id=org.id, course_id=course.id, instructor_id=11, title="Maths live",
                           scheduled_at=datetime.now(timezone.utc) + timedelta(hours=3), livekit_room_name="room1"))
        await db.commit()
        for target in ("user_teacher", "user_admin", "user_nobody"):
            res = await client.post("/api/v1/frontdesk/orgs/1/live/livesession_1/resend", json={"user_uuid": target})
            assert res.status_code == 404, target
        assert (await client.post("/api/v1/frontdesk/orgs/1/live/livesession_missing/resend", json={"user_uuid": "user_amina"})).status_code == 404
