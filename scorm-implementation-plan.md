# ValidBridge — SCORM Backend Implementation Plan

> Status: **implemented** — the full backend lives under `apps/api/ee/`
> (`ee/db/scorm.py`, `ee/services/scorm/scorm.py`,
> `ee/services/scorm/scorm_runtime.py`, `ee/routers/scorm.py`,
> `ee/hooks.py`). All committed `test_scorm_*.py` files pass. This document is
> retained as the grounded spec the implementation was built against.
> Purpose: a complete, self-contained build plan grounded entirely in code that
> is **already committed** to this repo. Nothing here is exploratory. Every
> signature, path, cap, and response shape below is derived from an existing
> file you can open and verify — the plan cites it.

---

## 0. The single most important fact

**The SCORM tests and fixtures already exist and are the executable spec.**
They currently *skip* (`pytest.importorskip`) only because the `apps/api/ee/`
package they import from does not exist yet:

| Test file | Imports (the contract) |
|---|---|
| `src/tests/services/test_scorm_parsing.py:11-12` | `ee.services.scorm.scorm`, `ee.db.scorm.ScormVersionEnum` |
| `src/tests/services/test_scorm_content_path.py:10` | `ee.services.scorm.scorm` |
| `src/tests/services/test_scorm_upload_pipeline.py:15` | `ee.services.scorm.scorm` |
| `src/tests/services/test_scorm_import_dedup.py:14-15` | `ee.services.scorm.scorm`, `ee.db.scorm.ScormScoAssignment` |
| `src/tests/services/test_scorm_runtime_logic.py:19-24` | `ee.services.scorm.scorm_runtime`, `ee.db.scorm.{ScormRuntimeData,CompletionStatusEnum,SuccessStatusEnum}` |
| `src/tests/services/test_scorm_conformance.py:11-12` | `ee.services.scorm.scorm_runtime`, `ee.db.scorm.CompletionStatusEnum` |
| `src/tests/security/test_scorm_extract.py:14` | `ee.services.scorm.scorm` |
| `src/tests/security/test_scorm_security.py:74-76` | source text of `ee/services/scorm/scorm.py` |

The e2e client confirms the router location and endpoints:
`apps/e2e/features/scorm/api.ts:6` — *"Field names mirror the backend
(`ee/routers/scorm.py`, `ee/db/scorm.py`)."* and the e2e README
(`apps/e2e/features/scorm/README.md`) states **"SCORM is an EE-only feature, so
these specs need an EE instance (the OSS stack has no `/scorm` routes)."**

**Consequence:** implement under `apps/api/ee/` and mount the router through the
existing EE hook (`ee/hooks.py`). Do **not** put SCORM in `src/` — that
contradicts the tests, the e2e client, and the plugin mechanism.

> ⚠️ `missing.md` §C (line 412) says *"add `src/db/scorm/` models"*. That line is
> stale/incorrect. The committed tests + e2e + `ee_hooks.py` all say `ee/`.
> **M0 corrects that doc line.** The code must follow the tests.

---

## 1. What already exists — DO NOT recreate

Recreating any of these is a regression, not progress.

