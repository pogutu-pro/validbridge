"""LiveKit client: Twirp calls, error mapping and config."""

import json

import httpx
import jwt
import pytest

from src.services.live import livekit
from src.services.live.config import LiveKitSettings, get_livekit_settings

SETTINGS = LiveKitSettings(
    url="wss://live.example.test",
    api_key="APIkey",
    api_secret="secret-secret-secret-secret-secret-12",
    api_url="https://live.example.test",
)


@pytest.fixture
def transport(monkeypatch):
    calls = []
    responses = {}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return responses.get(request.url.path, httpx.Response(200, json={}))

    real = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real(*args, **kwargs)

    monkeypatch.setattr(livekit.httpx, "AsyncClient", factory)
    return {"calls": calls, "responses": responses}


async def test_list_participants_parses_and_scopes_token(transport):
    path = "/twirp/livekit.RoomService/ListParticipants"
    transport["responses"][path] = httpx.Response(
        200, json={"participants": [{"sid": "PA", "identity": "user_1"}]}
    )
    result = await livekit.list_participants(SETTINGS, "vb-live-abc")
    assert result == [{"sid": "PA", "identity": "user_1"}]

    request = transport["calls"][0]
    assert json.loads(request.content) == {"room": "vb-live-abc"}
    token = request.headers["Authorization"].removeprefix("Bearer ")
    claims = jwt.decode(token, SETTINGS.api_secret, algorithms=["HS256"])
    assert claims["iss"] == "APIkey"
    assert claims["video"]["room"] == "vb-live-abc"
    assert claims["exp"] - claims["nbf"] <= 70


async def test_twirp_not_found_means_missing_room(transport):
    transport["responses"]["/twirp/livekit.RoomService/ListParticipants"] = httpx.Response(
        404, json={"code": "not_found", "msg": "room not found"}
    )
    assert await livekit.list_participants(SETTINGS, "vb-live-abc") is None


async def test_plain_404_is_an_error(transport):
    # e.g. a wrong LIVEKIT_API_URL hitting a proxy — must not read as "room gone".
    transport["responses"]["/twirp/livekit.RoomService/ListParticipants"] = httpx.Response(
        404, text="<html>Not Found</html>"
    )
    with pytest.raises(livekit.LiveKitError):
        await livekit.list_participants(SETTINGS, "vb-live-abc")


async def test_server_error_raises(transport):
    transport["responses"]["/twirp/livekit.RoomService/CreateRoom"] = httpx.Response(500, text="boom")
    with pytest.raises(livekit.LiveKitError):
        await livekit.create_room(SETTINGS, "vb-live-abc", empty_timeout=600, max_participants=0, metadata={})


def test_settings_require_all_credentials(monkeypatch):
    monkeypatch.setenv("LIVEKIT_URL", "wss://live.example.test")
    monkeypatch.setenv("LIVEKIT_API_KEY", "k")
    monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)
    assert get_livekit_settings() is None

    monkeypatch.setenv("LIVEKIT_API_SECRET", "s")
    settings = get_livekit_settings()
    assert settings.api_url == "https://live.example.test"

    monkeypatch.setenv("LIVEKIT_API_URL", "http://livekit:7880/")
    assert get_livekit_settings().api_url == "http://livekit:7880"


async def test_room_exists(transport):
    path = "/twirp/livekit.RoomService/ListRooms"
    transport["responses"][path] = httpx.Response(200, json={"rooms": []})
    assert await livekit.room_exists(SETTINGS, "vb-live-abc") is False
    transport["responses"][path] = httpx.Response(200, json={"rooms": [{"name": "vb-live-abc"}]})
    assert await livekit.room_exists(SETTINGS, "vb-live-abc") is True
    assert json.loads(transport["calls"][-1].content) == {"names": ["vb-live-abc"]}
