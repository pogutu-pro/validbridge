"""Pure translation between Judge0 submissions and Piston executions.

No I/O here, so every mapping rule is unit-tested (tests/test_core.py).
"""

from __future__ import annotations

import base64
import binascii
import io
import posixpath
import re
import signal as _signal
import zipfile
from dataclasses import dataclass, field

from .languages import Language

# Judge0 CE status table (GET /statuses)
STATUSES: dict[int, str] = {
    1: "In Queue",
    2: "Processing",
    3: "Accepted",
    4: "Wrong Answer",
    5: "Time Limit Exceeded",
    6: "Compilation Error",
    7: "Runtime Error (SIGSEGV)",
    8: "Runtime Error (SIGXFSZ)",
    9: "Runtime Error (SIGFPE)",
    10: "Runtime Error (SIGABRT)",
    11: "Runtime Error (NZEC)",
    12: "Runtime Error (Other)",
    13: "Internal Error",
    14: "Exec Format Error",
}

_SIGNAL_STATUS = {
    int(_signal.SIGSEGV): 7,
    int(_signal.SIGXFSZ): 8,
    int(_signal.SIGFPE): 9,
    int(_signal.SIGABRT): 10,
}


class InputError(ValueError):
    """Bad request from the caller -> HTTP 422 {field: [message]}."""

    def __init__(self, field_name: str, message: str):
        super().__init__(message)
        self.field = field_name
        self.message = message


@dataclass
class Limits:
    run_cpu_ms: int = 3000
    run_wall_ms: int = 5000
    run_memory_bytes: int = 256 * 1024 * 1024
    max_zip_bytes: int = 20 * 1024 * 1024  # uncompressed total
    max_zip_entries: int = 50


@dataclass
class Prepared:
    """What we send to Piston plus what we need to build the answer."""

    piston_request: dict
    expected_output: str | None
    base64_encoded: bool
    file_count: int = 0
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------- input


def _b64_text(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    try:
        return base64.b64decode(value, validate=False).decode("utf-8", errors="replace")
    except (binascii.Error, ValueError):
        raise InputError(field_name, "is not valid base64")


def unzip_additional_files(b64zip: str, limits: Limits) -> list[dict]:
    """Judge0 `additional_files`: base64 zip extracted into the working dir.

    Returned as Piston files with base64 content so binary files (SQLite
    databases) survive and Piston does not pass them to compile scripts.
    """
    try:
        raw = base64.b64decode(b64zip, validate=False)
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except (binascii.Error, ValueError, zipfile.BadZipFile):
        raise InputError("additional_files", "must be a base64 encoded zip archive")
    files: list[dict] = []
    total = 0
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir()]
        if len(infos) > limits.max_zip_entries:
            raise InputError("additional_files", f"has more than {limits.max_zip_entries} files")
        for info in infos:
            name = info.filename.replace("\\", "/")
            norm = posixpath.normpath(name)
            if (
                name.startswith("/")
                or norm.startswith("..")
                or "/../" in f"/{norm}/"
                or "\x00" in name
                or norm in (".", "")
            ):
                raise InputError("additional_files", f"has an unsafe path: {name!r}")
            total += info.file_size
            if total > limits.max_zip_bytes:
                raise InputError(
                    "additional_files", f"is larger than {limits.max_zip_bytes // (1024 * 1024)} MB"
                )
            data = zf.read(info)
            files.append(
                {"name": norm, "content": base64.b64encode(data).decode("ascii"), "encoding": "base64"}
            )
    return files


# Judge0's SQL language runs the script with the sqlite3 shell against
# db.sqlite3 in the working directory: list mode, "|" separator, no headers,
# NULL printed as an empty string. This Python program reproduces that.
_SQL_WRAPPER = '''import base64, sqlite3, sys
sql = base64.b64decode("{b64}").decode("utf-8", "replace")
try:
    conn = sqlite3.connect("db.sqlite3")
except sqlite3.Error:
    conn = sqlite3.connect(":memory:")
conn.isolation_level = None
cur = conn.cursor()
failed = False
def run(stmt):
    global failed
    stmt = stmt.strip()
    if not stmt or stmt == ";":
        return
    try:
        cur.execute(stmt)
        if cur.description:
            for row in cur.fetchall():
                print("|".join("" if v is None else str(v) for v in row))
    except sqlite3.Error as e:
        failed = True
        print("Error: " + str(e), file=sys.stderr)
buf = ""
for ch in sql:
    buf += ch
    if ch == ";" and sqlite3.complete_statement(buf):
        run(buf)
        buf = ""
run(buf)
conn.close()
sys.exit(1 if failed else 0)
'''


