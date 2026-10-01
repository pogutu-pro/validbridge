"""Router tests for the org-wide audit log viewer (src/routers/audit_logs.py)."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.audit_logs import AuditLog
from src.routers.audit_logs import router as audit_logs_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(audit_logs_router, prefix="/api/v1/ee/audit_logs")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app, admin_user):
    app.dependency_overrides[get_current_user] = lambda: admin_user
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _seed_row(db, *, org_id, user_id=1, username="admin", method="POST",
              path="/api/v1/courses", action="course.create", resource="course",
              resource_id="course_test", ip_address="127.0.0.1", status_code=201,
              payload=None, created_at=None):
    row = AuditLog(
        id=None,
        org_id=org_id,
        user_id=user_id,
        username=username,
        method=method,
        path=path,
        action=action,
        resource=resource,
        resource_id=resource_id,
        ip_address=ip_address,
        user_agent="pytest",
        status_code=status_code,
        payload=payload or {"name": "Course", "published": True},
        created_at=created_at or datetime.now(UTC),
    )
    return row


async def _seed_rows(db, org_id):
    rows = [
        _seed_row(
            db, org_id=org_id, action="course.create", resource="course",
            status_code=201, created_at=datetime(2024, 1, 1, tzinfo=UTC),
        ),
        _seed_row(
            db, org_id=org_id, action="user.delete", resource="user",
            username="regular", user_id=2, ip_address="192.168.1.5",
            status_code=200, created_at=datetime(2024, 1, 2, tzinfo=UTC),
        ),
        _seed_row(
            db, org_id=org_id, action="org.update", resource="org",
            status_code=400, created_at=datetime(2024, 1, 3, tzinfo=UTC),
        ),
    ]
    for row in rows:
        db.add(row)
    await db.commit()
    return rows


class TestListAuditLogs:
    async def test_requires_admin(self, app, db, regular_user):
        app.dependency_overrides[get_current_user] = lambda: regular_user
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/ee/audit_logs/?org_id=1")
        assert response.status_code == 403

    async def test_anonymous_rejected(self, app, db, anonymous_user):
        app.dependency_overrides[get_current_user] = lambda: anonymous_user
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/ee/audit_logs/?org_id=1")
        assert response.status_code == 401

    async def test_list_returns_paginated_rows(self, client, db, admin_user):
        await _seed_rows(db, org_id=1)
        response = await client.get("/api/v1/ee/audit_logs/?org_id=1")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 3
        assert len(body["items"]) == 3
        # Newest first.
        assert body["items"][0]["action"] == "org.update"
        assert body["items"][0]["user_id"] == 1
        assert body["items"][0]["username"] == "admin"
        assert body["items"][0]["resource"] == "org"
        assert body["items"][0]["resource_id"] == "course_test"
        assert body["items"][0]["path"] == "/api/v1/courses"
        assert body["items"][0]["method"] == "POST"
        assert body["items"][0]["status_code"] == 400
        assert body["items"][0]["payload"]["name"] == "Course"

    async def test_cross_org_isolation_rejected(self, client, db, other_org):
        await _seed_rows(db, org_id=1)
        response = await client.get("/api/v1/ee/audit_logs/?org_id=2")
        assert response.status_code == 403

    async def test_filters(self, client, db, admin_user):
        await _seed_rows(db, org_id=1)
        response = await client.get(
            "/api/v1/ee/audit_logs/?org_id=1&action=user.delete"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 1
        assert body["items"][0]["username"] == "regular"

        response = await client.get("/api/v1/ee/audit_logs/?org_id=1&username=reg")
        assert response.json()["total"] == 1

        response = await client.get("/api/v1/ee/audit_logs/?org_id=1&status_code=201")
        assert response.json()["total"] == 1

        response = await client.get(
            "/api/v1/ee/audit_logs/?org_id=1&start_date=2024-01-02&end_date=2024-01-02"
        )
        assert response.json()["total"] == 1

        response = await client.get("/api/v1/ee/audit_logs/?org_id=1&user_id=2")
        assert response.json()["total"] == 1

    async def test_org_id_required(self, client):
        response = await client.get("/api/v1/ee/audit_logs/")
        assert response.status_code == 422

    async def test_limit_and_offset(self, client, db, admin_user):
        await _seed_rows(db, org_id=1)
        response = await client.get("/api/v1/ee/audit_logs/?org_id=1&limit=2")
        assert response.status_code == 200
        assert len(response.json()["items"]) == 2
        response = await client.get(
            "/api/v1/ee/audit_logs/?org_id=1&limit=2&offset=2"
        )
        assert len(response.json()["items"]) == 1

    async def test_demo_org_scoped_to_actor(self, client, db, admin_user):
        await _seed_rows(db, org_id=1)
        with patch("src.routers.audit_logs.is_demo_org", new_callable=AsyncMock,
                   return_value=True):
            response = await client.get("/api/v1/ee/audit_logs/?org_id=1")
        body = response.json()
        # Only the acting user's row (admin, id=1) is visible in demo org.
        assert body["total"] == 2
        assert all(item["user_id"] == 1 for item in body["items"])


class TestExportAuditLogs:
    async def test_export_csv(self, client, db, admin_user):
        await _seed_rows(db, org_id=1)
        response = await client.get("/api/v1/ee/audit_logs/export?org_id=1")
        assert response.status_code == 200
        text = response.text
        assert "text/csv" in response.headers["content-type"]
        assert "Content-Disposition" in response.headers
        header_line = text.splitlines()[0]
        assert "id" in header_line
        assert "username" in header_line
        assert "status_code" in header_line
        # One header + one row per seeded row.
        assert len(text.splitlines()) == 4

    async def test_export_csv_formula_safe(self, client, db, admin_user):
        row = _seed_row(
            db, org_id=1, username="=HYPERLINK(evil)", method="PATCH",
            path="/api/v1/users/2", action="user.update", resource="user",
            status_code=200,
        )
        db.add(row)
        await db.commit()
        response = await client.get("/api/v1/ee/audit_logs/export?org_id=1")
        assert "'=HYPERLINK(evil)" in response.text