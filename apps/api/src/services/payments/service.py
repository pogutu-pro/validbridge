"""
Payments service layer — org-scoped CRUD + Paystack checkout/webhook.

Every function here is scoped to a single organization via ``org_id`` and
filtered by that org in every query. Callers are expected to have already
authorized the acting user (see routers/payments.py).
"""

import uuid
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.payments.payments import (
    PaymentProviderEnum,
    PaymentsConfig,
    PaymentsConfigRead,
)
from src.db.payments.payments_enrollments import (
    EnrollmentStatusEnum,
    PaymentsEnrollment,
)
from src.db.payments.payments_events import PaymentsEvent
from src.db.payments.payments_groups import (
    PaymentsGroup,
    PaymentsGroupRead,
    PaymentsGroupResource,
    PaymentsOfferResource,
)
from src.db.payments.payments_offers import (
    OfferPriceTypeEnum,
    OfferTypeEnum,
    PaymentsOffer,
    PaymentsOfferRead,
    SubscriptionIntervalEnum,
)
from src.security.secret_crypto import encrypt_secret
from src.services.payments import group_sync, paystack


def _now() -> datetime:
    return datetime.now()


def _encrypt_provider_secrets(provider_config: dict) -> dict:
    """Encrypt BYOK secrets before they touch the database — never plaintext."""
    config = dict(provider_config)
    secret_key = config.get("secret_key")
    if secret_key:
        config["secret_key"] = encrypt_secret(secret_key)
    return config


# ── Config ───────────────────────────────────────────────────────────────────

async def get_configs(org_id: int, db_session: AsyncSession) -> list[dict]:
    rows = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().all()
    return [
        {
            "id": c.id,
            "org_id": c.org_id,
            "enabled": c.enabled,
            "active": c.active,
            "provider": c.provider.value if isinstance(c.provider, PaymentProviderEnum) else c.provider,
            "creation_date": c.creation_date,
            "update_date": c.update_date,
        }
        for c in rows
    ]


async def initialize_config(
    org_id: int, provider: str, provider_config: dict, db_session: AsyncSession
) -> dict:
    # ``active`` is a column, not provider-specific data — never persist it.
    requested_active = provider_config.pop("active", None)
    provider_config = _encrypt_provider_secrets(provider_config)

    existing = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()

    if existing is not None:
        existing.enabled = True
        if requested_active is not None:
            existing.active = bool(requested_active)
        existing.provider = PaymentProviderEnum(provider)
        if provider_config:
            existing.provider_config = {**existing.provider_config, **provider_config}
        existing.update_date = _now()
        db_session.add(existing)
        await db_session.commit()
        await db_session.refresh(existing)
        return PaymentsConfigRead.model_validate(existing).model_dump()

    config = PaymentsConfig(
        org_id=org_id,
        enabled=True,
        active=True if requested_active is None else bool(requested_active),
        provider=PaymentProviderEnum(provider),
        provider_config=provider_config,
    )
    db_session.add(config)
    await db_session.commit()
    await db_session.refresh(config)
    return PaymentsConfigRead.model_validate(config).model_dump()


async def delete_config(org_id: int, config_id: str, db_session: AsyncSession) -> None:
    config = (
        await db_session.execute(
            select(PaymentsConfig).where(
                PaymentsConfig.org_id == org_id, PaymentsConfig.id == int(config_id)
            )
        )
    ).scalars().first()
    if config is None:
        raise HTTPException(status_code=404, detail="Payment configuration not found")
    await db_session.delete(config)
    await db_session.commit()


# ── Groups ───────────────────────────────────────────────────────────────────

async def list_groups(org_id: int, db_session: AsyncSession) -> list[PaymentsGroupRead]:
    rows = (
        await db_session.execute(
            select(PaymentsGroup).where(PaymentsGroup.org_id == org_id)
        )
    ).scalars().all()
    return [PaymentsGroupRead.model_validate(g) for g in rows]


async def create_group(org_id: int, name: str, description: str, db_session: AsyncSession) -> PaymentsGroupRead:
    group = PaymentsGroup(org_id=org_id, name=name, description=description)
    db_session.add(group)
    await db_session.commit()
    await db_session.refresh(group)
    return PaymentsGroupRead.model_validate(group)


async def update_group(org_id: int, group_id: int, name: str, description: str, db_session: AsyncSession) -> PaymentsGroupRead:
    group = await _get_group(org_id, group_id, db_session)
    group.name = name
    group.description = description
    group.update_date = _now()
    db_session.add(group)
    await db_session.commit()
    await db_session.refresh(group)
    return PaymentsGroupRead.model_validate(group)


async def delete_group(org_id: int, group_id: int, db_session: AsyncSession) -> None:
    group = await _get_group(org_id, group_id, db_session)
    await db_session.delete(group)
    await db_session.commit()


async def _get_group(org_id: int, group_id: int, db_session: AsyncSession) -> PaymentsGroup:
    group = (
        await db_session.execute(
            select(PaymentsGroup).where(
                PaymentsGroup.org_id == org_id, PaymentsGroup.id == group_id
            )
        )
    ).scalars().first()
    if group is None:
        raise HTTPException(status_code=404, detail="Payment group not found")
    return group


