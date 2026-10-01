"""
Pricing: turn a requested item into an exact amount (integer KES cents).

The client says *what* it wants; every amount is computed here from the price
catalogue (pricing-implementation.md §2.2). Pure functions, no I/O.

Billing periods
---------------
Monthly bills are issued on the 1st, so anything bought mid-month (a plan
upgrade, an add-on) is charged pro rata up to the next 1st, and the monthly
invoice charges full months from then on. Yearly plans are paid twelve months
up front at the yearly discount, which also covers extra instructor seats.
Proration rounds down, in the school's favour.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

MONTHLY = "monthly"
YEARLY = "yearly"

# A monthly plan bought this close to the 1st also pays for the next month,
# so a school is not asked to pay a few shillings now and the full price
# again hours or days later.
SHORT_REMAINDER = timedelta(days=7)
CYCLES = (MONTHLY, YEARLY)

MIN_TOPUP_CENTS = 50 * 100
MAX_TOPUP_CENTS = 1_000_000 * 100
MAX_QUANTITY = 1000

PLAN_RANK = {"starter": 0, "public-education": 0, "growth": 1, "business": 2, "enterprise": 3}


class PricingError(ValueError):
    """The item cannot be bought (unknown, not offered on this plan, …)."""


@dataclass(frozen=True)
class PlanState:
    """What the org holds now; input to every quote."""

    plan: str
    cycle: str = MONTHLY
    period_start: datetime | None = None
    period_end: datetime | None = None


@dataclass(frozen=True)
class Quote:
    item: dict[str, Any]          # normalised item, stored with the purchase
    amount_cents: int
    description: str
    covers_until: datetime | None = None
    period_start: datetime | None = None
    counts_toward_spending_limit: bool = False
    # What the amount pays for, shown to the payer before they pay: each part
    # with its own period, then the next recurring charge. Parts sum to
    # amount_cents.
    lines: list[dict[str, Any]] = field(default_factory=list)
    next_charge_at: datetime | None = None
    next_charge_cents: int | None = None
    # Plain-language explanation shown above the breakdown, when needed.
    note: str | None = None


def part(label: str, amount_cents: int, start: datetime | None = None,
         end: datetime | None = None) -> dict[str, Any]:
    """One line of a quote breakdown. ``end`` is exclusive (the 1st 00:00 UTC
    that the period runs up to)."""
    return {
        "label": label,
        "amount_cents": int(amount_cents),
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
    }


# ── Time ──────────────────────────────────────────────────────────────────────

def aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def next_month_start(now: datetime) -> datetime:
    if now.month == 12:
        return datetime(now.year + 1, 1, 1, tzinfo=UTC)
    return datetime(now.year, now.month + 1, 1, tzinfo=UTC)


def add_years(dt: datetime, years: int = 1) -> datetime:
    try:
        return dt.replace(year=dt.year + years)
    except ValueError:  # 29 February
        return dt.replace(year=dt.year + years, day=28)


def prorate(amount_cents: int, start: datetime, end: datetime, now: datetime) -> int:
    """Share of ``amount_cents`` for the part of [start, end) still ahead of now."""
    total = (end - start).total_seconds()
    left = (end - max(now, start)).total_seconds()
    if total <= 0 or left <= 0:
        return 0
    if left >= total:
        return int(amount_cents)
    return int(amount_cents) * int(left) // int(total)


def month_remainder(amount_cents: int, now: datetime) -> int:
    """Pro-rata of a monthly price from now to the next 1st."""
    return prorate(amount_cents, month_start(now), next_month_start(now), now)


# ── Catalogue lookups ─────────────────────────────────────────────────────────

def plan_config(catalog: dict, plan: str) -> dict:
    cfg = (catalog.get("plans") or {}).get(plan)
    if not cfg:
        raise PricingError(f"Unknown plan '{plan}'")
    return cfg


def cycle_price(catalog: dict, plan: str, cycle: str) -> int:
    """Price of one full cycle of ``plan`` (0 for free plans)."""
    monthly = plan_config(catalog, plan).get("price_cents")
    if monthly is None:
        raise PricingError("This plan is priced by quote; contact sales.")
    if cycle == YEARLY:
        discount = int(catalog.get("yearly_discount_percent") or 0)
        return int(monthly) * 12 * (100 - discount) // 100
    return int(monthly)


def extra_seat_price(catalog: dict, plan: str) -> int | None:
    seat = (catalog.get("addons") or {}).get("extra_seat") or {}
    price = (seat.get("price_cents_by_plan") or {}).get(plan)
    return None if price is None else int(price)


def find_pack(catalog: dict, pack_id: str) -> tuple[str, dict]:
    for kind, packs in (catalog.get("packs") or {}).items():
        for pack in packs:
            if pack.get("id") == pack_id:
                return kind, pack
    raise PricingError(f"Unknown pack '{pack_id}'")


def is_upgrade(catalog: dict, state: PlanState, plan: str, cycle: str) -> bool:
    """A change that costs more now: a higher plan, or monthly → yearly."""
    cur_rank = PLAN_RANK.get(state.plan, 0)
    new_rank = PLAN_RANK.get(plan, 0)
    if new_rank != cur_rank:
        return new_rank > cur_rank
    return plan == state.plan and state.cycle == MONTHLY and cycle == YEARLY


def _paid_period_active(catalog: dict, state: PlanState, now: datetime) -> bool:
    end = aware(state.period_end)
    return (
        end is not None
        and end > now
        and aware(state.period_start) is not None
        and (plan_config(catalog, state.plan).get("price_cents") or 0) > 0
    )


# ── Quotes ────────────────────────────────────────────────────────────────────

def _quantity(item: dict) -> int:
    try:
        qty = int(item.get("quantity", 1))
    except (TypeError, ValueError):
        raise PricingError("quantity must be a whole number")
    if qty < 1 or qty > MAX_QUANTITY:
        raise PricingError(f"quantity must be between 1 and {MAX_QUANTITY}")
    return qty


def quote_plan(catalog: dict, state: PlanState, plan: str, cycle: str, now: datetime) -> Quote:
    """Price an upgrade. Downgrades are not bought; they are scheduled."""
    if cycle not in CYCLES:
        raise PricingError("cycle must be 'monthly' or 'yearly'")
    cfg = plan_config(catalog, plan)
    if not cfg.get("self_serve") or not cfg.get("price_cents"):
        raise PricingError(f"The {cfg.get('label', plan)} plan cannot be bought online.")
    if not is_upgrade(catalog, state, plan, cycle):
        raise PricingError("That is not an upgrade; schedule it as a plan change instead.")

    label = cfg.get("label", plan)
    new_price = cycle_price(catalog, plan, cycle)
    item = {"type": "plan", "plan": plan, "cycle": cycle}

    if _paid_period_active(catalog, state, now) and state.cycle == cycle:
        # Same cycle, higher plan: pay the difference for the rest of the
        # period already paid for; the period itself is unchanged.
        start, end = aware(state.period_start), aware(state.period_end)
        old_price = cycle_price(catalog, state.plan, cycle)
        amount = prorate(new_price - old_price, start, end, now)
        old_label = plan_config(catalog, state.plan).get("label", state.plan)
        return Quote(
            item, amount, f"Upgrade to {label} ({cycle})", end, None,
            lines=[part(f"{label} instead of {old_label} for the rest of your paid period",
                        amount, now, end)],
            next_charge_at=end, next_charge_cents=new_price,
        )

    # A new period starts now. Credit what is left of a paid period.
    credit = 0
    if _paid_period_active(catalog, state, now):
        credit = prorate(
            cycle_price(catalog, state.plan, state.cycle),
            aware(state.period_start),
            aware(state.period_end),
            now,
        )
    note = None
    if cycle == YEARLY:
        end = add_years(now)
        amount = new_price
        lines = [part(f"{label} plan, 12 months", new_price, now, end)]
    else:
        end = next_month_start(now)
        amount = month_remainder(new_price, now)
        lines = [part(f"{label} plan, rest of {now:%B}", amount, now, end)]
        if end - now < SHORT_REMAINDER:
            following = next_month_start(end)
            lines.append(part(f"{label} plan, {end:%B}", new_price, end, following))
            amount += new_price
            note = (
                f"{now:%B} ends in {_days_left(now, end)}, so this payment also "
                f"covers all of {end:%B}. You will not be charged again until "
                f"{following.day} {following:%B %Y}."
            )
            end = following
    if credit:
        applied = min(credit, amount)
        lines.append(part("Credit for the unused part of your current plan", -applied))
    return Quote(
        item, max(amount - credit, 0), f"{label} plan ({cycle})", end, now,
        lines=lines, next_charge_at=end, next_charge_cents=new_price, note=note,
    )


def _days_left(now: datetime, end: datetime) -> str:
    days = (end - now).days
    if days < 1:
        return "less than a day"
    return f"{days} day{'s' if days != 1 else ''}"


def quote_addon(
    catalog: dict, state: PlanState, addon: str, quantity: int, now: datetime
) -> Quote:
    addons = catalog.get("addons") or {}
    cfg = addons.get(addon)
    if cfg is None:
        raise PricingError(f"Unknown add-on '{addon}'")
    plan_cfg = plan_config(catalog, state.plan)
    item = {"type": "addon", "addon": addon, "quantity": quantity}

    if addon == "extra_seat":
        monthly = extra_seat_price(catalog, state.plan)
        if monthly is None:
            raise PricingError(
                f"Extra instructor seats are not available on the "
                f"{plan_cfg.get('label', state.plan)} plan; upgrade to add seats."
            )
        if state.cycle == YEARLY and _paid_period_active(catalog, state, now):
            # Yearly plans cover seats at the yearly rate until the period ends.
            discount = int(catalog.get("yearly_discount_percent") or 0)
            yearly = monthly * 12 * (100 - discount) // 100
            end = aware(state.period_end)
            amount = prorate(yearly, aware(state.period_start), end, now) * quantity
            label = f"{quantity} extra instructor seat(s)"
            return Quote(
                item, amount, label, end, None, True,
                lines=[part(f"{label}, rest of your yearly period", amount, now, end)],
                next_charge_at=end, next_charge_cents=yearly * quantity,
            )
        amount = month_remainder(monthly, now) * quantity
        end = next_month_start(now)
        label = f"{quantity} extra instructor seat(s)"
        return Quote(
            item, amount, label, end, None, True,
            lines=[part(f"{label}, rest of {now:%B}", amount, now, end)],
            next_charge_at=end, next_charge_cents=monthly * quantity,
        )

    if addon in ("remove_badge", "sso"):
        if state.plan not in (cfg.get("available_on_plans") or []):
            raise PricingError(
                "Single sign-on is available on paid plans; upgrade first."
                if addon == "sso" else "Removing the badge is not sold on this plan."
            )
        quantity = 1
        item["quantity"] = 1
        monthly = int(cfg["price_cents"])
    elif addon == "managed_email":
        if state.plan in (cfg.get("included_in_plans") or []):
            raise PricingError("Managed email is already included in your plan.")
        extra = int(cfg.get("extra_block_price_cents") or cfg["price_cents"])
        monthly = int(cfg["price_cents"]) + extra * (quantity - 1)
    elif addon == "live_unlimited":
        monthly = int(cfg["price_cents"]) * quantity
    else:  # pragma: no cover - catalogue add-ons are all handled above
        raise PricingError(f"Add-on '{addon}' cannot be bought online.")

    amount = month_remainder(monthly, now)
    end = next_month_start(now)
    return Quote(
        item, amount, _addon_label(addon, quantity), end, None, True,
        lines=[part(f"{_addon_label(addon, quantity)}, rest of {now:%B}", amount, now, end)],
        next_charge_at=end, next_charge_cents=monthly,
    )


def _addon_label(addon: str, quantity: int) -> str:
    return {
        "remove_badge": "Remove the \"Powered by ValidBridge\" badge",
        "managed_email": f"Managed email ({quantity * 5000:,} emails / month)",
        "live_unlimited": f"LiveBridge Unlimited ({quantity} instructor(s))",
        "sso": "Single sign-on (SSO)",
    }.get(addon, addon)


def addon_monthly_price(catalog: dict, plan: str, addon: str, quantity: int) -> int | None:
    """Full monthly price of a held add-on on ``plan`` (None = not billable)."""
    cfg = (catalog.get("addons") or {}).get(addon) or {}
    if addon == "extra_seat":
        price = extra_seat_price(catalog, plan)
        return None if price is None else price * quantity
    if addon == "managed_email":
        if plan in (cfg.get("included_in_plans") or []):
            return None
        extra = int(cfg.get("extra_block_price_cents") or cfg.get("price_cents") or 0)
        return int(cfg.get("price_cents") or 0) + extra * (quantity - 1)
    if addon in ("remove_badge", "sso"):
        if plan not in (cfg.get("available_on_plans") or []):
            return None
        return int(cfg.get("price_cents") or 0)
    if addon == "live_unlimited":
        return int(cfg.get("price_cents") or 0) * quantity
    return None


def quote(catalog: dict, state: PlanState, item: dict, now: datetime | None = None) -> Quote:
    """Price any purchasable item. Raises PricingError for anything invalid."""
    now = now or datetime.now(UTC)
    if not isinstance(item, dict):
        raise PricingError("item must be an object")
    kind = item.get("type")

    if kind == "plan":
        return quote_plan(
            catalog, state, str(item.get("plan") or ""), str(item.get("cycle") or MONTHLY), now
        )

    if kind == "addon":
        return quote_addon(catalog, state, str(item.get("addon") or ""), _quantity(item), now)

    if kind == "pack":
        qty = _quantity(item)
        pack_kind, pack = find_pack(catalog, str(item.get("pack_id") or ""))
        return Quote(
            {"type": "pack", "pack_id": pack["id"], "kind": pack_kind,
             "units": int(pack["quantity"]), "quantity": qty},
            int(pack["price_cents"]) * qty,
            f"{qty} × {pack['id'].replace('_', ' ')} pack",
            None,
            None,
            True,
        )

    if kind == "wallet_topup":
        try:
            amount = int(item.get("amount_cents"))
        except (TypeError, ValueError):
            raise PricingError("amount_cents must be a whole number")
        if amount < MIN_TOPUP_CENTS or amount > MAX_TOPUP_CENTS:
            raise PricingError(
                f"Top-ups must be between KES {MIN_TOPUP_CENTS // 100:,} "
                f"and KES {MAX_TOPUP_CENTS // 100:,}."
            )
        return Quote({"type": "wallet_topup", "amount_cents": amount}, amount, "Wallet top-up")

    raise PricingError("Unknown item type")
