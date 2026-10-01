"""Tests for the request audit middleware (src/core/middleware/audit_log.py)."""

from unittest.mock import patch

import pytest

import src.core.middleware.audit_log as audit_module
from src.core.middleware.audit_log import (
    AuditLogMiddleware,
    _client_ip,
    _extract_org_id,
    _parse_payload,
    _redact,
    _resource_from_path,
    _should_audit,
)


class TestWriterLoop:
    async def test_batches_and_stops_on_sentinel(self):
        written = []
        audit_module._queue = audit_module.asyncio.Queue()
        for rec in ({"n": i} for i in range(audit_module._BATCH_SIZE + 3)):
            audit_module._queue.put_nowait(rec)
        audit_module._queue.put_nowait(None)

        async def fake_write_batch(batch):
            written.append(batch)

        with patch.object(
            audit_module, "_write_batch", side_effect=fake_write_batch
        ):
            await audit_module._writer_loop()

        # One full batch + one partial batch, then the sentinel stops the loop.
        assert [len(b) for b in written] == [
            audit_module._BATCH_SIZE,
            3,
        ]


class TestShouldAudit:
    def test_mutating_methods_only(self):
        assert _should_audit("POST", "/api/v1/courses")
        assert _should_audit("PUT", "/api/v1/courses/uuid")
        assert _should_audit("PATCH", "/api/v1/users/2")
        assert _should_audit("DELETE", "/api/v1/chapters/uuid")
        assert not _should_audit("GET", "/api/v1/courses")
        assert not _should_audit("OPTIONS", "/api/v1/courses")

    def test_denylist_paths(self):
        assert not _should_audit("POST", "/health")
        assert not _should_audit("POST", "/api/v1/health")
        assert not _should_audit("POST", "/api/v1/instance/info")
        assert not _should_audit("POST", "/api/v1/demo/status")
        assert not _should_audit("POST", "/docs")
        assert not _should_audit("POST", "/openapi.json")
        assert not _should_audit("POST", "/api/v1/monitoring/ingest")
        assert not _should_audit("POST", "/api/v1/dev/scratch")
        assert not _should_audit("POST", "/content/uploads/foo.jpg")

    def test_auth_endpoints_audited_when_anonymous(self):
        assert _should_audit("POST", "/api/v1/auth/login")
        assert _should_audit("POST", "/api/v1/auth/logout")


class TestRedact:
    def test_redacts_secret_values(self):
        payload = {
            "name": "Course",
            "password": "hunter2",
            "nested": {"api_key": "abc", "access_token": "xyz"},
            "metadata": {"tags": ["a", "b"]},
        }
        out = _redact(payload)
        assert out["name"] == "Course"
        assert out["password"] == "[REDACTED]"
        assert out["nested"]["api_key"] == "[REDACTED]"
        assert out["nested"]["access_token"] == "[REDACTED]"
        assert out["metadata"]["tags"] == ["a", "b"]

    def test_leaves_benign_keys_alone(self):
        payload = {"title": "token economics", "key": "door"}
        assert _redact(payload) == payload

    def test_lists_redacted_recursively(self):
        out = _redact({"users": [{"password": "x"}, {"name": "Ada"}]})
        assert out["users"][0]["password"] == "[REDACTED]"
        assert out["users"][1]["name"] == "Ada"


class TestResourceFromPath:
    def test_course_path(self):
        resource, resource_id, action = _resource_from_path(
            "POST", "/api/v1/courses"
        )
        assert resource == "course"
        assert resource_id is None
        assert action == "course.create"

    def test_course_uuid_path(self):
        uuid = "123e4567-e89b-12d3-a456-426614174000"
        resource, resource_id, action = _resource_from_path(
            "DELETE", f"/api/v1/courses/{uuid}"
        )
        assert resource == "course"
        assert resource_id == uuid
        assert action == "course.delete"

    def test_user_patch(self):
        resource, resource_id, action = _resource_from_path(
            "PATCH", "/api/v1/users/42"
        )
        assert resource == "user"
        assert resource_id == "42"
        assert action == "user.update"

    def test_org_fallback(self):
        resource, resource_id, action = _resource_from_path(
            "POST", "/api/v1/some/other/9/surface"
        )
        assert resource == "org"
        assert resource_id == "9"
        assert action == "org.create"