async def list_group_resources(org_id: int, group_id: int, db_session: AsyncSession) -> list[str]:
    await _get_group(org_id, group_id, db_session)
    rows = (
        await db_session.execute(
            select(PaymentsGroupResource.resource_uuid).where(
                PaymentsGroupResource.payments_group_id == group_id,
                PaymentsGroupResource.org_id == org_id,
            )
        )
    ).scalars().all()
    return list(rows)


async def add_group_resource(org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession) -> None:
    await _get_group(org_id, group_id, db_session)
    existing = (
        await db_session.execute(
            select(PaymentsGroupResource).where(
                PaymentsGroupResource.payments_group_id == group_id,
                PaymentsGroupResource.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if existing is None:
        db_session.add(
            PaymentsGroupResource(
                payments_group_id=group_id, resource_uuid=resource_uuid, org_id=org_id
            )
        )
        await db_session.commit()
    await _reconcile_group_resources_sync(group_id, db_session)


async def remove_group_resource(org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession) -> None:
    await _get_group(org_id, group_id, db_session)
    rows = (
        await db_session.execute(
            select(PaymentsGroupResource).where(
                PaymentsGroupResource.payments_group_id == group_id,
                PaymentsGroupResource.resource_uuid == resource_uuid,
            )
        )
    ).scalars().all()
    for r in rows:
        await db_session.delete(r)
    await db_session.commit()
    await _reconcile_group_resources_sync(group_id, db_session)


async def _reconcile_group_resources_sync(group_id: int, db_session: AsyncSession) -> None:
    group = await group_sync.load_group(group_id, db_session)
    if group is None:
        return
    await group_sync.reconcile_group_resources(group, db_session)
    await db_session.commit()


# ── Offers ───────────────────────────────────────────────────────────────────

async def list_offers(org_id: int, db_session: AsyncSession) -> list[PaymentsOfferRead]:
    rows = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id,
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().all()
    return [PaymentsOfferRead.model_validate(o) for o in rows]


async def create_offer(
    org_id: int,
    data: dict,
    db_session: AsyncSession,
) -> PaymentsOfferRead:
    offer_type = OfferTypeEnum(data["offer_type"])
    offer = PaymentsOffer(
        offer_uuid=f"offer_{uuid.uuid4().hex}",
        org_id=org_id,
        name=data["name"],
        description=data.get("description"),
        offer_type=offer_type,
        price_type=OfferPriceTypeEnum(data.get("price_type", "fixed_price")),
        interval=_interval_from(data),
        amount=float(data.get("amount", 0)),
        currency=data.get("currency", "KES"),
        benefits=data.get("benefits"),
        is_publicly_listed=bool(data.get("is_publicly_listed", True)),
        payments_group_id=data.get("payments_group_id"),
    )
    if offer_type == OfferTypeEnum.subscription:
        offer.provider_product_id = await _provision_plan(org_id, offer, db_session)
    db_session.add(offer)
    await db_session.flush()

    for resource_uuid in data.get("resource_uuids", []) or []:
        db_session.add(
            PaymentsOfferResource(offer_id=offer.id, resource_uuid=resource_uuid, org_id=org_id)
        )
    await db_session.commit()
    await db_session.refresh(offer)
    if offer.payments_group_id:
        await _reconcile_group_resources_sync(offer.payments_group_id, db_session)
    return PaymentsOfferRead.model_validate(offer)


async def update_offer(org_id: int, offer_id: int, data: dict, db_session: AsyncSession) -> PaymentsOfferRead:
    offer = await _get_offer(org_id, offer_id, db_session)
    for field in ("name", "description", "amount", "currency", "benefits"):
        if field in data and data[field] is not None:
            setattr(offer, field, data[field])
    if "offer_type" in data:
        offer.offer_type = OfferTypeEnum(data["offer_type"])
    if "price_type" in data:
        offer.price_type = OfferPriceTypeEnum(data["price_type"])
    if "interval" in data:
        offer.interval = _interval_from(data)
    offer.update_date = _now()
    db_session.add(offer)
    await db_session.commit()
    await db_session.refresh(offer)

    if offer.offer_type == OfferTypeEnum.subscription:
        offer.provider_product_id = await _provision_plan(org_id, offer, db_session)
        offer.update_date = _now()
        db_session.add(offer)
        await db_session.commit()
        await db_session.refresh(offer)
    if offer.payments_group_id:
        await _reconcile_group_resources_sync(offer.payments_group_id, db_session)
    return PaymentsOfferRead.model_validate(offer)


def _interval_from(data: dict) -> SubscriptionIntervalEnum | None:
    if data.get("offer_type") != "subscription":
        return None
    value = data.get("interval") or "monthly"
    return SubscriptionIntervalEnum(value)


async def _provision_plan(org_id: int, offer: PaymentsOffer, db_session: AsyncSession) -> str | None:
    """Create/update the Paystack plan backing a subscription offer.

    Returns the plan code to store in ``provider_product_id``. If the org uses a
    ``custom`` provider (e.g. the demo sandbox) there is no Paystack account to
    provision against, so the offer is stored without a plan code.
    """
    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()
    if config is not None and config.provider == PaymentProviderEnum.custom:
        return offer.provider_product_id

    try:
        credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
    except paystack.PaymentsNotConfiguredError:
        raise HTTPException(
            status_code=400,
            detail="Cannot create a subscription without Paystack credentials configured.",
        )
    interval = offer.interval
    if isinstance(interval, SubscriptionIntervalEnum):
        interval_value = interval.value
    else:
        interval_value = interval or SubscriptionIntervalEnum.monthly.value
    plan_args = {
        "name": offer.name,
        "amount_major": offer.amount,
        "currency": offer.currency,
        "interval": interval_value,
    }
    if offer.provider_product_id:
        return await paystack.update_plan(
            credentials.secret_key, offer.provider_product_id, **plan_args
        )
    return await paystack.create_plan(credentials.secret_key, **plan_args)


async def archive_offer(org_id: int, offer_id: int, db_session: AsyncSession) -> None:
    """Retire an offer without destroying enrollment history.

    A hard delete cascades to ``payments_enrollments`` and
    ``payments_offer_resources`` (ON DELETE CASCADE), which would erase paid
    customers and silently un-paywall content. Instead we hide the offer from
    the admin list and storefront and stop it from gating resources.
    """
    offer = await _get_offer(org_id, offer_id, db_session)
    offer.is_archived = True
    offer.is_publicly_listed = False
    offer.update_date = _now()
    db_session.add(offer)
    await db_session.commit()


async def get_offer(org_id: int, offer_id: int, db_session: AsyncSession) -> PaymentsOffer:
    return await _get_offer(org_id, offer_id, db_session)


async def _get_offer(org_id: int, offer_id: int, db_session: AsyncSession) -> PaymentsOffer:
    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id, PaymentsOffer.id == offer_id
            )
        )
    ).scalars().first()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    return offer