| Thing | Location | Status |
|---|---|---|
| `TYPE_SCORM`, `SUBTYPE_SCORM_12`, `SUBTYPE_SCORM_2004` | `src/db/courses/activities.py:8-35` | ✅ present |
| Alembic migration adding those enum values | `migrations/versions/f8a3c2d1e5b7_add_scorm_activity_types.py` | ✅ present (revision `f8a3c2d1e5b7`) |
| `Activity.content` JSON (holds `scorm_version`, `entry_point`, `sco_identifier`, `sco_title`, `mastery_score`, `scorm_package_uuid`) | `src/db/courses/activities.py:48` | ✅ present |
| EE plugin hook (`is_ee_available`, `get_ee_hooks`, `register_ee_routers`, `run_ee_startup`) | `src/core/ee_hooks.py` | ✅ present |
| `import_all_models()` already walks `ee/db` | `src/core/events/database.py:15-17` | ✅ present |
| S3/R2 storage helpers incl. `upload_directory_to_s3_parallel` (docstring literally says *"for directories with many files (e.g. extracted SCORM packages)"*) | `src/services/courses/transfer/storage_utils.py:579-611` | ✅ present |
| Hardened zip extraction pattern to copy | `src/services/courses/transfer/import_service.py:144-333` | ✅ present |
| Same-origin content serving patterns (MIME, Range, S3 presigned) | `src/routers/content_files.py`, `src/routers/local_content.py` | ✅ present |
| Trail completion helper (`TrailStep(complete=True)` + side effects) | `src/services/trail/trail.py:216` (`add_activity_to_trail`) | ✅ present |
| Synthetic package corpus (valid + adversarial) | `src/tests/fixtures/scorm_packages.py` | ✅ present |
| All 8 SCORM test files | `src/tests/services/test_scorm_*.py`, `src/tests/security/test_scorm_*.py` | ✅ present (skipping) |
| e2e REST + browser specs | `apps/e2e/features/scorm/tests/`, `.../api.ts` | ✅ present |
| Frontend player + admin modals | `apps/web/ee/services/scorm/`, `apps/web/ee/components/` | ✅ present |

---

## 2. Module layout to create

```
apps/api/ee/
├── __init__.py
├── hooks.py                      # register_routers(v1_router) -> mount scorm router
├── db/
│   ├── __init__.py
│   └── scorm.py                  # enums + models (import path ee.db.scorm)
├── services/
│   ├── __init__.py
│   └── scorm/
│       ├── __init__.py
│       ├── scorm.py              # parsing, zip/extract, upload, import, paths
│       └── scorm_runtime.py      # CMI runtime + results
└── routers/
    ├── __init__.py
    └── scorm.py                  # HTTP layer (10 endpoints)
```

`import_all_models()` (`src/core/events/database.py:15-17`) walks `ee/db` and
imports `ee.db.scorm`, so the table(s) register automatically.

---

## 3. Data model — `ee/db/scorm.py`

Derived from the test imports and assertions. Keep names exact.

### Enums

```python
class ScormVersionEnum(str, Enum):      # test_scorm_parsing.py:24,32
    SCORM_12 = "SCORM_12"
    SCORM_2004 = "SCORM_2004"

class CompletionStatusEnum(str, Enum):  # test_scorm_runtime_logic.py:95,144,290
    COMPLETED = "completed"
    PASSED = "passed"
    FAILED = "failed"
    INCOMPLETE = "incomplete"
    NOT_ATTEMPTED = "not attempted"
    UNKNOWN = "unknown"
    BROWSED = "browsed"                 # SCORM 1.2 lesson_status vocabulary

class SuccessStatusEnum(str, Enum):     # test_scorm_runtime_logic.py:96,157
    PASSED = "passed"
    FAILED = "failed"
    UNKNOWN = "unknown"
```

> `CompletionStatusEnum` values must be the **wire tokens** (e.g. `"not attempted"`),
> because `test_scorm_runtime_logic.py:80-85` asserts `cmi.completion_status` is a
> valid 2004 token and never the enum slug `not_attempted`.

### Models

```python
class ScormPackage(SQLModel, table=True):
    __tablename__ = "scorm_package"
    id: Optional[int] = PK
    package_uuid: str = unique index
    org_id: int  -> ForeignKey("organization.id", ondelete="CASCADE")
    course_id: int -> ForeignKey("course.id", ondelete="CASCADE")
    scorm_version: ScormVersionEnum
    package_title: str
    file_count: int
    total_size_bytes: int
    created_at / updated_at

class ScormRuntimeData(SQLModel, table=True):
    __tablename__ = "scorm_runtime_data"
    id: Optional[int] = PK
    activity_id: int -> ForeignKey("activity.id", ondelete="CASCADE")
    user_id: int     -> ForeignKey("user.id", ondelete="CASCADE")
    org_id: int      -> ForeignKey("organization.id", ondelete="CASCADE")
    completion_status: CompletionStatusEnum
    success_status: SuccessStatusEnum
    score_raw: Optional[int]
    score_scaled: Optional[float]
    total_time: str            # ISO-8601 duration ("PT90S")
    suspend_data: str
    cmi_data: dict = JSON      # full CMI map (see §5)
    update_date / creation_date
    # one row per (activity_id, user_id)
```

