"""The v1 price catalogue matches pricechange.md §3–4 and is integer cents."""

import json

from src.security.features_utils.plans import PLAN_HIERARCHY
from src.services.billing.catalog_defaults import GB, HOUR, build_default_catalog


def _walk_numbers(value):
    if isinstance(value, dict):
        for v in value.values():
            yield from _walk_numbers(v)
    elif isinstance(value, list):
        for v in value:
            yield from _walk_numbers(v)
    elif isinstance(value, (int, float)) and not isinstance(value, bool):
        yield value


def test_json_serialisable_and_no_floats():
    cat = build_default_catalog()
    json.dumps(cat)
    assert all(isinstance(n, int) for n in _walk_numbers(cat))


def test_plans_match_plan_ids():
    cat = build_default_catalog()
    assert list(cat["plans"]) == PLAN_HIERARCHY
    assert cat["plan_order"] == PLAN_HIERARCHY
    assert cat["default_plan"] == "starter"


def test_plan_numbers():
    p = build_default_catalog()["plans"]
    assert p["public-education"]["price_cents"] == 0
    assert p["starter"]["price_cents"] == 0
    assert p["growth"]["price_cents"] == 350_000
    assert p["business"]["price_cents"] == 950_000
    assert p["enterprise"]["price_cents"] == 1_754_700

    assert [p[k]["included_seats"] for k in PLAN_HIERARCHY] == [None, 1, 3, 10, 25]
    assert p["growth"]["extra_seat_price_cents"] == 50_000
    assert p["business"]["extra_seat_price_cents"] == 40_000
    assert p["starter"]["learner_allowance"] == 50
    assert all(p[k]["learners_per_seat"] == 200 for k in PLAN_HIERARCHY)

    assert [p[k]["storage_bytes"] for k in PLAN_HIERARCHY] == [2 * GB, 1 * GB, 10 * GB, 50 * GB, 250 * GB]
    assert [p[k]["live_seconds"] for k in PLAN_HIERARCHY] == [10 * HOUR, 2 * HOUR, 30 * HOUR, 100 * HOUR, 300 * HOUR]
    assert [p[k]["live_concurrency"] for k in PLAN_HIERARCHY] == [2, 1, 3, 10, 10]
    assert [p[k]["premium_ai_credits"] for k in PLAN_HIERARCHY] == [0, 0, 300, 1500, 5000]
    assert [p[k]["code_runs"] for k in PLAN_HIERARCHY] == [2000, 200, 5000, 20000, 50000]

    # SSO is an add-on, included in no plan.
    assert [p[k]["features"]["sso"] for k in PLAN_HIERARCHY] == [False, False, False, False, False]
    assert [p[k]["features"]["api"] for k in PLAN_HIERARCHY] == [False, False, True, True, True]
    assert [p[k]["features"]["custom_domain"] for k in PLAN_HIERARCHY] == [False, False, True, True, True]
    assert [p[k]["badge"] for k in PLAN_HIERARCHY] == ["required", "required", "addon", "removed", "removed"]
    assert [p[k]["support"] for k in PLAN_HIERARCHY] == ["community", "community", "standard", "priority", "dedicated"]


def test_packs_addons_and_extras():
    cat = build_default_catalog()
    packs = cat["packs"]
    assert [(x["quantity"], x["price_cents"]) for x in packs["ai_credits"]] == [
        (100, 15_000), (500, 65_000), (1000, 120_000)]
    assert [(x["quantity"], x["price_cents"]) for x in packs["live_seconds"]] == [
        (10 * HOUR, 30_000), (50 * HOUR, 120_000), (100 * HOUR, 200_000)]
    assert [(x["quantity"], x["price_cents"]) for x in packs["code_runs"]] == [(5000, 20_000)]

    addons = cat["addons"]
    assert addons["live_unlimited"]["price_cents"] == 35_000
    assert addons["managed_email"]["price_cents"] == 90_000
    assert addons["managed_email"]["included_emails"] == 5000
    assert addons["managed_email"]["extra_block_price_cents"] == 30_000
    assert addons["remove_badge"]["price_cents"] == 50_000
    assert addons["extra_seat"]["price_cents_by_plan"] == {"growth": 50_000, "business": 40_000, "enterprise": 35_000}

    assert cat["storage_overage"]["price_cents_per_gb_month"] == 1_500
    assert cat["yearly_discount_percent"] == 15


def test_returns_independent_copies():
    a = build_default_catalog()
    a["plans"]["growth"]["price_cents"] = 1
    assert build_default_catalog()["plans"]["growth"]["price_cents"] == 350_000