# ── Payments → usergroup sync ────────────────────────────────────────────────

async def _sync_membership_for_offer(
    offer: PaymentsOffer, user_id: int, db_session: AsyncSession, *, granted: bool
) -> None:
    """Sync a buyer into the offer's payments group (no-op when none linked)."""
    group_id = getattr(offer, "payments_group_id", None)
    if group_id is None:
        return
    group = await group_sync.load_group(group_id, db_session)
    if group is None:
        return
    await group_sync.sync_offer_buyer(
        group, offer.id, user_id, granted=granted, db_session=db_session
    )


async def _sync_membership_for_enrollment(
    enrollment: PaymentsEnrollment, db_session: AsyncSession, *, granted: bool
) -> None:
    """Sync membership based on the enrollment's offer group."""
    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(PaymentsOffer.id == enrollment.offer_id)
        )
    ).scalars().first()
    if offer is None:
        return
    await _sync_membership_for_offer(offer, enrollment.user_id, db_session, granted=granted)


async def sync_group(org_id: int, group_id: int, db_session: AsyncSession) -> dict:
    """Full manual sync of a payments group into its usergroup (admin trigger)."""
    group = await _get_group(org_id, group_id, db_session)
    members_added, members_removed = await group_sync.reconcile_group_members(
        group, db_session
    )
    resources_added, resources_removed = await group_sync.reconcile_group_resources(
        group, db_session
    )
    await db_session.commit()
    return {
        "group_id": group.id,
        "usergroup_id": group.usergroup_id,
        "members_added": members_added,
        "members_removed": members_removed,
        "resources_mirrored": resources_added,
        "resources_removed": resources_removed,
    }


async def _offer_public_shape(offer: PaymentsOffer, db_session: AsyncSession) -> dict:
    resource_uuids = set(
        (
            await db_session.execute(
                select(PaymentsOfferResource.resource_uuid).where(
                    PaymentsOfferResource.offer_id == offer.id
                )
            )
        ).scalars().all()
    )
    if offer.payments_group_id:
        group_uuids = (
            await db_session.execute(
                select(PaymentsGroupResource.resource_uuid).where(
                    PaymentsGroupResource.payments_group_id == offer.payments_group_id
                )
            )
        ).scalars().all()
        resource_uuids.update(group_uuids)

    included = await _resolve_resources(list(resource_uuids), db_session)
    return {
        "id": offer.id,
        "offer_uuid": offer.offer_uuid,
        "name": offer.name,
        "description": offer.description,
        "offer_type": offer.offer_type.value if isinstance(offer.offer_type, OfferTypeEnum) else offer.offer_type,
        "price_type": offer.price_type.value if isinstance(offer.price_type, OfferPriceTypeEnum) else offer.price_type,
        "interval": offer.interval.value if isinstance(offer.interval, SubscriptionIntervalEnum) else offer.interval,
        "amount": offer.amount,
        "currency": offer.currency,
        "benefits": offer.benefits,
        "payments_group_id": offer.payments_group_id,
        "included_resources": included,
    }


async def _resolve_resources(resource_uuids: list[str], db_session: AsyncSession) -> list[dict]:
    """Resolve resource_uuids to a minimal display shape (course-aware)."""
    from src.db.courses.courses import Course

    result: list[dict] = []
    for resource_uuid in resource_uuids:
        resource_type = resource_uuid.split("_", 1)[0] if "_" in resource_uuid else "course"
        entry: dict = {
            "resource_uuid": resource_uuid,
            "resource_type": resource_type,
            "name": resource_uuid,
            "description": "",
            "thumbnail_image": "",
            "org_uuid": "",
        }
        if resource_type == "course":
            course = (
                await db_session.execute(
                    select(Course).where(Course.course_uuid == resource_uuid)
                )
            ).scalars().first()
            if course:
                entry.update(
                    name=course.name,
                    description=course.description or "",
                    thumbnail_image=course.thumbnail_image or "",
                )
        result.append(entry)
    return result