`ScormScoAssignment` is an **input DTO**, not a table
(`test_scorm_import_dedup.py:15,40`). A plain `SQLModel`/dataclass with
`sco_identifier: str`, `chapter_id: int`, `activity_name: str` suffices.

### ⚠️ Critical: FK cascade requirement

`test_demo_teardown.py:82-105` asserts **every FK to `organization` and `user`
is `ON DELETE CASCADE`** (or explicitly allowlisted as `SET NULL`). Because
pytest imports the SCORM test modules at collection, `ee.db.scorm` registers on
the shared `SQLModel.metadata`, so the teardown test *will* see these FKs.
Therefore: **every `org_id` and `user_id` FK must be `ondelete="CASCADE"`.**
Do not add a `default_role_id`-style SET NULL here.

---

## 4. Parser / storage service — `ee/services/scorm/scorm.py`

### 4a. Parsing (pure functions — `test_scorm_parsing.py`)

```python
def detect_scorm_version(root) -> ScormVersionEnum:
    # 1.2 namespace / schemaversion "1.2"  -> SCORM_12
    # 2004 namespace / schemaversion "2004 *" -> SCORM_2004

def extract_scos_from_manifest(root, version) -> list[ScoInfo]:
    # ScoInfo has .launch_path, .title, .mastery_score
    # - walk organization items; only LEAF items with an identifierref count
    #   (nested chapter items yield no SCO — test :54-59)
    # - resolve the referenced <resource>; accept resources WITHOUT type/
    #   scormtype (:61-65) and 2004 camelCase adlcp:scormType (:67-72)
    # - launch path precedence: resource@href -> first <file>@href (:115-133)
    # - prepend xml:base from <resources> and <resource> (:79-95)
    # - normalize "./" and "\" -> "/" (:135-146)
    # - parse <adlcp:masteryscore> on the item (:97-112)

def get_package_title(root) -> str          # unicode-preserving (:74-77)

def sanitize_path(path: str) -> str:
    # strips traversal segments, leading "/", normalizes "\" -> "/", drops "."

def validate_scorm_zip(data: bytes) -> bool # PK\x03\x04 magic
```

### 4b. Content path resolution (`test_scorm_content_path.py`)

```python
def get_scorm_content_path(org_uuid, course_uuid, activity_uuid, file_path,
                           package_uuid: str | None = None) -> str | None:
    # shared layout when package_uuid given:
    #   content/orgs/{org_uuid}/courses/{course_uuid}/scorm/{package_uuid}/extracted
    # legacy per-activity layout otherwise:
    #   content/orgs/{org_uuid}/courses/{course_uuid}/activities/{activity_uuid}/scorm/extracted
    # strip "?query" and "#fragment" from file_path (Storyline/Rise) (:24-30)
    # realpath containment; traversal -> None (:38-41); missing -> None (:43-46)
```

### 4c. Upload + extraction (hardened — `test_scorm_upload_pipeline.py`, `test_scorm_extract.py`)

Constants (module-level so tests can monkeypatch them):

```python
TEMP_SCORM_DIR = "content/temp/scorm"
MAX_SCORM_PACKAGE_SIZE       # declared/streamed upload cap  (413)
MAX_SCORM_FILE_SIZE          # per extracted file cap       (skip file)
MAX_SCORM_UNCOMPRESSED_SIZE  # aggregate cap                (413)
```

