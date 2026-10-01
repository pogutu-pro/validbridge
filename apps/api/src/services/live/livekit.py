"""Minimal LiveKit server integration: access tokens, webhook verification and
the RoomService calls ValidBridge needs.

No LiveKit SDK: tokens are HS256 JWTs (``pyjwt``) and the server API is Twirp,
i.e. JSON over HTTP (``httpx``). That keeps the dependency surface to what the
API already ships and avoids the SDK's protobuf pin.
"""

import base64
import hashlib
import json
import logging
import time
from typing import Optional

import httpx
import jwt
from jwt.exceptions import PyJWTError

from src.services.live.config import LiveKitSettings
from src.services.live.telemetry import log_event

logger = logging.getLogger(__name__)

_ROOM_SERVICE = "twirp/livekit.RoomService"
_SERVER_TOKEN_TTL_SECONDS = 60
_HTTP_TIMEOUT_SECONDS = 10.0


class LiveKitError(Exception):
    """LiveKit could not be reached or rejected the call."""


class WebhookVerificationError(Exception):
    pass


def create_participant_token(
    settings: LiveKitSettings,
    *,
    identity: str,
    name: str,
    room: str,
    metadata: dict,
    ttl_seconds: int,
    can_publish_sources: list[str],
    can_publish_data: bool,
) -> tuple[str, int]:
    """Mint a join token scoped to one room. Returns (token, exp)."""
    now = int(time.time())
    exp = now + ttl_seconds
    claims = {
        "iss": settings.api_key,
        "sub": identity,
        "nbf": now - 5,
        "exp": exp,
        "name": name,
        # Server-signed and not client-editable (canUpdateOwnMetadata=false),
        # so webhooks can trust the role carried here.
        "metadata": json.dumps(metadata, separators=(",", ":")),
        "video": {
            "room": room,
            "roomJoin": True,
            "canSubscribe": True,
            "canPublish": bool(can_publish_sources),
            "canPublishSources": can_publish_sources,
            "canPublishData": can_publish_data,
            "canUpdateOwnMetadata": False,
        },
    }
    return jwt.encode(claims, settings.api_secret, algorithm="HS256"), exp


def _server_token(settings: LiveKitSettings, room: Optional[str] = None) -> str:
    now = int(time.time())
    video: dict = {"roomCreate": True, "roomList": True, "roomAdmin": True}
    if room:
        video["room"] = room
    claims = {
        "iss": settings.api_key,
        "nbf": now - 5,
        "exp": now + _SERVER_TOKEN_TTL_SECONDS,
        "video": video,
    }
    return jwt.encode(claims, settings.api_secret, algorithm="HS256")


def verify_webhook(settings: LiveKitSettings, body: bytes, auth_header: Optional[str]) -> dict:
    """Verify a LiveKit webhook and return its decoded JSON payload.

    LiveKit signs each delivery with a JWT (our API secret, issuer = our API
    key) whose ``sha256`` claim is the base64 SHA-256 of the raw body.
    """
    if not auth_header:
        raise WebhookVerificationError("missing authorization")
    token = auth_header.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    try:
        claims = jwt.decode(
            token,
            settings.api_secret,
            algorithms=["HS256"],
            issuer=settings.api_key,
            leeway=60,
            options={"verify_aud": False, "require": ["iss", "sha256"]},
        )
    except PyJWTError as exc:
        raise WebhookVerificationError(f"invalid signature: {exc}") from exc

    expected = base64.b64encode(hashlib.sha256(body).digest()).decode()
    if claims.get("sha256") != expected:
        raise WebhookVerificationError("body hash mismatch")
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise WebhookVerificationError("body is not JSON") from exc
    if not isinstance(payload, dict):
        raise WebhookVerificationError("body is not an object")
    return payload


def _twirp_code(resp: httpx.Response) -> Optional[str]:
    # A plain 404 (wrong LIVEKIT_API_URL, proxy page) carries no Twirp code and
    # must surface as an error, not as "room does not exist".
    try:
        body = resp.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None


def _log_failure(service: str, method: str, room: Optional[str], **fields) -> None:
    log_event("livekit.call_failed", logging.WARNING, service=service, method=method, room=room, **fields)