async def get_public_offer(org_id: int, offer_uuid: str, db_session: AsyncSession) -> dict:
    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id,
                PaymentsOffer.offer_uuid == offer_uuid,
                PaymentsOffer.is_publicly_listed.is_(True),
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().first()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    return await _offer_public_shape(offer, db_session)


async def list_public_offers(org_id: int, db_session: AsyncSession) -> list[dict]:
    rows = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id,
                PaymentsOffer.is_publicly_listed.is_(True),
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().all()
    return [await _offer_public_shape(o, db_session) for o in rows]


async def list_offers_by_resource(org_id: int, resource_uuid: str, db_session: AsyncSession) -> list[dict]:
    offer_ids = set(
        (
            await db_session.execute(
                select(PaymentsOfferResource.offer_id).where(
                    PaymentsOfferResource.resource_uuid == resource_uuid,
                    PaymentsOfferResource.org_id == org_id,
                )
            )
        ).scalars().all()
    )
    group_ids = (
        await db_session.execute(
            select(PaymentsGroupResource.payments_group_id).where(
                PaymentsGroupResource.resource_uuid == resource_uuid,
                PaymentsGroupResource.org_id == org_id,
            )
        )
    ).scalars().all()
    if group_ids:
        offer_ids.update(
            (
                await db_session.execute(
                    select(PaymentsOffer.id).where(
                        PaymentsOffer.payments_group_id.in_(group_ids),
                        PaymentsOffer.org_id == org_id,
                    )
                )
            ).scalars().all()
        )
    if not offer_ids:
        return []
    rows = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.id.in_(offer_ids),
                PaymentsOffer.org_id == org_id,
                PaymentsOffer.is_publicly_listed.is_(True),
                PaymentsOffer.is_archived.is_(False),
            )
        )
    ).scalars().all()
    return [await _offer_public_shape(o, db_session) for o in rows]


# ── Offer resources ──────────────────────────────────────────────────────────

async def list_offer_resources(org_id: int, offer_id: int, db_session: AsyncSession) -> list[str]:
    await _get_offer(org_id, offer_id, db_session)
    rows = (
        await db_session.execute(
            select(PaymentsOfferResource.resource_uuid).where(
                PaymentsOfferResource.offer_id == offer_id,
                PaymentsOfferResource.org_id == org_id,
            )
        )
    ).scalars().all()
    return list(rows)


async def add_offer_resource(org_id: int, offer_id: int, resource_uuid: str, db_session: AsyncSession) -> None:
    await _get_offer(org_id, offer_id, db_session)
    existing = (
        await db_session.execute(
            select(PaymentsOfferResource).where(
                PaymentsOfferResource.offer_id == offer_id,
                PaymentsOfferResource.resource_uuid == resource_uuid,
            )
        )
    ).scalars().first()
    if existing is None:
        db_session.add(
            PaymentsOfferResource(offer_id=offer_id, resource_uuid=resource_uuid, org_id=org_id)
        )
        await db_session.commit()
    await _reconcile_offer_group_resources(org_id, offer_id, db_session)


async def remove_offer_resource(org_id: int, offer_id: int, resource_uuid: str, db_session: AsyncSession) -> None:
    await _get_offer(org_id, offer_id, db_session)
    rows = (
        await db_session.execute(
            select(PaymentsOfferResource).where(
                PaymentsOfferResource.offer_id == offer_id,
                PaymentsOfferResource.resource_uuid == resource_uuid,
            )
        )
    ).scalars().all()
    for r in rows:
        await db_session.delete(r)
    await db_session.commit()
    await _reconcile_offer_group_resources(org_id, offer_id, db_session)


async def _reconcile_offer_group_resources(org_id: int, offer_id: int, db_session: AsyncSession) -> None:
    offer = await _get_offer(org_id, offer_id, db_session)
    if offer.payments_group_id:
        await _reconcile_group_resources_sync(offer.payments_group_id, db_session)


# ── Enrollments ──────────────────────────────────────────────────────────────

async def list_my_enrollments(org_id: int, user_id: int, db_session: AsyncSession) -> list[dict]:
    rows = (
        await db_session.execute(
            select(PaymentsEnrollment, PaymentsOffer)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsEnrollment.offer_id)
            .where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.user_id == user_id,
            )
        )
    ).all()
    result = []
    for enrollment, offer in rows:
        result.append(
            {
                "enrollment_id": enrollment.id,
                "offer_id": offer.id,
                "offer_uuid": offer.offer_uuid,
                "offer_name": offer.name,
                "offer_type": offer.offer_type.value if isinstance(offer.offer_type, OfferTypeEnum) else offer.offer_type,
                "amount": offer.amount,
                "currency": offer.currency,
                "status": enrollment.status.value if isinstance(enrollment.status, EnrollmentStatusEnum) else enrollment.status,
                "creation_date": enrollment.creation_date,
            }
        )
    return result


# ── Billing portal ───────────────────────────────────────────────────────────

async def _org_uses_custom_provider(org_id: int, db_session: AsyncSession) -> bool:
    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()
    return config is not None and config.provider == PaymentProviderEnum.custom


async def _subtraction_value(value) -> str:
    return value.value if isinstance(value, SubscriptionIntervalEnum) else str(value or "")


