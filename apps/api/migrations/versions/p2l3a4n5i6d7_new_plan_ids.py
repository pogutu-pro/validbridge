"""Switch stored plan IDs to the 2026-09 plans; demo org → business, exempt

Plan values in org configs (v1 ``config.cloud.plan`` and v2 ``config.plan``)
and in ``organization_plan_history``:

    free | personal | personal-family → starter
    standard                          → growth
    pro                               → business
    enterprise                        → enterprise (unchanged)

The demo org is set to ``business`` and gets a ``billing_account`` row with
``exempt = true`` (never billed or limited).

Downgrade maps back (starter/public-education → free, growth → standard,
business → pro) and removes the demo's billing_account row. personal and
personal-family cannot be told apart from free after the upgrade; there are no
customers on them.

Revision ID: p2l3a4n5i6d7
Revises: p1r2i3c4i5n6
Create Date: 2026-09-25 09:30:00.000000

"""
import json
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'p2l3a4n5i6d7'
down_revision: str | None = 'p1r2i3c4i5n6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


UPGRADE_MAP = {
    "free": "starter",
    "personal": "starter",
    "personal-family": "starter",
    "standard": "growth",
    "pro": "business",
}

DOWNGRADE_MAP = {
    "starter": "free",
    "public-education": "free",
    "growth": "standard",
    "business": "pro",
}


def _map_config(config: dict, mapping: dict, force_plan: str | None = None) -> bool:
    """Rewrite plan values in place. Returns True when anything changed."""
    changed = False
    version = str(config.get("config_version", "1.0"))
    if version.startswith("2"):
        current = config.get("plan")
        new = force_plan or mapping.get(current, current)
        if new is not None and new != current:
            config["plan"] = new
            changed = True
    cloud = config.get("cloud")
    if isinstance(cloud, dict) and "plan" in cloud:
        current = cloud.get("plan")
        new = force_plan or mapping.get(current, current)
        if new != current:
            cloud["plan"] = new
            changed = True
    return changed


def _rewrite(mapping: dict, demo_plan: str) -> None:
    bind = op.get_bind()
    demo_ids = {
        int(r[0])
        for r in bind.execute(sa.text("SELECT id FROM organization WHERE is_demo IS TRUE"))
    }
    rows = bind.execute(sa.text("SELECT id, org_id, config FROM organizationconfig")).fetchall()
    for row_id, org_id, raw in rows:
        if raw is None:
            continue
        config = json.loads(raw) if isinstance(raw, str) else dict(raw)
        force = demo_plan if org_id is not None and int(org_id) in demo_ids else None
        if _map_config(config, mapping, force):
            bind.execute(
                sa.text("UPDATE organizationconfig SET config = CAST(:config AS JSON) WHERE id = :id"),
                {"config": json.dumps(config), "id": row_id},
            )

    for old, new in mapping.items():
        bind.execute(
            sa.text("UPDATE organization_plan_history SET plan = :new WHERE plan = :old"),
            {"new": new, "old": old},
        )
    return demo_ids


def upgrade() -> None:
    demo_ids = _rewrite(UPGRADE_MAP, "business")
    bind = op.get_bind()
    now = datetime.now(UTC)
    for org_id in demo_ids:
        bind.execute(
            sa.text(
                "INSERT INTO billing_account (org_id, status, cycle, auto_add_seats, exempt, "
                "enforcement_overrides, created_at, updated_at) "
                "VALUES (:org_id, 'active', 'monthly', false, true, '{}'::jsonb, :now, :now) "
                "ON CONFLICT (org_id) DO UPDATE SET exempt = true, updated_at = :now"
            ),
            {"org_id": org_id, "now": now},
        )


def downgrade() -> None:
    demo_ids = _rewrite(DOWNGRADE_MAP, "pro")
    bind = op.get_bind()
    for org_id in demo_ids:
        bind.execute(
            sa.text("DELETE FROM billing_account WHERE org_id = :org_id"),
            {"org_id": org_id},
        )