```python
def _validate_temp_package_id(temp_package_id) -> str:
    # UUID regex ^[0-9a-f]{8}-...-[0-9a-f]{12}$ (case-insensitive); else 400
    # (mirrored in test_scorm_security.py:21-25)

def _safe_extract_zip(zip_path, extract_dir) -> dict:
    # returns {"file_count": int, "total_size_bytes": int,
    #          "largest_files": [{"path": str, "size_bytes": int}, ...]}
    # - skip path-traversal entries (never write outside extract_dir)  test_extract.py:27-35
    # - skip symlink entries entirely                                  test_extract.py:38-44
    # - skip files over MAX_SCORM_FILE_SIZE                            test_extract.py:47-58
    # - 413 when aggregate over MAX_SCORM_UNCOMPRESSED_SIZE            test_upload_pipeline.py:63-71
    # - 413 naming the offending file for per-file cap                 test_upload_pipeline.py:49-61
    # - reject zip-bomb ratio when package cap is exceeded             test_extract.py:60-69
    # Copy the entry/size/ratio/symlink logic from
    # src/services/courses/transfer/import_service.py:252-333

async def _stream_scorm_upload_to_disk(upload, dest_path) -> int:
    # - 413 when declared upload.size > MAX_SCORM_PACKAGE_SIZE (before reading) :93-99
    # - 413 when undeclared size crosses the cap mid-stream                    :101-109
    # - 415 for non-PK magic or empty                                          :111-121
    # - returns bytes written                                                  :123-130

async def _ensure_temp_package_local(temp_package_id) -> str:
    # local hit  -> return content/temp/scorm/{id}                             :134-142
    # missing    -> restore package.zip from S3 then unzip via storage_utils   :144-161
    # gone       -> 404                                                        :163-178

def _materialize_shared_package(temp_dir, extract_dir, org_uuid, course_uuid,
                                scorm_package_uuid) -> str:
    # MOVE extracted/ to content/orgs/{org}/courses/{course}/scorm/{pkg}/extracted
    # also move package.zip alongside
    # when S3: upload package.zip + upload_directory_to_s3_parallel
    # 500 on S3 upload failure                                                 :181-219
```

Use `defusedxml.ElementTree` for all XML parsing — `test_scorm_security.py:72-86`
reads the source and fails if it sees `import xml.etree.ElementTree as ET`.

### 4d. Import (`test_scorm_import_dedup.py`)

```python
async def import_scorm_package(request, temp_package_id, assignments,
                               current_user, db_session, course_uuid) -> list[Activity]:
    # 1. _validate_temp_package_id, _ensure_temp_package_local
    # 2. parse manifest once -> version, title, SCOS
    # 3. ONE shared package_uuid for the whole import; extract/move ONCE via
    #    _materialize_shared_package (no per-SCO duplication)          :54-61
    # 4. create one Activity per assignment:
    #      activity_type = TYPE_SCORM
    #      activity_sub_type = SUBTYPE_SCORM_12 | SUBTYPE_SCORM_2004
    #      content = {scorm_version, entry_point, sco_identifier, sco_title,
    #                 mastery_score?, scorm_package_uuid}
    #    + ChapterActivity placement + Chapter validation (mirror
    #    src/services/courses/activities/activities.py:41-113)
    # 5. delete the temp dir after success                            :70-71
    # 6. return the created activities
```

---

## 5. Runtime service — `ee/services/scorm/scorm_runtime.py`

Signatures fixed by the tests:

```python
async def initialize_scorm_session(request, activity_uuid, current_user, db_session) -> dict
    # -> {"cmi_data": {element: value, ...}}

async def commit_scorm_data(request, activity_uuid, cmi: dict, current_user, db_session) -> dict
async def get_runtime_data(request, activity_uuid, current_user, db_session) -> ScormRuntimeData
async def get_activity_results(request, activity_uuid, current_user, db_session) -> list[Result]

def parse_iso8601_duration(text: str) -> int   # seconds; "" / garbage -> 0
def format_scorm_12_time(seconds: int) -> str  # "HHHH:MM:SS.ss", hours clamp 9999
```

### Behaviours the tests pin (the "P0 fixes")

