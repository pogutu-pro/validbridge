import os

os.environ["JUDGE0_COMPAT_TOKEN"] = "t" * 32
os.environ["PISTON_URL"] = "http://piston.test"

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

AUTH = {"X-Judge0-Client-Secret": "t" * 32, "X-Judge0-Client-ID": "anything"}
calls = []


def piston_ok(request: httpx.Request) -> httpx.Response:
    import json
    body = json.loads(request.content)
    calls.append(body)
    if body["language"] == "missing":
        return httpx.Response(400, json={"message": "missing-1 runtime is unknown"})
    return httpx.Response(200, json={"language": body["language"], "version": body["version"], "run": {
        "stdout": "hello\n", "stderr": "", "code": 0, "signal": None, "status": None, "message": None,
        "cpu_time": 20, "wall_time": 30, "memory": 8_000_000, "output": "hello\n"}})


@pytest.fixture()
def client():
    main.set_client(httpx.AsyncClient(transport=httpx.MockTransport(piston_ok)))
    calls.clear()
    with TestClient(main.app) as c:
        yield c


def test_requires_secret(client):
    assert client.post("/submissions?wait=true", json={}).status_code == 401
    assert client.post("/submissions?wait=true", json={}, headers={"X-Judge0-Client-Secret": "x"}).status_code == 401
    assert client.get("/languages").status_code == 401
    assert client.get("/health").status_code == 200


def test_wait_true_like_the_api(client):
    r = client.post("/submissions?wait=true", headers=AUTH,
                    json={"language_id": 71, "source_code": "print('hello')", "stdin": ""})
    assert r.status_code == 201
    j = r.json()
    assert j["status"] == {"id": 3, "description": "Accepted"} and j["stdout"] == "hello\n"
    assert calls[0]["files"][0]["name"] == "main.py"
    # Stored for GET /submissions/{token}
    g = client.get(f"/submissions/{j['token']}?fields=status,stdout", headers=AUTH).json()
    assert g == {"status": j["status"], "stdout": "hello\n"}


def test_wait_false_returns_token(client):
    r = client.post("/submissions", headers=AUTH, json={"language_id": 63, "source_code": "x"})
    assert r.status_code == 201 and list(r.json()) == ["token"]


def test_unknown_language_422(client):
    r = client.post("/submissions?wait=true", headers=AUTH, json={"language_id": 9999, "source_code": "x"})
    assert r.status_code == 422 and "doesn't exist" in r.json()["language_id"][0]


def test_unavailable_language_is_status_13(client):
    r = client.post("/submissions?wait=true", headers=AUTH, json={"language_id": 45, "source_code": "x"})
    assert r.status_code == 201 and r.json()["status"]["id"] == 13 and "arm64" in r.json()["message"]
    assert calls == []


def test_piston_runtime_missing_is_13(client, monkeypatch):
    from app.languages import Language
    monkeypatch.setitem(main.LANGUAGES, 71, Language(71, "Py", "missing", "1", "main.py"))
    r = client.post("/submissions?wait=true", headers=AUTH, json={"language_id": 71, "source_code": "x"})
    assert r.json()["status"]["id"] == 13 and "not installed" in r.json()["message"]


def test_piston_down_is_13(client):
    def boom(request):
        raise httpx.ConnectError("refused")
    main.set_client(httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    r = client.post("/submissions?wait=true", headers=AUTH, json={"language_id": 71, "source_code": "x"})
    assert r.status_code == 201 and r.json()["status"]["id"] == 13


def test_batch(client):
    r = client.post("/submissions/batch", headers=AUTH,
                    json={"submissions": [{"language_id": 71, "source_code": "x"}] * 3})
    toks = [x["token"] for x in r.json()]
    g = client.get("/submissions/batch?tokens=" + ",".join(toks), headers=AUTH).json()
    assert [s["status"]["id"] for s in g["submissions"]] == [3, 3, 3]


def test_about_languages_statuses(client):
    assert client.get("/about", headers=AUTH).status_code == 200
    ids = {l["id"] for l in client.get("/languages", headers=AUTH).json()}
    assert 71 in ids and 45 not in ids
    assert len(client.get("/statuses", headers=AUTH).json()) == 14