async def _fetch_subscription_summary(
    org_id: int, enrollment: PaymentsEnrollment, db_session: AsyncSession
) -> dict:
    """Best-effort remote subscription status for an active subscription."""
    local_status = (
        enrollment.status.value
        if isinstance(enrollment.status, EnrollmentStatusEnum)
        else enrollment.status
    )
    if not enrollment.subscription_code or await _org_uses_custom_provider(org_id, db_session):
        return {
            "status": local_status,
            "next_payment_date": None,
            "plan_name": None,
            "remote": False,
        }
    try:
        credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
        remote = await paystack.get_subscription(
            credentials.secret_key, enrollment.subscription_code
        )
    except Exception:
        return {
            "status": local_status,
            "next_payment_date": None,
            "plan_name": None,
            "remote": False,
        }
    if not remote:
        return {
            "status": local_status,
            "next_payment_date": None,
            "plan_name": None,
            "remote": False,
        }
    return {
        "status": remote.get("status") or local_status,
        "next_payment_date": remote.get("next_payment_date"),
        "plan_name": (remote.get("plan") or {}).get("name"),
        "remote": True,
    }


def _transaction_shape(t: dict, offer_names: dict = None) -> dict:
    offer_id = (t.get("metadata") or {}).get("offer_id")
    offer_names = offer_names or {}
    return {
        "reference": t.get("reference"),
        "amount": (t.get("amount") or 0) / 100,
        "currency": t.get("currency"),
        "status": t.get("status"),
        "created_at": t.get("created_at"),
        "description": offer_names.get(offer_id) or "Store purchase",
    }


async def billing_transactions(
    org_id: int, user_id: int, db_session: AsyncSession
) -> list[dict]:
    """The caller's payment history (Paystack when live, local fallback)."""
    from src.db.users import User

    user = (
        await db_session.execute(select(User).where(User.id == user_id))
    ).scalars().first()
    email = getattr(user, "email", None) or ""

    if not await _org_uses_custom_provider(org_id, db_session):
        try:
            credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
            remote = await paystack.list_customer_transactions(
                credentials.secret_key, customer=email
            )
        except Exception:
            remote = []
        if remote:
            offer_ids = [
                (t.get("metadata") or {}).get("offer_id")
                for t in remote
                if (t.get("metadata") or {}).get("offer_id")
            ]
            offer_names: dict = {}
            if offer_ids:
                rows = (
                    await db_session.execute(
                        select(PaymentsOffer.id, PaymentsOffer.name).where(
                            PaymentsOffer.id.in_(offer_ids)
                        )
                    )
                ).all()
                for offer_id, name in rows:
                    offer_names[offer_id] = name
            return [_transaction_shape(t, offer_names) for t in remote]

    # Local fallback: surrenders only when the org is on the demo ``custom``
    # provider or Paystack is unreachable/then-unknown customer.
    rows = (
        await db_session.execute(
            select(PaymentsEnrollment, PaymentsOffer)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsEnrollment.offer_id)
            .where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.user_id == user_id,
            )
        )
    ).all()
    return [
        {
            "reference": (enrollment.provider_specific_data or {}).get("reference"),
            "amount": offer.amount,
            "currency": offer.currency,
            "status": (
                enrollment.status.value
                if isinstance(enrollment.status, EnrollmentStatusEnum)
                else enrollment.status
            ),
            "created_at": enrollment.creation_date,
            "description": offer.name,
        }
        for enrollment, offer in rows
    ]


async def billing_overview(
    org_id: int, user_id: int, db_session: AsyncSession
) -> dict:
    """The caller's billing portal data: subscriptions + payment history.

    Subscription extras are fetched best-effort from Paystack; the raw
    ``subscription_code``/``email_token`` are never exposed.
    """
    rows = (
        await db_session.execute(
            select(PaymentsEnrollment, PaymentsOffer)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsEnrollment.offer_id)
            .where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.user_id == user_id,
            )
        )
    ).all()
    subscriptions = []
    for enrollment, offer in rows:
        entry = {
            "enrollment_id": enrollment.id,
            "offer_id": offer.id,
            "offer_uuid": offer.offer_uuid,
            "offer_name": offer.name,
            "offer_type": (
                offer.offer_type.value
                if isinstance(offer.offer_type, OfferTypeEnum)
                else offer.offer_type
            ),
            "amount": offer.amount,
            "currency": offer.currency,
            "interval": await _subtraction_value(offer.interval),
            "status": (
                enrollment.status.value
                if isinstance(enrollment.status, EnrollmentStatusEnum)
                else enrollment.status
            ),
            "creation_date": enrollment.creation_date,
            "subscription": await _fetch_subscription_summary(
                org_id, enrollment, db_session
            ),
        }
        subscriptions.append(entry)

    transactions = await billing_transactions(org_id, user_id, db_session)
    return {"subscriptions": subscriptions, "transactions": transactions}


async def cancel_subscription(
    org_id: int, user_id: int, offer_id: int, db_session: AsyncSession
) -> dict:
    """Cancel the user's active subscription to an offer (no more billing).

    Disables the Paystack subscription and locally marks the enrollment
    ``cancelled``. Access revokes immediately — Paystack has no grace-period
    webhook, so the disable call is the single source of truth.
    """
    enrollment = (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.offer_id == offer_id,
                PaymentsEnrollment.user_id == user_id,
            )
        )
    ).scalars().first()
    if enrollment is None:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()
    is_custom = config is not None and config.provider == PaymentProviderEnum.custom

    if enrollment.subscription_code and not is_custom:
        credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
        await paystack.disable_subscription(
            credentials.secret_key,
            enrollment.subscription_code,
            enrollment.email_token or "",
        )

    enrollment.status = EnrollmentStatusEnum.cancelled
    enrollment.update_date = _now()
    db_session.add(enrollment)
    await _sync_membership_for_enrollment(enrollment, db_session, granted=False)
    await db_session.commit()
    return {"status": "cancelled"}


