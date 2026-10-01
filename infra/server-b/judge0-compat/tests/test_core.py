import base64
import io
import zipfile

import pytest

from app import core
from app.languages import LANGUAGES, get_language

LIM = core.Limits()
PY = get_language(71)
C = get_language(50)
JAVA = get_language(62)


def prep(lang=PY, **body):
    body.setdefault("source_code", "print(1)")
    return core.prepare(body, lang, LIM, False)


def run(stdout="", stderr="", code=0, signal=None, status=None, message=None, cpu=12, mem=10_240_000):
    return {"stdout": stdout, "stderr": stderr, "code": code, "signal": signal, "status": status,
            "message": message, "cpu_time": cpu, "wall_time": cpu + 5, "memory": mem, "output": stdout + stderr}


def resp(piston, p=None, lang=PY):
    return core.build_response(piston, p or prep(lang), lang, "tok", LIM)


def sid(r):
    return r["status"]["id"]


def test_accepted_fields():
    r = resp({"run": run(stdout="hi\n", cpu=38, mem=9_000_000)})
    assert sid(r) == 3 and r["status"]["description"] == "Accepted"
    assert r["stdout"] == "hi\n" and r["stderr"] is None and r["compile_output"] is None
    assert r["time"] == "0.038" and r["memory"] == 9000 and r["token"] == "tok"


def test_wrong_answer_only_with_expected_output():
    p = prep(expected_output="2\n")
    assert sid(resp({"run": run(stdout="1\n")}, p)) == 4
    assert sid(resp({"run": run(stdout="2   \n\n")}, p)) == 3
    assert sid(resp({"run": run(stdout="1\n")})) == 3  # no expected_output: API compares itself


def test_time_limit():
    assert sid(resp({"run": run(code=None, signal="SIGKILL", status="TO")})) == 5


def test_compile_error_strips_gcc_chmod_line():
    piston = {"compile": {"code": 1, "signal": None, "status": None, "stdout": "", "stderr": "",
                          "output": "main.c:1:1: error: x\nchmod: cannot access 'a.out': No such file or directory\n"},
              "run": None}
    r = resp(piston, prep(C, source_code="x"), C)
    assert sid(r) == 6
    assert "error: x" in r["compile_output"] and "chmod" not in r["compile_output"]


def test_compile_timeout_is_compilation_error():
    piston = {"compile": {"code": None, "signal": "SIGKILL", "status": "TO", "output": ""}}
    assert sid(resp(piston, prep(C), C)) == 6


def test_java_compile_error_in_run_stage():
    r = resp({"run": run(stderr="Main.java:3: error: ';' expected\n1 error\nerror: compilation failed\n", code=1)},
             prep(JAVA), JAVA)
    assert sid(r) == 6 and r["stderr"] is None and "compilation failed" in r["compile_output"]


@pytest.mark.parametrize("sig,code,expected", [
    ("SIGSEGV", None, 7), (None, 139, 7), (None, 153, 8), ("SIGFPE", None, 9), (None, 136, 9),
    (None, 134, 10), ("SIGABRT", None, 10), (None, 1, 11), (None, 2, 11), (None, 137, 12), ("SIGKILL", None, 12),
])
def test_runtime_errors(sig, code, expected):
    assert sid(resp({"run": run(code=code, signal=sig)})) == expected


def test_memory_kill_message():
    r = resp({"run": run(code=137, mem=260_000_000)})
    assert sid(r) == 12 and r["message"] == "Memory limit exceeded"


@pytest.mark.parametrize("st", ["OL", "EL"])
def test_output_limit(st):
    assert sid(resp({"run": run(code=None, signal="SIGKILL", status=st, message="stdout length exceeded")})) == 12


def test_sandbox_internal_error():
    assert sid(resp({"run": run(code=None, status="XX", message="boom")})) == 13
    assert sid(resp({})) == 13
    assert sid(resp({"compile": {"code": None, "status": "XX", "output": ""}}, prep(C), C)) == 13


def test_internal_error_shape():
    r = core.internal_error("down", "t")
    assert r["status"] == {"id": 13, "description": "Internal Error"} and r["message"] == "down"