def sql_wrapper(sql: str) -> str:
    return _SQL_WRAPPER.replace("{b64}", base64.b64encode(sql.encode("utf-8")).decode("ascii"))


def _num(value, field_name: str) -> float | None:
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise InputError(field_name, "is not a number")
    if v <= 0:
        raise InputError(field_name, "must be greater than 0")
    return v


def prepare(body: dict, language: Language, limits: Limits, base64_encoded: bool) -> Prepared:
    source = body.get("source_code")
    stdin = body.get("stdin")
    expected = body.get("expected_output")
    if base64_encoded:
        source = _b64_text(source, "source_code")
        stdin = _b64_text(stdin, "stdin")
        expected = _b64_text(expected, "expected_output")
    if source is None or source == "":
        raise InputError("source_code", "can't be blank")
    if not isinstance(source, str):
        raise InputError("source_code", "must be a string")

    if language.sql:
        source = sql_wrapper(source)

    files = [{"name": language.filename, "content": source, "encoding": "utf8"}]
    extra = body.get("additional_files")
    if extra:
        taken = {language.filename}
        for f in unzip_additional_files(extra, limits):
            if f["name"] not in taken:
                taken.add(f["name"])
                files.append(f)

    req: dict = {
        "language": language.piston_language,
        "version": language.piston_version,
        "files": files,
        "stdin": stdin or "",
        "args": [],
    }
    # Caller limits may only lower the adapter's ceilings. Absent => Piston's
    # configured default (which has per-language overrides, e.g. the JVM).
    cpu = _num(body.get("cpu_time_limit"), "cpu_time_limit")
    wall = _num(body.get("wall_time_limit"), "wall_time_limit")
    mem = _num(body.get("memory_limit"), "memory_limit")  # KB
    if cpu is not None:
        req["run_cpu_time"] = max(1, min(int(cpu * 1000), limits.run_cpu_ms))
    if wall is not None:
        req["run_timeout"] = max(1, min(int(wall * 1000), limits.run_wall_ms))
    if mem is not None:
        req["run_memory_limit"] = max(1024 * 1024, min(int(mem * 1024), limits.run_memory_bytes))

    return Prepared(
        piston_request=req,
        expected_output=expected,
        base64_encoded=base64_encoded,
        file_count=len(files),
    )


# ---------------------------------------------------------------- output


def normalize_output(s: str | None) -> str:
    """Line-wise rstrip, drop trailing blank lines (same rule as the API)."""
    if not s:
        return ""
    lines = [line.rstrip() for line in s.splitlines()]
    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


_GCC_CHMOD_RE = re.compile(r"^chmod: cannot access '[^']*': No such file or directory\n?", re.M)
_JAVA_COMPILE_FAIL = "error: compilation failed"


def _signal_number(stage: dict) -> int | None:
    name = stage.get("signal")
    if name:
        try:
            return int(getattr(_signal, name))
        except (AttributeError, TypeError, ValueError):
            return None
    code = stage.get("code")
    # Programs run under a bash wrapper, so a signal usually shows as 128+N
    if isinstance(code, int) and 128 < code < 160:
        return code - 128
    return None


def _empty_to_none(s: str | None) -> str | None:
    return s if s else None


def _fmt_time(ms) -> str | None:
    if ms is None:
        return None
    try:
        return f"{float(ms) / 1000:.3f}"
    except (TypeError, ValueError):
        return None


def _kb(mem) -> int | None:
    if mem is None:
        return None
    try:
        return int(int(mem) / 1000)  # Piston reports cgroup KB * 1000
    except (TypeError, ValueError):
        return None


def internal_error(message: str, token: str) -> dict:
    return {
        "stdout": None,
        "stderr": None,
        "compile_output": None,
        "message": message,
        "time": None,
        "wall_time": None,
        "memory": None,
        "exit_code": None,
        "exit_signal": None,
        "token": token,
        "status": {"id": 13, "description": STATUSES[13]},
    }