async def list_customers(org_id: int, db_session: AsyncSession) -> list[dict]:
    from src.db.users import User

    rows = (
        await db_session.execute(
            select(PaymentsEnrollment, PaymentsOffer, User)
            .join(PaymentsOffer, PaymentsOffer.id == PaymentsEnrollment.offer_id)
            .join(User, User.id == PaymentsEnrollment.user_id)
            .where(PaymentsEnrollment.org_id == org_id)
        )
    ).all()
    result = []
    for enrollment, offer, user in rows:
        result.append(
            {
                "enrollment_id": enrollment.id,
                "user": {
                    "user_uuid": user.user_uuid,
                    "avatar_image": getattr(user, "avatar_image", None),
                    "first_name": getattr(user, "first_name", None),
                    "last_name": getattr(user, "last_name", None),
                    "username": getattr(user, "username", None),
                    "email": user.email,
                },
                "offer": {
                    "name": offer.name,
                    "offer_type": offer.offer_type.value if isinstance(offer.offer_type, OfferTypeEnum) else offer.offer_type,
                    "amount": offer.amount,
                    "currency": offer.currency,
                },
                "status": enrollment.status.value if isinstance(enrollment.status, EnrollmentStatusEnum) else enrollment.status,
                "creation_date": enrollment.creation_date,
            }
        )
    return result


# ── Checkout ─────────────────────────────────────────────────────────────────

async def create_checkout_session(
    org_id: int,
    offer_uuid: str,
    user_email: str,
    user_id: int,
    redirect_uri: str,
    db_session: AsyncSession,
    amount: float | None = None,
) -> dict:
    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id, PaymentsOffer.offer_uuid == offer_uuid
            )
        )
    ).scalars().first()
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")

    # Idempotent re-use: an existing live enrollment just redirects to the offer.
    existing = (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.offer_id == offer.id,
                PaymentsEnrollment.user_id == user_id,
                PaymentsEnrollment.status.in_(
                    (EnrollmentStatusEnum.completed, EnrollmentStatusEnum.active)
                ),
            )
        )
    ).scalars().first()
    if existing is not None:
        return {"checkout_url": redirect_uri}

    # Recurring billing starts a Paystack plan subscription rather than a
    # one-time charge. Already-enrolled users are handled above and keep access.
    if offer.offer_type == OfferTypeEnum.subscription and not offer.provider_product_id:
        raise HTTPException(
            status_code=409,
            detail="This subscription offer has no billing plan configured.",
        )

    # Resolve the amount to charge. Only ``customer_choice`` offers accept a
    # buyer-supplied amount, and it must meet the configured minimum.
    charge_amount = offer.amount
    if offer.price_type == OfferPriceTypeEnum.customer_choice and amount is not None:
        if amount < offer.amount:
            raise HTTPException(
                status_code=400,
                detail=f"Amount must be at least {offer.amount:g} {offer.currency}",
            )
        charge_amount = amount

    # Non-Paystack (custom) providers cannot run a hosted checkout. If the
    # offer carries an external checkout URL, send the buyer there; otherwise
    # fail clearly instead of raising an unhandled provider error.
    config = (
        await db_session.execute(
            select(PaymentsConfig).where(PaymentsConfig.org_id == org_id)
        )
    ).scalars().first()
    if config is not None and config.provider == PaymentProviderEnum.custom:
        if offer.external_checkout_url:
            return {"checkout_url": offer.external_checkout_url}
        raise HTTPException(
            status_code=400,
            detail="This organization uses a custom payment provider; checkout is handled outside ValidBridge.",
        )

    credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
    reference = paystack.make_reference(org_id)
    session = await paystack.initialize_transaction(
        credentials.secret_key,
        email=user_email,
        amount_major=charge_amount,
        currency=offer.currency,
        reference=reference,
        callback_url=redirect_uri,
        metadata={"org_id": org_id, "offer_id": offer.id, "user_id": user_id},
        plan=offer.provider_product_id if offer.offer_type == OfferTypeEnum.subscription else None,
    )

    # Reuse an in-flight pending enrollment for this (offer, user) so repeated
    # checkout attempts do not pile up duplicate pending rows.
    pending = (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.offer_id == offer.id,
                PaymentsEnrollment.user_id == user_id,
                PaymentsEnrollment.status == EnrollmentStatusEnum.pending,
            )
        )
    ).scalars().first()
    if pending is None:
        db_session.add(
            PaymentsEnrollment(
                enrollment_uuid=f"enr_{uuid.uuid4().hex}",
                offer_id=offer.id,
                user_id=user_id,
                org_id=org_id,
                status=EnrollmentStatusEnum.pending,
                provider_specific_data={"reference": reference, "amount": charge_amount},
            )
        )
    else:
        pending.provider_specific_data = {"reference": reference, "amount": charge_amount}
        pending.update_date = _now()
        db_session.add(pending)
    await db_session.commit()

    return {"checkout_url": session["authorization_url"]}


