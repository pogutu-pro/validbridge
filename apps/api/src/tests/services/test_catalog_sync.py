"""The built-in price catalogue is stored once when the code ships a newer version."""

from src.db.billing import PriceCatalog
from src.services.billing.catalog_defaults import CATALOG_VERSION, build_default_catalog
from src.services.billing.catalog_sync import publish_builtin_catalog


async def test_publishes_when_database_is_older(db):
    db.add(PriceCatalog(version=1, items=build_default_catalog()))
    await db.commit()
    assert await publish_builtin_catalog(db) == CATALOG_VERSION
    # Second run is a no-op.
    assert await publish_builtin_catalog(db) is None


async def test_leaves_a_newer_superadmin_version_alone(db):
    db.add(PriceCatalog(version=CATALOG_VERSION + 1, items=build_default_catalog()))
    await db.commit()
    assert await publish_builtin_catalog(db) is None
