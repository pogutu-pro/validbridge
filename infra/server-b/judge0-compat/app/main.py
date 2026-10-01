"""Judge0-compatible HTTP front for Piston (ValidBridge Server B).

Implements the part of the Judge0 CE API the ValidBridge API uses
(POST /submissions?wait=true) plus the small read-only surface around it.
Nothing is persisted: results for wait=false/batch submissions are kept in
a bounded in-memory cache so GET /submissions/{token} works for a while.

Environment:
  JUDGE0_COMPAT_TOKEN   required; compared with X-Judge0-Client-Secret
  PISTON_URL            default http://piston:2000
  MAX_INFLIGHT          concurrent Piston calls (default 2, ~= Piston jobs)
  MAX_QUEUE             waiting requests before refusing (default 64)
  REQUEST_DEADLINE_S    total budget per submission (default 27, API waits 30)
  RUN_CPU_MS / RUN_WALL_MS / RUN_MEMORY_BYTES   ceilings for caller limits
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import sys
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import core
from .languages import LANGUAGES, get_language

# ---------------------------------------------------------------- config

TOKEN = os.environ.get("JUDGE0_COMPAT_TOKEN", "")
PISTON_URL = os.environ.get("PISTON_URL", "http://piston:2000").rstrip("/")
MAX_INFLIGHT = int(os.environ.get("MAX_INFLIGHT", "2"))
MAX_QUEUE = int(os.environ.get("MAX_QUEUE", "64"))
DEADLINE_S = float(os.environ.get("REQUEST_DEADLINE_S", "27"))
MAX_BATCH = int(os.environ.get("MAX_BATCH", "20"))
CACHE_SIZE = int(os.environ.get("RESULT_CACHE_SIZE", "500"))
LIMITS = core.Limits(
    run_cpu_ms=int(os.environ.get("RUN_CPU_MS", "3000")),
    run_wall_ms=int(os.environ.get("RUN_WALL_MS", "5000")),
    run_memory_bytes=int(os.environ.get("RUN_MEMORY_BYTES", str(256 * 1024 * 1024))),
)
VERSION = "1.0.0"


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {"ts": round(record.created, 3), "level": record.levelname, "msg": record.getMessage()}
        data.update(getattr(record, "fields", {}))
        return json.dumps(data, separators=(",", ":"))


log = logging.getLogger("judge0-compat")
if not log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(_JsonFormatter())
    log.addHandler(_h)
    log.setLevel(logging.INFO)
    log.propagate = False


def _log(msg: str, level: int = logging.INFO, **fields) -> None:
    # Never pass source code, stdin, expected output or program output here.
    log.log(level, msg, extra={"fields": fields})


# ---------------------------------------------------------------- state

app = FastAPI(title="judge0-compat", docs_url=None, redoc_url=None, openapi_url=None)
_slots = asyncio.Semaphore(MAX_INFLIGHT)
_waiting = 0
_results: "OrderedDict[str, dict]" = OrderedDict()
_client: httpx.AsyncClient | None = None


def _client_get() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(DEADLINE_S, connect=3.0))
    return _client


def set_client(client: httpx.AsyncClient) -> None:
    """Tests inject a client with a mock transport."""
    global _client
    _client = client


def _remember(resp: dict) -> None:
    _results[resp["token"]] = resp
    while len(_results) > CACHE_SIZE:
        _results.popitem(last=False)


@asynccontextmanager
async def _lifespan(_app):
    global _client
    if len(TOKEN) < 16:
        # Fail closed: never serve without authentication
        _log("JUDGE0_COMPAT_TOKEN missing or shorter than 16 chars; refusing to start", logging.CRITICAL)
        raise RuntimeError("JUDGE0_COMPAT_TOKEN is not set")
    _log("started", piston=PISTON_URL, max_inflight=MAX_INFLIGHT, max_queue=MAX_QUEUE, deadline_s=DEADLINE_S)
    yield
    if _client is not None:
        await _client.aclose()
        _client = None


app.router.lifespan_context = _lifespan


# ---------------------------------------------------------------- auth


@app.middleware("http")
async def _auth(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    given = request.headers.get("x-judge0-client-secret") or request.headers.get("x-auth-token") or ""
    if not TOKEN or not hmac.compare_digest(given.encode(), TOKEN.encode()):
        _log("unauthorized", logging.WARNING, path=request.url.path,
             client=request.client.host if request.client else None)
        return JSONResponse({"error": "authentication failed"}, status_code=401)
    return await call_next(request)


# ---------------------------------------------------------------- execution


def _truthy(v: str | None) -> bool:
    return str(v).lower() in ("true", "1", "yes")


async def _execute(body: dict, base64_encoded: bool, client_ip: str | None) -> tuple[int, dict]:
    """Returns (http_status, judge0_submission_or_error)."""
    global _waiting
    token = str(uuid.uuid4())
    started = time.monotonic()

    lang_id = body.get("language_id")
    try:
        lang_id = int(lang_id)
    except (TypeError, ValueError):
        return 422, {"language_id": ["can't be blank" if lang_id is None else "is not a number"]}
    language = get_language(lang_id)
    if language is None:
        return 422, {"language_id": [f"language with id {lang_id} doesn't exist"]}

    fields = {"token": token, "language_id": lang_id, "client": client_ip}
    if language.unavailable:
        resp = core.internal_error(f"{language.name}: {language.unavailable}", token)
        _log("done", **fields, status_id=13, reason="language_unavailable")
        return 201, resp

    try:
        prepared = core.prepare(body, language, LIMITS, base64_encoded)
    except core.InputError as e:
        return 422, {e.field: [e.message]}
    fields.update(source_len=len(body.get("source_code") or ""), stdin_len=len(body.get("stdin") or ""),
                  files=prepared.file_count)

    if _waiting >= MAX_QUEUE:
        _log("queue full", logging.WARNING, **fields, waiting=_waiting)
        return 201, core.internal_error("code runner is busy, try again", token)

    _waiting += 1
    try:
        try:
            await asyncio.wait_for(_slots.acquire(), timeout=max(0.1, DEADLINE_S - 5))
        except asyncio.TimeoutError:
            _log("queue timeout", logging.WARNING, **fields)
            return 201, core.internal_error("code runner is busy (queue timeout), try again", token)
    finally:
        _waiting -= 1

    queued_ms = int((time.monotonic() - started) * 1000)
    try:
        remaining = max(1.0, DEADLINE_S - (time.monotonic() - started))
        try:
            r = await _client_get().post(
                f"{PISTON_URL}/api/v2/execute", json=prepared.piston_request, timeout=remaining
            )
        except httpx.TimeoutException:
            _log("piston timeout", logging.ERROR, **fields, queued_ms=queued_ms)
            return 201, core.internal_error("code runner timed out", token)
        except httpx.HTTPError as e:
            _log("piston unreachable", logging.ERROR, **fields, error=type(e).__name__)
            return 201, core.internal_error("code runner unavailable", token)
    finally:
        _slots.release()

    if r.status_code != 200:
        try:
            pmsg = r.json().get("message", "")
        except ValueError:
            pmsg = ""
        _log("piston error", logging.ERROR, **fields, piston_status=r.status_code, piston_message=pmsg[:200])
        if "unknown" in pmsg.lower():
            msg = f"{language.name} is not installed on the code runner"
        else:
            msg = "code runner rejected the submission"
        return 201, core.internal_error(msg, token)

    try:
        resp = core.build_response(r.json(), prepared, language, token, LIMITS)
    except Exception as e:  # noqa: BLE001 - any mapping bug must not look like a verdict
        _log("mapping failed", logging.ERROR, **fields, error=type(e).__name__)
        return 201, core.internal_error("could not read the code runner result", token)

    _log("done", **fields, status_id=resp["status"]["id"], time=resp["time"], memory_kb=resp["memory"],
         queued_ms=queued_ms, total_ms=int((time.monotonic() - started) * 1000))
    return 201, resp


async def _json_body(request: Request) -> dict | None:
    try:
        body = await request.json()
    except (ValueError, UnicodeDecodeError):
        return None
    return body if isinstance(body, dict) else None


# ---------------------------------------------------------------- routes


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/submissions")
async def create_submission(request: Request):
    body = await _json_body(request)
    if body is None:
        return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)
    q = request.query_params
    b64 = _truthy(q.get("base64_encoded"))
    code, resp = await _execute(body, b64, request.client.host if request.client else None)
    if code != 201:
        return JSONResponse(resp, status_code=code)
    _remember(resp)
    if _truthy(q.get("wait")):
        return JSONResponse(core.select_fields(resp, q.get("fields")), status_code=201)
    return JSONResponse({"token": resp["token"]}, status_code=201)


@app.post("/submissions/batch")
async def create_batch(request: Request):
    body = await _json_body(request)
    subs = (body or {}).get("submissions")
    if not isinstance(subs, list) or not subs:
        return JSONResponse({"error": "submissions must be a non-empty array"}, status_code=400)
    if len(subs) > MAX_BATCH:
        return JSONResponse({"error": f"number of submissions in a batch must be <= {MAX_BATCH}"}, status_code=400)
    b64 = _truthy(request.query_params.get("base64_encoded"))
    ip = request.client.host if request.client else None
    outs = await asyncio.gather(*[_execute(s if isinstance(s, dict) else {}, b64, ip) for s in subs])
    result = []
    for code, resp in outs:
        if code == 201:
            _remember(resp)
            result.append({"token": resp["token"]})
        else:
            result.append(resp)
    return JSONResponse(result, status_code=201)


@app.get("/submissions/batch")
async def get_batch(request: Request):
    tokens = [t for t in (request.query_params.get("tokens") or "").split(",") if t]
    fields = request.query_params.get("fields")
    return {"submissions": [core.select_fields(_results[t], fields) if t in _results else None for t in tokens]}


@app.get("/submissions/{token}")
async def get_submission(token: str, request: Request):
    resp = _results.get(token)
    if resp is None:
        return JSONResponse({"error": "submission not found"}, status_code=404)
    return core.select_fields(resp, request.query_params.get("fields"))


@app.get("/languages")
async def languages():
    return [{"id": l.id, "name": l.name} for l in sorted(LANGUAGES.values(), key=lambda l: l.id) if not l.unavailable]


@app.get("/languages/all")
async def languages_all():
    return [{"id": l.id, "name": l.name, "is_archived": bool(l.unavailable)}
            for l in sorted(LANGUAGES.values(), key=lambda l: l.id)]


@app.get("/languages/{language_id}")
async def language(language_id: int):
    l = get_language(language_id)
    if l is None:
        return JSONResponse({"error": "language not found"}, status_code=404)
    return {"id": l.id, "name": l.name, "is_archived": bool(l.unavailable)}


@app.get("/statuses")
async def statuses():
    return [{"id": k, "description": v} for k, v in core.STATUSES.items()]


@app.get("/about")
async def about():
    return {"version": f"validbridge-judge0-compat {VERSION}", "backend": "piston",
            "homepage": None, "source_code": None, "maintainer": "ValidBridge"}


@app.get("/workers")
async def workers():
    return [{"queue": "default", "size": _waiting, "available": _slots._value, "idle": _slots._value,
             "working": MAX_INFLIGHT - _slots._value, "paused": 0, "failed": 0}]