| Behaviour | Test |
|---|---|
| Fresh session `cmi.core.entry == "ab-initio"`; after a suspend commit → `"resume"`; `cmi.core.exit == "normal"` → `ab-initio` | `test_scorm_runtime_logic.py:61-76`, `test_scorm_conformance.py:60-81` |
| 2004 initial `cmi.completion_status` is a valid token (`not attempted`), never the slug `not_attempted` | `test_scorm_runtime_logic.py:79-85` |
| `completion_status` and `success_status` are independent | `:87-96` |
| `session_time` is **cumulative per session** — repeated commits with `00:00:30/00:01:00/00:01:30` yield total **90s**, not 180s | `:99-113` |
| `total_time` **accumulates across sessions** (60s + 40s = 100s) | `:115-127` |
| `suspend_data` > 4096 must **not** drop completion/score | `:130-146` |
| SCORM 1.2 `lesson_status="passed"` → `success_status = PASSED` | `:149-157` |
| Internal `_vb_*` keys must never be returned to content | `:160-168` |
| `mastery_score` from `activity.content` exposed as `cmi.student_data.mastery_score` | `test_scorm_conformance.py:113-126` |
| Array counts injected on resume: `cmi.interactions._count`, `cmi.objectives._count` | `:99-110` |
| Write-only elements (`cmi.core.session_time`, `cmi.core.exit`) **not echoed** on resume | `:129-140` |
| Duration parsing incl. `P1W`, `P1DT2H`, `PT0.75S→0`, `00:01:30` | `:18-33` |
| Time formatting: `3723 → "0001:02:03.00"`, `10000h → "9999:00:00.00"` | `:36-42` |
| Cross-org initialize/commit → 401/403/404 | `test_scorm_runtime_logic.py:217-228` |
| Completion (`lesson_status=completed`) creates exactly one `TrailStep(complete=True)`; incomplete creates none | `:242-265` |
| Instructor sees results (`score_raw`, `completion_status`, `email`); learner gets 401/403 | `:279-297` |

**Completion → trail:** call the existing
`src.services.trail.trail.add_activity_to_trail` (`trail.py:216`) only when the
activity has a `course_id` and transitions to a completed/passed state. It
creates the `TrailStep` and fires `track` / `record_audit_event` /
`dispatch_webhooks` / certificate issuance — which the tests patch
(`test_scorm_runtime_logic.py:234-240`). Do **not** reimplement any of that.

**Authorization:** reuse `check_resource_access` / org membership exactly as
`add_activity_to_trail` does (`trail.py:258`); results listing requires
course-management rights (`get_activity_results`).

---

## 6. Router — `ee/routers/scorm.py`

Endpoints (paths relative to the `/api/v1` mount). Signatures/response shapes
come from `apps/web/ee/services/scorm/*` and `apps/e2e/features/scorm/api.ts`.

| Method & path | Auth | Contract |
|---|---|---|
| `POST /scorm/analyze/{course_uuid}` | course manager | multipart field **`scorm_file`** → `{temp_package_id, scorm_version, package_title, scos:[{identifier,title,launch_path,prerequisites}], file_count?, total_size_bytes?, largest_files?}` |
| `POST /scorm/analyze-for-import/{org_id}` | org manager | same multipart + response (used by `ScormCourseImport`) |
| `POST /scorm/import/{course_uuid}` | course manager | JSON `{temp_package_id, sco_assignments:[{sco_identifier, chapter_id, activity_name}]}` → **JSON array** of activities |
| `POST /scorm/import-as-course` | org manager | JSON `{org_id, temp_package_id, course_name, course_description, sco_assignments:[{sco_identifier, activity_name, chapter_name}]}` |
| `GET /scorm/{activity_uuid}/content/{file_path:path}` (+ `HEAD`) | course access | serve package file **same-origin**; forward Range/If-*; 3xx storage redirects; **its own course-access check** (must not fall through to the public org-content branch) |
| `POST /scorm/{activity_uuid}/runtime/initialize` | course access | no body → `{cmi_data: {...}}` |
| `POST /scorm/{activity_uuid}/runtime/commit` | course access | body = CMI map → 2xx |
| `POST /scorm/{activity_uuid}/runtime/terminate` | course access | body = CMI map → 2xx |
| `GET /scorm/{activity_uuid}/runtime/data` | course access | runtime row |
| `GET /scorm/{activity_uuid}/results` | course manager | `[{user_uuid, first_name, last_name, email, completion_status, success_status, score_raw, score_scaled, total_time, update_date}]` |

