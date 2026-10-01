"""Plan-ID data migration (p2l3a4n5i6d7): mapping is complete and reversible.

Full up/down runs against Postgres were verified manually; these tests pin the
pure mapping so it cannot drift from plans.LEGACY_PLAN_ALIASES.
"""

import importlib.util
from pathlib import Path

from src.security.features_utils.plans import LEGACY_PLAN_ALIASES

_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "migrations" / "versions" / "p2l3a4n5i6d7_new_plan_ids.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("plan_id_migration", _MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_revision_chain():
    mod = _load()
    assert mod.revision == "p2l3a4n5i6d7"
    assert mod.down_revision == "p1r2i3c4i5n6"


def test_upgrade_map_matches_read_time_aliases():
    assert _load().UPGRADE_MAP == LEGACY_PLAN_ALIASES


def test_v2_and_v1_configs_are_rewritten():
    mod = _load()
    v2 = {"config_version": "2.0", "plan": "standard"}
    assert mod._map_config(v2, mod.UPGRADE_MAP) is True
    assert v2["plan"] == "growth"

    v1 = {"config_version": "1.4", "cloud": {"plan": "pro", "custom_domain": True}}
    assert mod._map_config(v1, mod.UPGRADE_MAP) is True
    assert v1["cloud"]["plan"] == "business"

    ent = {"config_version": "2.0", "plan": "enterprise"}
    assert mod._map_config(ent, mod.UPGRADE_MAP) is False


def test_demo_is_forced_to_business():
    mod = _load()
    cfg = {"config_version": "2.0", "plan": "free"}
    mod._map_config(cfg, mod.UPGRADE_MAP, force_plan="business")
    assert cfg["plan"] == "business"


def test_round_trip():
    mod = _load()
    for old in ("free", "standard", "pro", "enterprise"):
        cfg = {"config_version": "2.0", "plan": old}
        mod._map_config(cfg, mod.UPGRADE_MAP)
        mod._map_config(cfg, mod.DOWNGRADE_MAP)
        assert cfg["plan"] == old