def test_base64_roundtrip():
    enc = lambda s: base64.b64encode(s.encode()).decode()
    p = core.prepare({"source_code": enc("print(1)"), "stdin": enc("x"), "expected_output": enc("1")}, PY, LIM, True)
    assert p.piston_request["files"][0]["content"] == "print(1)" and p.piston_request["stdin"] == "x"
    r = core.build_response({"run": run(stdout="1\n")}, p, PY, "t", LIM)
    assert sid(r) == 3 and base64.b64decode(r["stdout"]).decode() == "1\n"


def test_prepare_request_and_limits():
    p = prep(stdin="in", cpu_time_limit=100, memory_limit=10240, wall_time_limit=0.5)
    req = p.piston_request
    assert req["language"] == "python" and req["version"] == "3.12.0" and req["stdin"] == "in"
    assert req["files"][0] == {"name": "main.py", "content": "print(1)", "encoding": "utf8"}
    assert req["run_cpu_time"] == LIM.run_cpu_ms          # clamped
    assert req["run_memory_limit"] == 10240 * 1024
    assert req["run_timeout"] == 500
    assert "run_cpu_time" not in prep().piston_request     # Piston default + per-language overrides


def test_blank_source_rejected():
    with pytest.raises(core.InputError):
        core.prepare({"source_code": ""}, PY, LIM, False)


def _zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for n, d in entries.items():
            zf.writestr(n, d)
    return base64.b64encode(buf.getvalue()).decode()


def test_additional_files_binary_safe_and_after_main():
    db = bytes(range(256)) * 4
    p = prep(additional_files=_zip({"db.sqlite3": db, "data/x.txt": "hello", "main.py": "evil"}))
    files = p.piston_request["files"]
    assert files[0]["name"] == "main.py" and files[0]["content"] == "print(1)"
    names = [f["name"] for f in files[1:]]
    assert names == ["db.sqlite3", "data/x.txt"]  # clash with main file dropped
    assert all(f["encoding"] == "base64" for f in files[1:])
    assert base64.b64decode(files[1]["content"]) == db


@pytest.mark.parametrize("name", ["../x", "/etc/passwd", "a/../../x"])
def test_additional_files_unsafe_paths(name):
    with pytest.raises(core.InputError):
        prep(additional_files=_zip({name: "x"}))


def test_additional_files_not_zip():
    with pytest.raises(core.InputError):
        prep(additional_files=base64.b64encode(b"nope").decode())


def test_additional_files_size_cap():
    small = core.Limits(max_zip_bytes=10)
    with pytest.raises(core.InputError):
        core.prepare({"source_code": "x", "additional_files": _zip({"a": "x" * 11})}, PY, small, False)


def test_sql_is_wrapped_in_python(tmp_path, monkeypatch):
    sql = get_language(82)
    p = core.prepare({"source_code": "CREATE TABLE t(a,b); INSERT INTO t VALUES(1,NULL);\nSELECT * FROM t; SELECT 'x;y';"},
                     sql, LIM, False)
    req = p.piston_request
    assert req["language"] == "python" and req["files"][0]["name"] == "main.py"
    # The wrapper itself must behave like the sqlite3 shell
    import subprocess, sys
    (tmp_path / "main.py").write_text(req["files"][0]["content"])
    out = subprocess.run([sys.executable, "main.py"], cwd=tmp_path, capture_output=True, text=True)
    assert out.returncode == 0 and out.stdout == "1|\nx;y\n"
    (tmp_path / "db.sqlite3").unlink()
    bad = core.prepare({"source_code": "SELECT * FROM nope;"}, sql, LIM, False)
    (tmp_path / "main.py").write_text(bad.piston_request["files"][0]["content"])
    out = subprocess.run([sys.executable, "main.py"], cwd=tmp_path, capture_output=True, text=True)
    assert out.returncode == 1 and "no such table" in out.stderr


def test_product_languages_all_mapped():
    product = [71, 63, 74, 62, 54, 50, 73, 60, 68, 72, 78, 51, 83, 81, 85, 80, 90, 61, 64, 57, 86, 82, 46, 79,
               77, 59, 69, 55, 91, 45]
    for i in product:
        l = LANGUAGES[i]
        assert l.unavailable or (l.piston_language and l.piston_version and l.filename), i


def test_select_fields():
    r = core.internal_error("m", "t")
    assert core.select_fields(r, "status,token") == {"status": r["status"], "token": "t"}
    assert core.select_fields(r, "*") == r