Notes:
- **Same-origin is mandatory** for the runtime bridge (`window.API` /
  `window.API_1484_11`). The content endpoint must stream from the shared
  package path (§4b) and set no `X-Frame-Options: DENY`.
- Reuse the MIME/Range/presigned logic in `src/routers/content_files.py` and
  `src/routers/local_content.py`; do **not** route through their generic
  `orgs/...` public fallthrough.
- `results`/routine endpoints must enforce org/course access — the frontend
  treats 403 as "needs course management access" (`ScormResults.tsx:70-80`).

---

## 7. EE wiring

`ee/hooks.py`:

```python
def register_routers(v1_router):
    from ee.routers.scorm import router as scorm_router
    v1_router.include_router(scorm_router, prefix="/scorm", tags=["scorm"])
```

Already wired: `src/router.py:454` calls `register_ee_routers(v1_router)`;
`src/core/ee_hooks.py:51-55` invokes `ee.hooks.register_routers` when
`ee/hooks.py` exists and `VALIDBRIDGE_DISABLE_EE != "1"`.

**Test-suite caveat:** `src/tests/conftest.py:28` pins
`VALIDBRIDGE_DISABLE_EE=1` for the whole suite, so `register_ee_routers` is a
no-op during pytest. That is fine — the SCORM tests import the service modules
**directly**, so they run regardless. Router behaviour is covered by the e2e
suite (`apps/e2e/features/scorm/`) against an EE stack.

---

## 8. Config / env

No new config keys are required. Optional operator knobs (give them defaults;
read lazily so tests can monkeypatch): the four `MAX_SCORM_*` / `TEMP_SCORM_DIR`
constants already live in `ee/services/scorm/scorm.py`. If you add env overrides,
document them in `.env.example`. Do **not** add secrets anywhere.

---

## 9. Ordered milestones + definition of done

### M0 — Correct the stale doc + create the EE package skeleton
- Fix `missing.md` §C line 412 (`src/db/scorm/` → `ee/`).
- Create `ee/__init__.py`, `ee/db/__init__.py`, `ee/services/__init__.py`,
  `ee/services/scorm/__init__.py`, `ee/routers/__init__.py`, `ee/hooks.py`.
- **DoD:** `uv run python -c "import ee"` works; `test_demo_teardown.py` still green.

### M1 — `ee/db/scorm.py` (enums + models)
- **DoD:** the 3 enum/2 model imports resolve; `test_demo_teardown.py` green
  (FK cascades); `alembic heads` unchanged single/multi-head state as before.
- Verify:
  `uv run pytest src/tests/services/test_demo_teardown.py -q`

### M2 — `ee/services/scorm/scorm.py`: parsing + paths + zip validation
- **DoD:** `test_scorm_parsing.py`, `test_scorm_content_path.py`,
  `test_scorm_security.py`, `test_scorm_extract.py` green.
- Verify:
  `uv run pytest src/tests/services/test_scorm_parsing.py src/tests/services/test_scorm_content_path.py src/tests/security/test_scorm_security.py src/tests/security/test_scorm_extract.py -q`

### M3 — upload/extract/materialize pipeline
- **DoD:** `test_scorm_upload_pipeline.py` green.
- Verify: `uv run pytest src/tests/services/test_scorm_upload_pipeline.py -q`

### M4 — import (dedup) + activity creation
- **DoD:** `test_scorm_import_dedup.py` green.
- Verify: `uv run pytest src/tests/services/test_scorm_import_dedup.py -q`

### M5 — runtime + results
- **DoD:** `test_scorm_runtime_logic.py`, `test_scorm_conformance.py` green.
- Verify:
  `uv run pytest src/tests/services/test_scorm_runtime_logic.py src/tests/services/test_scorm_conformance.py -q`