async def _call(settings: LiveKitSettings, method: str, body: dict, room: Optional[str] = None) -> Optional[dict]:
    """POST a Twirp RoomService method. Returns None on Twirp ``not_found``."""
    url = f"{settings.api_url}/{_ROOM_SERVICE}/{method}"
    headers = {
        "Authorization": f"Bearer {_server_token(settings, room)}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        _log_failure("room", method, room, error=type(exc).__name__)
        raise LiveKitError(f"LiveKit {method} unreachable: {exc}") from exc

    if resp.status_code == 404 and _twirp_code(resp) == "not_found":
        return None
    if resp.status_code >= 400:
        _log_failure("room", method, room, http_status=resp.status_code, twirp_code=_twirp_code(resp))
        raise LiveKitError(f"LiveKit {method} failed ({resp.status_code}): {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError:
        return {}


async def create_room(
    settings: LiveKitSettings,
    name: str,
    *,
    empty_timeout: int,
    max_participants: int,
    metadata: dict,
) -> None:
    """Create (or, idempotently, fetch) a room."""
    await _call(
        settings,
        "CreateRoom",
        {
            "name": name,
            "empty_timeout": empty_timeout,
            "max_participants": max_participants,
            "metadata": json.dumps(metadata, separators=(",", ":")),
        },
        room=name,
    )


async def delete_room(settings: LiveKitSettings, name: str) -> None:
    """Delete a room, disconnecting everyone. A missing room is not an error."""
    await _call(settings, "DeleteRoom", {"room": name}, room=name)


async def room_exists(settings: LiveKitSettings, name: str) -> bool:
    result = await _call(settings, "ListRooms", {"names": [name]}, room=name)
    rooms = (result or {}).get("rooms") or []
    return any(isinstance(r, dict) and r.get("name") == name for r in rooms)


async def list_participants(settings: LiveKitSettings, name: str) -> Optional[list[dict]]:
    """Participants currently in the room.

    LiveKit answers an empty list (not ``not_found``) for a room that does not
    exist, so use ``room_exists`` to tell the two apart. None is returned only
    for a Twirp ``not_found``.
    """
    result = await _call(settings, "ListParticipants", {"room": name}, room=name)
    if result is None:
        return None
    participants = result.get("participants") or []
    return [p for p in participants if isinstance(p, dict)]


# Track sources as LiveKit's TrackSource enum (names; Twirp may emit numbers).
_SOURCE_NAMES = {
    "camera": "CAMERA",
    "microphone": "MICROPHONE",
    "screen_share": "SCREEN_SHARE",
    "screen_share_audio": "SCREEN_SHARE_AUDIO",
}
_SOURCE_NUMBERS = {1: "CAMERA", 2: "MICROPHONE", 3: "SCREEN_SHARE", 4: "SCREEN_SHARE_AUDIO"}


def _source_name(value) -> Optional[str]:
    if isinstance(value, int):
        return _SOURCE_NUMBERS.get(value)
    return str(value).upper() if value else None


def participant_permission(can_publish_sources: list[str], can_publish_data: bool) -> dict:
    """A full ParticipantPermission. UpdateParticipant replaces the whole
    object, so every field is always sent."""
    return {
        "can_subscribe": True,
        "can_publish": bool(can_publish_sources),
        "can_publish_data": can_publish_data,
        "can_publish_sources": [_SOURCE_NAMES[s] for s in can_publish_sources],
        "can_update_metadata": False,
    }


async def update_participant(
    settings: LiveKitSettings,
    room: str,
    identity: str,
    *,
    permission: Optional[dict] = None,
    attributes: Optional[dict[str, str]] = None,
) -> bool:
    """Returns False when the participant is not connected."""
    body: dict = {"room": room, "identity": identity}
    if permission is not None:
        body["permission"] = permission
    if attributes is not None:
        body["attributes"] = attributes
    return await _call(settings, "UpdateParticipant", body, room=room) is not None


async def mute_published_tracks(
    settings: LiveKitSettings, room: str, identity: str, source: str
) -> int:
    """Server-mute every track the participant publishes from ``source``
    (the participant may unmute unless their permission is revoked).
    Returns how many tracks were muted."""
    info = await _call(settings, "GetParticipant", {"room": room, "identity": identity}, room=room)
    if not info:
        return 0
    wanted = _SOURCE_NAMES[source]
    muted = 0
    for track in info.get("tracks") or []:
        if _source_name(track.get("source")) == wanted and track.get("sid"):
            await _call(
                settings,
                "MutePublishedTrack",
                {"room": room, "identity": identity, "track_sid": track["sid"], "muted": True},
                room=room,
            )
            muted += 1
    return muted


async def remove_participant(settings: LiveKitSettings, room: str, identity: str) -> None:
    await _call(settings, "RemoveParticipant", {"room": room, "identity": identity}, room=room)


async def send_data(
    settings: LiveKitSettings,
    room: str,
    topic: str,
    payload: dict,
    destination_identities: Optional[list[str]] = None,
) -> None:
    """Broadcast a reliable data message from the server to the room."""
    body = {
        "room": room,
        "data": base64.b64encode(json.dumps(payload, separators=(",", ":"), default=str).encode()).decode(),
        "kind": "RELIABLE",
        "topic": topic,
    }
    if destination_identities:
        body["destination_identities"] = destination_identities
    await _call(settings, "SendData", body, room=room)


async def update_room_metadata(settings: LiveKitSettings, room: str, metadata: dict) -> bool:
    """Replace the room's metadata (visible to every participant, incl. late joiners)."""
    result = await _call(
        settings,
        "UpdateRoomMetadata",
        {"room": room, "metadata": json.dumps(metadata, separators=(",", ":"))},
        room=room,
    )
    return result is not None


# -- Egress (recording) ------------------------------------------------------------

_EGRESS_SERVICE = "twirp/livekit.Egress"


def _server_token_for_egress(settings: LiveKitSettings, room: Optional[str]) -> str:
    now = int(time.time())
    video: dict = {"roomRecord": True}
    if room:
        video["room"] = room
    return jwt.encode(
        {"iss": settings.api_key, "nbf": now - 5, "exp": now + _SERVER_TOKEN_TTL_SECONDS, "video": video},
        settings.api_secret,
        algorithm="HS256",
    )


async def _egress_call(settings: LiveKitSettings, method: str, body: dict, room: Optional[str] = None) -> dict:
    url = f"{settings.api_url}/{_EGRESS_SERVICE}/{method}"
    headers = {
        "Authorization": f"Bearer {_server_token_for_egress(settings, room)}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as exc:
        _log_failure("egress", method, room, error=type(exc).__name__)
        raise LiveKitError(f"LiveKit egress {method} unreachable: {exc}") from exc
    if resp.status_code >= 400:
        # The request body holds storage credentials: log only the outcome.
        _log_failure("egress", method, room, http_status=resp.status_code, twirp_code=_twirp_code(resp))
        raise LiveKitError(f"LiveKit egress {method} failed ({resp.status_code}): {resp.text[:200]}")
    try:
        return resp.json()
    except ValueError:
        return {}


async def start_room_recording(
    settings: LiveKitSettings,
    room: str,
    *,
    filepath: str,
    s3: dict,
    layout: str,
) -> str:
    """Record the whole room (composited) to one MP4 in object storage.

    Returns the egress id. ``s3`` is LiveKit's S3Upload
    (``bucket``/``endpoint``/``region``/``access_key``/``secret``/``force_path_style``).
    """
    result = await _egress_call(
        settings,
        "StartRoomCompositeEgress",
        {
            "room_name": room,
            "layout": layout,
            "file_outputs": [{"file_type": "MP4", "filepath": filepath, "s3": s3}],
        },
        room=room,
    )
    egress_id = result.get("egress_id") or result.get("egressId")
    if not egress_id:
        raise LiveKitError("LiveKit egress returned no egress id")
    return str(egress_id)


async def stop_egress(settings: LiveKitSettings, egress_id: str) -> None:
    await _egress_call(settings, "StopEgress", {"egress_id": egress_id})
