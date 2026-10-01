"""
Storage metering and enforcement (pricing-implementation.md W4b).

Two sources of truth, fast and exact:

* **Fast path** — a Redis counter ``storage_used:{org_id}``, reset to the
  nightly scan and incremented on every org upload. Checked before an upload.
* **Truth** — ``run_storage_scan`` sums every file under the org's content
  prefix (filesystem walk, or S3/R2 ``list_objects_v2``) once a day into a
  ``StorageSnapshot`` and resets the counter to it. When Redis has no counter
  the check falls back to the latest snapshot.

Metering never blocks an upload by failing: a Redis or database error is
logged and the upload goes ahead. Only a real ``blocked`` decision (the org is
over its allowance and storage is in ``enforce`` mode) refuses it, with the
§4.4 402 ``storage_quota_exceeded``. Nothing is ever deleted here.
"""

from __future__ import annotations

import asyncio
import logging
import os

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

logger = logging.getLogger(__name__)

_COUNTER_KEY = "storage_used:{org_id}"
_CONTENT_ROOT = "content"


def _redis():
    try:
        from src.core.redis import get_redis_client

        return get_redis_client()
    except Exception:
        return None


def _counter_value(org_id: int) -> int | None:
    client = _redis()
    if client is None:
        return None
    try:
        raw = client.get(_COUNTER_KEY.format(org_id=org_id))
        return None if raw is None else int(raw)
    except Exception:
        logger.debug("storage counter read failed", exc_info=True)
        return None


def _saas() -> bool:
    from src.core.deployment_mode import get_deployment_mode

    return get_deployment_mode() == "saas"


async def _org_id_for_uuid(org_uuid: str, db: AsyncSession) -> int | None:
    from src.db.organizations import Organization

    return (
        await db.execute(select(Organization.id).where(Organization.org_uuid == org_uuid))
    ).scalars().first()


async def check_upload(
    org_uuid: str, size_bytes: int, db: AsyncSession | None = None
) -> int | None:
    """Refuse an upload that would pass the org's storage allowance.

    Returns the org id (for ``note_upload``) or None when the upload isn't
    metered. Raises the 402 only for a real ``blocked`` decision.
    """
    if not _saas() or size_bytes <= 0:
        return None
    try:
        if db is None:
            from src.core.events.database import _async_session_factory

            async with _async_session_factory() as session:
                return await _check(org_uuid, size_bytes, session)
        return await _check(org_uuid, size_bytes, db)
    except HTTPException:
        raise
    except Exception:
        logger.warning("Storage check failed for org %s; allowing upload", org_uuid, exc_info=True)
        return None


async def _check(org_uuid: str, size_bytes: int, db: AsyncSession) -> int | None:
    from src.security.features_utils.entitlements import METRIC_STORAGE, check

    org_id = await _org_id_for_uuid(org_uuid, db)
    if org_id is None:
        return None
    used = _counter_value(org_id)
    if used is None:
        used = await _latest_snapshot(org_id, db)
        _seed_counter(org_id, used)
    decision = await check(org_id, METRIC_STORAGE, size_bytes, db, used=used)
    decision.raise_if_blocked()
    return int(org_id)


async def _latest_snapshot(org_id: int, db: AsyncSession) -> int:
    from src.db.billing import StorageSnapshot

    row = (
        await db.execute(
            select(StorageSnapshot.bytes)
            .where(StorageSnapshot.org_id == org_id)
            .order_by(StorageSnapshot.measured_at.desc())
            .limit(1)
        )
    ).scalars().first()
    return int(row or 0)


def _seed_counter(org_id: int, value: int) -> None:
    """Start the fast counter from the last scan so uploads count at once."""
    client = _redis()
    if client is None:
        return
    try:
        client.set(_COUNTER_KEY.format(org_id=org_id), int(value), nx=True)
    except Exception:
        logger.debug("storage counter seed failed", exc_info=True)


def note_upload(org_id: int | None, size_bytes: int) -> None:
    """Add a completed upload to the fast counter (best effort)."""
    if org_id is None or size_bytes <= 0:
        return
    client = _redis()
    if client is None:
        return
    try:
        key = _COUNTER_KEY.format(org_id=org_id)
        # Only count on top of a baseline (seeded by check_upload or the scan);
        # a bare counter would under-report usage.
        if client.exists(key):
            client.incrby(key, int(size_bytes))
    except Exception:
        logger.debug("storage counter increment failed", exc_info=True)


# ── Nightly scan ─────────────────────────────────────────────────────────────

def _filesystem_bytes(org_uuid: str) -> int:
    root = os.path.join(_CONTENT_ROOT, "orgs", org_uuid)
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                continue
    return total


def _s3_bytes(org_uuid: str) -> int:
    import boto3
    import botocore.config

    from config.config import get_validbridge_config

    cfg = get_validbridge_config().hosting_config.content_delivery.s3api
    s3 = boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        config=botocore.config.Config(connect_timeout=10, read_timeout=60, retries={"max_attempts": 2}),
    )
    bucket = cfg.bucket_name or "validbridge-media"
    total = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"content/orgs/{org_uuid}/"):
        for obj in page.get("Contents") or []:
            total += int(obj.get("Size") or 0)
    return total


def measure_org_bytes(org_uuid: str) -> int:
    """Bytes stored under the org's content prefix (uploads, HLS output,
    recordings — everything the org keeps)."""
    from config.config import get_validbridge_config

    backend = get_validbridge_config().hosting_config.content_delivery.type
    if backend == "s3api":
        return _s3_bytes(org_uuid)
    return _filesystem_bytes(org_uuid)


async def run_storage_scan(db: AsyncSession) -> dict:
    """Snapshot every org's storage and reset its fast counter. Daily."""
    from src.db.billing import StorageSnapshot
    from src.db.organizations import Organization

    orgs = (await db.execute(select(Organization.id, Organization.org_uuid))).all()
    scanned = failed = 0
    client = _redis()
    for org_id, org_uuid in orgs:
        if not org_uuid:
            continue
        try:
            used = await asyncio.to_thread(measure_org_bytes, org_uuid)
        except Exception:
            failed += 1
            logger.warning("Storage scan failed for org %s", org_id, exc_info=True)
            continue
        db.add(StorageSnapshot(org_id=int(org_id), bytes=int(used), source="scan"))
        await db.commit()
        if client is not None:
            try:
                client.set(_COUNTER_KEY.format(org_id=org_id), int(used))
            except Exception:
                logger.debug("storage counter reset failed", exc_info=True)
        scanned += 1
    return {"scanned": scanned, "failed": failed}