# ── Webhook ──────────────────────────────────────────────────────────────────

# Paystack's refund notification is ``refund.processed``; ``charge.refunded``
# is kept for any integration that already sends it.
_REFUND_EVENTS = frozenset({"refund.processed", "charge.refunded"})


def _webhook_event_key(event_type: str, data: dict, reference: str | None) -> str:
    """Idempotency key for one webhook delivery.

    Paystack reuses ``data.id`` across events about the same object: a
    subscription's ``not_renew`` and ``disable`` share an id, and an invoice
    that fails and is then paid sends ``invoice.update`` twice with the same
    id. Keying on the id alone would drop the second event as a duplicate, so
    the key also carries the event type and the object's status.
    """
    object_id = data.get("id") or reference or ""
    return f"{event_type}:{object_id}:{data.get('status') or ''}"


async def handle_webhook(raw_body: bytes, signature: str | None, db_session: AsyncSession) -> dict:
    try:
        body = paystack.parse_webhook_body(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook body")

    event_type = body.get("event", "")
    data = body.get("data") or {}
    # Refund events carry the original charge as ``transaction_reference``
    # (or a nested ``transaction`` object), not ``reference``.
    reference = (
        data.get("reference")
        or data.get("transaction_reference")
        or (data.get("transaction") or {}).get("reference")
    )
    org_id = paystack.reference_to_org_id(reference or "")

    # Subscription lifecycle events (disable/not_renew/invoice.update) carry
    # only the Paystack subscription_code, not our reference — resolve the org
    # from the enrollment that recorded that code.
    if org_id is None:
        code = (
            data.get("subscription_code")
            or data.get("code")
            or (data.get("subscription") or {}).get("subscription_code")
        )
        if code:
            enrollment = (
                await db_session.execute(
                    select(PaymentsEnrollment.org_id).where(
                        PaymentsEnrollment.subscription_code == code
                    )
                )
            ).scalars().first()
            org_id = enrollment

    # Route the event to the org whose credentials signed it. If we cannot
    # determine the org, there is nothing to verify against — reject.
    if org_id is None:
        return {"result": "ignored", "ok": True}

    try:
        credentials = await paystack.resolve_paystack_credentials(org_id, db_session)
    except paystack.PaymentsNotConfiguredError:
        # No usable credentials for this org → cannot verify, so ignore rather
        # than 500 (which would make Paystack retry forever).
        return {"result": "ignored", "ok": True}
    if not paystack.verify_webhook_signature(credentials.secret_key, raw_body, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    event_id = _webhook_event_key(event_type, data, reference)

    # Fast path for the common case: a retry of an event already committed.
    existing = (
        await db_session.execute(
            select(PaymentsEvent.id).where(PaymentsEvent.event_id == event_id)
        )
    ).scalars().first()
    if existing is not None:
        return {"result": "duplicate", "ok": True}

    # Insert-first. The unique index on event_id is the real guard: when two
    # deliveries of one event race past the check above, the second insert
    # blocks on the first transaction and then fails here, so it is reported
    # as a duplicate instead of a 500 that would make Paystack retry again.
    db_session.add(PaymentsEvent(event_id=event_id, event_type=event_type, payload=body))
    try:
        await db_session.flush()
    except IntegrityError:
        await db_session.rollback()
        return {"result": "duplicate", "ok": True}

    if event_type == "charge.success" and data.get("status") == "success":
        await _grant_enrollment(org_id, data, db_session)
    elif event_type in _REFUND_EVENTS:
        await _refund_enrollment(org_id, reference, db_session)
    elif event_type == "subscription.disable":
        await _cancel_subscription(org_id, data, db_session)
    elif event_type == "subscription.not_renew":
        # Paystack: the subscription will lapse at period end. Revoke now; a
        # later successful invoice re-activates it (see the renewal branch).
        await _cancel_subscription(org_id, data, db_session)
    elif event_type == "invoice.update" and data.get("status") in ("failed", "cancelled"):
        await _fail_subscription(org_id, data, db_session)
    elif event_type == "invoice.update" and data.get("status") in ("success", "paid"):
        await _renew_subscription(org_id, data, db_session)

    await db_session.commit()
    return {"result": event_type, "ok": True}


def _paid_amount_matches(offer: PaymentsOffer, data: dict) -> bool:
    """Reject webhooks whose paid amount/currency does not match the offer.

    ``amount`` arrives in minor units (kobo/pesewa). Fixed-price offers must
    match exactly; ``customer_choice`` offers must meet the configured minimum.
    """
    paid = data.get("amount")
    if not isinstance(paid, (int, float)):
        return False
    expected = int(round(offer.amount * 100))
    if offer.price_type == OfferPriceTypeEnum.customer_choice:
        if paid < expected:
            return False
    elif paid != expected:
        return False
    currency = data.get("currency")
    if currency and offer.currency and str(currency).upper() != str(offer.currency).upper():
        return False
    return True


async def _grant_enrollment(org_id: int, data: dict, db_session: AsyncSession) -> None:
    metadata = data.get("metadata") or {}
    offer_id = metadata.get("offer_id")
    user_id = metadata.get("user_id")
    if not offer_id or not user_id:
        return
    try:
        offer_id = int(offer_id)
        user_id = int(user_id)
    except (TypeError, ValueError):
        return

    offer = (
        await db_session.execute(
            select(PaymentsOffer).where(
                PaymentsOffer.org_id == org_id, PaymentsOffer.id == offer_id
            )
        )
    ).scalars().first()
    if offer is None or not _paid_amount_matches(offer, data):
        return

    enrollment = (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.offer_id == offer_id,
                PaymentsEnrollment.user_id == user_id,
            )
        )
    ).scalars().first()

    if enrollment is None:
        subscription_code = (data.get("subscription") or {}).get("subscription_code")
        email_token = (data.get("subscription") or {}).get("email_token")
        is_subscription = getattr(offer, "offer_type", None) in (OfferTypeEnum.subscription, "subscription")
        enrollment = PaymentsEnrollment(
            enrollment_uuid=f"enr_{uuid.uuid4().hex}",
            offer_id=offer_id,
            user_id=user_id,
            org_id=org_id,
            status=(
                EnrollmentStatusEnum.active if is_subscription else EnrollmentStatusEnum.completed
            ),
            subscription_code=subscription_code,
            email_token=email_token,
            provider_specific_data={
                "reference": data.get("reference"),
                "authorization_code": (data.get("authorization") or {}).get("authorization_code"),
            },
        )
        db_session.add(enrollment)
    else:
        is_subscription = getattr(offer, "offer_type", None) in (OfferTypeEnum.subscription, "subscription")
        enrollment.status = (
            EnrollmentStatusEnum.active if is_subscription else EnrollmentStatusEnum.completed
        )
        if (data.get("subscription") or {}).get("subscription_code"):
            enrollment.subscription_code = (data.get("subscription") or {}).get("subscription_code")
            enrollment.email_token = (data.get("subscription") or {}).get("email_token")
        enrollment.provider_specific_data = {
            **enrollment.provider_specific_data,
            "reference": data.get("reference"),
        }
        enrollment.update_date = _now()
        db_session.add(enrollment)

    # Grant through the platform usergroup machinery when the offer is part of
    # a payments group (the sync is idempotent and runs in this transaction).
    await _sync_membership_for_offer(offer, user_id, db_session, granted=True)


