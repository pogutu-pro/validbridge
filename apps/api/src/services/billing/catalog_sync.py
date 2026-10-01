"""
Publish the built-in price catalogue when the code ships a newer version.

``get_active_catalog`` prices everything from the newest ``price_catalog`` row,
so a new ``CATALOG_VERSION`` in ``catalog_defaults`` has no effect until a row
for it exists. Startup inserts that row once; older rows stay untouched so
invoices keep pointing at the version they were priced with.
"""

from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing import PriceCatalog
from src.services.billing.catalog_defaults import CATALOG_VERSION, build_default_catalog

logger = logging.getLogger(__name__)


async def publish_builtin_catalog(db: AsyncSession) -> int | None:
    """Insert the built-in catalogue if it is newer than every stored version.

    Returns the version inserted, or None when nothing changed. Safe to run
    from several workers at once: the unique version column lets one win.
    """
    latest = (await db.execute(select(func.max(PriceCatalog.version)))).scalar()
    if latest is not None and int(latest) >= CATALOG_VERSION:
        return None
    db.add(PriceCatalog(version=CATALOG_VERSION, items=build_default_catalog()))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        return None
    logger.info("Published built-in price catalogue v%s (was v%s)", CATALOG_VERSION, latest)
    return CATALOG_VERSION