class TestExtractOrgId:
    def test_query_org_id(self):
        assert _extract_org_id("GET", "/api/v1/users", b"org_id=7") == 7

    def test_path_org_id(self):
        assert _extract_org_id("GET", "/api/v1/orgs/3/users", b"") == 3

    def test_missing(self):
        assert _extract_org_id("GET", "/api/v1/courses", b"") is None

    def test_non_numeric_query_ignored(self):
        assert _extract_org_id("GET", "/api/v1/users", b"org_id=abc") is None


class TestParsePayload:
    def test_valid_json_object_redacted(self):
        out = _parse_payload(b'{"password": "x", "ok": true}')
        assert out == {"password": "[REDACTED]", "ok": True}

    def test_truncated_body_returns_none(self):
        assert _parse_payload(b'{"password": "x"') is None

    def test_non_object_json_returns_none(self):
        assert _parse_payload(b"[1,2,3]") is None

    def test_empty_body_returns_none(self):
        assert _parse_payload(None) is None


class TestClientIp:
    def _scope(self, client, forwarded=None):
        headers = []
        if forwarded:
            headers.append((b"x-forwarded-for", forwarded.encode()))
        return {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": headers,
            "client": client,
        }

    def test_direct_remote_used_when_not_trusted_proxy(self):
        assert _client_ip(self._scope(("203.0.113.5", 1234))) == "203.0.113.5"

    def test_forwarded_used_from_loopback(self):
        assert _client_ip(self._scope(("127.0.0.1", 1234), "1.2.3.4")) == "1.2.3.4"

    def test_forwarded_first_entry_used(self):
        scope = self._scope(("127.0.0.1", 1234), "1.2.3.4, 5.6.7.8")
        assert _client_ip(scope) == "1.2.3.4"

    def test_no_client_returns_none(self):
        assert _client_ip(self._scope(None)) is None


class TestMiddlewareCapture:
    @pytest.fixture
    async def captured(self):
        """Returns a dict patched _enqueue_record will append to."""
        box = {}

        async def fake_app(scope, receive, send):
            # Consume request body.
            while True:
                message = await receive()
                if message["type"] == "http.request" and not message.get("more_body"):
                    break
            await send({"type": "http.response.start", "status": 201, "headers": []})
            await send({"type": "http.response.body", "body": b'{"id":1}'})

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/courses",
            "query_string": b"",
            "headers": [
                (b"content-type", b"application/json"),
                (b"user-agent", b"pytest"),
                (b"authorization", b"Bearer abcdef"),
            ],
            "client": ("203.0.113.9", 1234),
            "state": {},
        }

        received = []

        async def receive():
            body = b'{"name": "Course", "password": "hunter2"}'
            received.append(body)
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            return None

        def enqueue(record):
            box["record"] = record

        middleware = AuditLogMiddleware(fake_app)
        with patch("src.core.middleware.audit_log._enqueue_record", enqueue):
            await middleware(scope, receive, send)
        return box

    async def test_captures_redacted_record(self, captured):
        record = captured["record"]
        assert record["method"] == "POST"
        assert record["path"] == "/api/v1/courses"
        assert record["action"] == "course.create"
        assert record["resource"] == "course"
        assert record["status_code"] == 201
        assert record["ip_address"] == "203.0.113.9"
        assert record["user_agent"] == "pytest"
        assert record["payload"] == {"name": "Course", "password": "[REDACTED]"}

    async def test_non_mutating_requests_not_enqueued(self):
        enqueued = []

        async def fake_app(scope, receive, send):
            return None

        middleware = AuditLogMiddleware(fake_app)
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/courses",
            "headers": [],
        }
        with patch(
            "src.core.middleware.audit_log._enqueue_record", side_effect=enqueued.append
        ):
            await middleware(scope, lambda: None, lambda message: None)
        assert enqueued == []