def build_response(
    piston: dict, prepared: Prepared, language: Language, token: str, limits: Limits
) -> dict:
    """Map a Piston /api/v2/execute answer to a Judge0 submission."""
    compile_ = piston.get("compile") or None
    run = piston.get("run") or None

    stdout = stderr = compile_output = message = None
    time = wall_time = memory = exit_code = exit_signal = None

    status_id: int
    if compile_ is not None and (compile_.get("code") != 0 or compile_.get("status")):
        out = compile_.get("output") or compile_.get("stderr") or ""
        out = _GCC_CHMOD_RE.sub("", out)
        cstatus = compile_.get("status")
        if cstatus == "XX":
            status_id = 13
            message = compile_.get("message") or "compile stage failed inside the sandbox"
        else:
            status_id = 6
            if cstatus == "TO":
                message = "Compilation time limit exceeded"
            elif compile_.get("message"):
                message = compile_["message"]
            compile_output = _empty_to_none(out.rstrip("\n") + ("\n" if out.strip() else ""))
    elif run is None:
        status_id = 13
        message = "no run result from the code runner"
    else:
        stdout = _empty_to_none(run.get("stdout"))
        stderr = _empty_to_none(run.get("stderr"))
        time = _fmt_time(run.get("cpu_time"))
        wall_time = _fmt_time(run.get("wall_time"))
        memory = _kb(run.get("memory"))
        exit_code = run.get("code")
        rstatus = run.get("status")
        sig = _signal_number(run)
        exit_signal = sig
        pmsg = run.get("message")

        if rstatus == "XX":
            status_id = 13
            message = pmsg or "the sandbox failed to run the program"
        elif rstatus == "TO":
            status_id = 5
            message = "Time limit exceeded"
        elif rstatus in ("OL", "EL"):
            status_id = 12
            message = pmsg or "Output limit exceeded"
        elif (
            language.piston_language == "java"
            and exit_code not in (0, None)
            and stderr
            and _JAVA_COMPILE_FAIL in stderr
        ):
            # Java 15 compiles inside the run stage (source launcher)
            status_id = 6
            compile_output = stderr
            stderr = None
        elif sig is not None and sig in _SIGNAL_STATUS:
            status_id = _SIGNAL_STATUS[sig]
            message = f"Exited with signal {sig}"
        elif sig is not None:
            status_id = 12
            if sig == int(_signal.SIGKILL) and memory is not None and (
                memory * 1024 >= 0.9 * limits.run_memory_bytes
                or (prepared.piston_request.get("run_memory_limit") and memory * 1024 >= 0.9 * prepared.piston_request["run_memory_limit"])
            ):
                message = "Memory limit exceeded"
            elif sig == int(_signal.SIGKILL):
                message = "Killed (memory limit or resource limit)"
            else:
                message = f"Exited with signal {sig}"
        elif exit_code not in (0, None):
            status_id = 11
            message = f"Exited with error status {exit_code}"
        elif exit_code is None:
            status_id = 13
            message = pmsg or "the sandbox returned no exit status"
        else:
            status_id = 3
            if prepared.expected_output is not None and normalize_output(stdout) != normalize_output(
                prepared.expected_output
            ):
                status_id = 4

    resp = {
        "stdout": stdout,
        "stderr": stderr,
        "compile_output": compile_output,
        "message": message,
        "time": time,
        "wall_time": wall_time,
        "memory": memory,
        "exit_code": exit_code,
        "exit_signal": exit_signal,
        "token": token,
        "status": {"id": status_id, "description": STATUSES[status_id]},
    }
    if prepared.base64_encoded:
        for k in ("stdout", "stderr", "compile_output", "message"):
            if resp[k] is not None:
                resp[k] = base64.b64encode(resp[k].encode("utf-8")).decode("ascii")
    return resp


def select_fields(resp: dict, fields: str | None) -> dict:
    """Judge0 `?fields=a,b` (or `*`). Unknown names are ignored."""
    if not fields or fields.strip() == "*":
        return resp
    wanted = [f.strip() for f in fields.split(",") if f.strip()]
    return {k: resp.get(k) for k in wanted if k in resp}