### M6 — router + EE hook + content proxy
- **DoD:** all 8 SCORM test files green; `ruff check ee/` clean (only the
  repo-wide `B008` `Depends()` class of warnings, which the codebase already
  has 1000+ of); manual e2e smoke against an EE stack.
- Verify (full SCORM suite):
  `uv run pytest src/tests/services/test_scorm_*.py src/tests/security/test_scorm_*.py -q`
  `uv run --with ruff ruff check ee/`
  e2e (needs EE stack + `VALIDBRIDGE_DISABLE_EE` unset):
  `cd apps/e2e && E2E_BASE_URL=http://localhost:3000 E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… bun run test features/scorm`

Definition of done (all): all 8 pytest SCORM files green; `test_demo_teardown`
green; `ruff` clean on `ee/`; e2e specs pass on an EE stack; no secret in DB/code;
`missing.md` §C + status row updated.

---

## 10. Anti-hallucination guardrails

**Do**
- Treat the 8 test files as the spec — if code and test disagree, the test wins.
- Copy the hardened zip logic from `src/services/courses/transfer/import_service.py`.
- Reuse `storage_utils` (`upload_directory_to_s3_parallel`, `delete_storage_directory`,
  `is_s3_enabled`, `download_file_from_s3`), `add_activity_to_trail`, and the
  content-serving routers.
- Keep all caps as monkeypatchable module constants.
- Use `defusedxml` only.

**Don't**
- Don't create a second SCORM migration or touch `f8a3c2d1e5b7`.
- Don't add SCORM to `src/db/` / `src/routers/` — it's `ee/` (tests + e2e + hooks).
- Don't duplicate the extracted package per SCO — one shared root per package.
- Don't reimplement trail/webhook/certificate side effects.
- Don't let `/scorm/{uuid}/content/...` fall through to the public org-content rule.
- Don't default any `org_id`/`user_id` FK to NO ACTION (teardown test fails).
- Don't echo write-only CMI elements or `_vb_*` internal keys on resume.
- Don't double-count cumulative `session_time` across commits.
- Don't emit the enum slug `not_attempted` as a 2004 completion token.

---

## 11. Test → requirement coverage

| Requirement | Covered by |
|---|---|
| Version detection, SCO extraction, xml:base, masteryscore, sanitize, zip magic | `test_scorm_parsing.py` |
| Path resolution, query/fragment, traversal, missing | `test_scorm_content_path.py` |
| Streaming upload caps, non-zip, S3 restore, shared materialization | `test_scorm_upload_pipeline.py` |
| One shared extracted root, temp cleanup, content resolves | `test_scorm_import_dedup.py` |
| Resume/entry, 2004 token, total_time, suspend overflow, trail sync, authz, results | `test_scorm_runtime_logic.py` |
| Duration parse/format, exit semantics, counts, mastery, write-only hygiene | `test_scorm_conformance.py` |
| Path traversal, symlink, size/bomb guards, XXE | `test_scorm_extract.py` |
| UUID validation + defusedxml source check | `test_scorm_security.py` |
| End-to-end upload→analyze→import→runtime→results (REST + browser) | `apps/e2e/features/scorm/` |

---

## 12. Open items / decisions

1. **`ee/` vs `src/`** — resolved above in favour of `ee/` (tests + e2e + hooks
   are unambiguous). M0 corrects `missing.md` §C.
2. **Migration for `scorm_package` / `scorm_runtime_data`** — the repo creates
   EE tables via `import_all_models` + `create_all` in `src/core/events/database.py:386-400`
   (the `customdomain` table does exactly this, with no Alembic migration). Do
   the same unless you want migration-managed EE tables; if so, add **one** new
   revision chained to the current head and to the TBD backend-head, and register
   the new FKs in `test_demo_teardown.py`'s allowlist only if they are SET NULL
   (they should all be CASCADE, so no allowlist change is needed).
3. **`ScormPackage` table optionality** — the tests only strictly require
   `ScormRuntimeData` and `ScormScoAssignment`; the package row is a convenience
   for dedup/cleanup and can be folded into `activity.content` if you prefer
   minimal schema. Keep `ScormRuntimeData` regardless (tests import it).