async def _find_enrollment_by_subscription(
    org_id: int, subscription_code: str, db_session: AsyncSession
) -> PaymentsEnrollment | None:
    return (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.subscription_code == subscription_code,
            )
        )
    ).scalars().first()


async def _find_enrollment_by_reference(
    org_id: int, reference: str, db_session: AsyncSession
) -> PaymentsEnrollment | None:
    return (
        await db_session.execute(
            select(PaymentsEnrollment).where(
                PaymentsEnrollment.org_id == org_id,
                PaymentsEnrollment.provider_specific_data["reference"].as_string()
                == reference,
            )
        )
    ).scalars().first()


async def _cancel_subscription(org_id: int, data: dict, db_session: AsyncSession) -> None:
    """``subscription.disable`` / ``subscription.not_renew`` → revoke access."""
    code = data.get("subscription_code") or data.get("code")
    if not code:
        return
    enrollment = await _find_enrollment_by_subscription(org_id, code, db_session)
    if enrollment is None:
        return
    enrollment.status = EnrollmentStatusEnum.cancelled
    enrollment.update_date = _now()
    db_session.add(enrollment)
    await _sync_membership_for_enrollment(enrollment, db_session, granted=False)


async def _fail_subscription(org_id: int, data: dict, db_session: AsyncSession) -> None:
    """A renewal invoice failed → mark the subscription as failed."""
    code = (data.get("subscription") or {}).get("subscription_code") or data.get("subscription_code")
    if not code:
        return
    enrollment = await _find_enrollment_by_subscription(org_id, code, db_session)
    if enrollment is None:
        return
    enrollment.status = EnrollmentStatusEnum.failed
    enrollment.update_date = _now()
    db_session.add(enrollment)
    await _sync_membership_for_enrollment(enrollment, db_session, granted=False)


async def _renew_subscription(org_id: int, data: dict, db_session: AsyncSession) -> None:
    """A renewal invoice succeeded → restore access on a previously failed sub.

    A fresh subscription's first payment arrives as ``charge.success`` (which
    grants), so this only has work to do when a prior invoice had failed and the
    subscription then recovered. Cancelled/disabled subscriptions stay cancelled
    — Paystack will not bill a disabled subscription, so this cannot resurrect one.
    """
    code = (data.get("subscription") or {}).get("subscription_code") or data.get("subscription_code")
    if not code:
        return
    enrollment = await _find_enrollment_by_subscription(org_id, code, db_session)
    if enrollment is None:
        return
    if enrollment.status == EnrollmentStatusEnum.cancelled:
        return
    enrollment.status = EnrollmentStatusEnum.active
    enrollment.update_date = _now()
    db_session.add(enrollment)
    await _sync_membership_for_enrollment(enrollment, db_session, granted=True)


async def _refund_enrollment(
    org_id: int, reference: str | None, db_session: AsyncSession
) -> None:
    """A processed refund → mark the matching enrollment refunded."""
    if not reference:
        return
    enrollment = await _find_enrollment_by_reference(org_id, reference, db_session)
    if enrollment is None:
        return
    enrollment.status = EnrollmentStatusEnum.refunded
    enrollment.update_date = _now()
    db_session.add(enrollment)
    await _sync_membership_for_enrollment(enrollment, db_session, granted=False)
