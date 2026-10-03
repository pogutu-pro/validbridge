"""
Payments router — org-scoped, mapped 1:1 to the web frontend contract.

Authorization model (the ValidBridge principle):
  * org-facing management (config, groups, offers, customers) → org admin only
  * learner endpoints (enrollments/mine, checkout) → authenticated user
  * public storefront (public-listing, public offer, by-resource) → anonymous
  * provider webhook → public, verified by Paystack signature

Every query is scoped by the path ``org_id``; there is no cross-org access.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.org_auth import require_org_admin, require_org_membership
from src.services.payments import service

router = APIRouter(tags=["payments"])


# ── Request bodies ───────────────────────────────────────────────────────────

class ConfigInitBody(BaseModel):
    provider: Optional[str] = "paystack"
    enabled: Optional[bool] = True
    active: Optional[bool] = None
    secret_key: Optional[str] = None
    public_key: Optional[str] = None


class ManagedPayoutBody(BaseModel):
    business_name: str = Field(max_length=100)
    bank_code: str = Field(max_length=32)
    account_number: str = Field(max_length=40)
    contact_email: Optional[str] = Field(default=None, max_length=320)
    contact_name: Optional[str] = Field(default=None, max_length=100)
    contact_phone: Optional[str] = Field(default=None, max_length=32)


class GroupBody(BaseModel):
    name: str
    description: Optional[str] = None


class OfferBody(BaseModel):
    name: str
    description: Optional[str] = None
    offer_type: str = "one_time"
    price_type: str = "fixed_price"
    interval: Optional[str] = None
    benefits: Optional[str] = None
    amount: float = 0
    currency: str = "KES"
    payments_group_id: Optional[int] = None
    resource_uuids: Optional[list[str]] = None
    is_publicly_listed: Optional[bool] = True


# ── Helpers ──────────────────────────────────────────────────────────────────

async def require_payments_admin(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> int:
    """Org-scoped admin guard: raises 403 unless the caller admins this org."""
    await require_org_admin(resolve_acting_user_id(current_user), org_id, db_session)
    return resolve_acting_user_id(current_user)


# ── Config ───────────────────────────────────────────────────────────────────

@router.get("/{org_id}/config")
async def api_get_configs(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    return await service.get_configs(org_id, db_session)


@router.post("/{org_id}/config")
async def api_initialize_config(
    org_id: int,
    body: ConfigInitBody,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    provider_config: dict = {}
    if body.secret_key:
        provider_config["secret_key"] = body.secret_key
    if body.public_key:
        provider_config["public_key"] = body.public_key
    if body.active is not None:
        provider_config["active"] = body.active
    return await service.initialize_config(org_id, body.provider or "paystack", provider_config, db_session)


@router.get("/{org_id}/config/payout-options")
async def api_payout_options(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    """Everything the "get paid to your bank" form needs (banks, fee, currency)."""
    return await service.payout_options(org_id, db_session)


@router.get("/{org_id}/config/payout-status")
async def api_payout_status(
    org_id: int,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    """Has Paystack verified this org's payout account yet?"""
    return await service.payout_status(org_id, db_session)


@router.post("/{org_id}/config/managed")
async def api_setup_managed_payouts(
    org_id: int,
    body: ManagedPayoutBody,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    """Get paid without a Paystack account: creates a Paystack subaccount."""
    return await service.setup_managed_payouts(org_id, body.model_dump(), db_session)


@router.delete("/{org_id}/config")
async def api_delete_config(
    org_id: int,
    id: str,
    db_session: AsyncSession = Depends(get_db_session),
    _=Depends(require_payments_admin),
):
    await service.delete_config(org_id, id, db_session)
    return {"detail": "Payment configuration removed"}


# ── Groups ───────────────────────────────────────────────────────────────────

@router.get("/{org_id}/groups")
async def api_list_groups(
    org_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.list_groups(org_id, db_session)


@router.post("/{org_id}/groups")
async def api_create_group(
    org_id: int, body: GroupBody, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.create_group(org_id, body.name, body.description or "", db_session)


@router.put("/{org_id}/groups/{group_id}")
async def api_update_group(
    org_id: int, group_id: int, body: GroupBody, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.update_group(org_id, group_id, body.name, body.description or "", db_session)


@router.delete("/{org_id}/groups/{group_id}")
async def api_delete_group(
    org_id: int, group_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.delete_group(org_id, group_id, db_session)
    return {"detail": "Payment group deleted"}


@router.get("/{org_id}/groups/{group_id}/resources")
async def api_list_group_resources(
    org_id: int, group_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.list_group_resources(org_id, group_id, db_session)


@router.post("/{org_id}/groups/{group_id}/resources")
async def api_add_group_resource(
    org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.add_group_resource(org_id, group_id, resource_uuid, db_session)
    return {"detail": "Resource added"}


@router.delete("/{org_id}/groups/{group_id}/resources")
async def api_remove_group_resource(
    org_id: int, group_id: int, resource_uuid: str, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.remove_group_resource(org_id, group_id, resource_uuid, db_session)
    return {"detail": "Resource removed"}


@router.post("/{org_id}/groups/{group_id}/sync")
async def api_sync_group(
    org_id: int, group_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    """Manually reconcile a payments group into its usergroup."""
    return await service.sync_group(org_id, group_id, db_session)


# ── Offers ───────────────────────────────────────────────────────────────────

@router.get("/{org_id}/offers")
async def api_list_offers(
    org_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.list_offers(org_id, db_session)


@router.post("/{org_id}/offers")
async def api_create_offer(
    org_id: int, body: OfferBody, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.create_offer(org_id, body.model_dump(), db_session)


@router.put("/{org_id}/offers/{offer_id}")
async def api_update_offer(
    org_id: int, offer_id: int, body: OfferBody, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.update_offer(org_id, offer_id, body.model_dump(exclude_unset=True), db_session)


@router.delete("/{org_id}/offers/{offer_id}")
async def api_archive_offer(
    org_id: int, offer_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.archive_offer(org_id, offer_id, db_session)
    return {"detail": "Offer archived"}


@router.get("/{org_id}/offers/{offer_id}/resources")
async def api_list_offer_resources(
    org_id: int, offer_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.list_offer_resources(org_id, offer_id, db_session)


@router.post("/{org_id}/offers/{offer_id}/resources")
async def api_add_offer_resource(
    org_id: int, offer_id: int, resource_uuid: str, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.add_offer_resource(org_id, offer_id, resource_uuid, db_session)
    return {"detail": "Resource linked"}


@router.delete("/{org_id}/offers/{offer_id}/resources")
async def api_remove_offer_resource(
    org_id: int, offer_id: int, resource_uuid: str, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    await service.remove_offer_resource(org_id, offer_id, resource_uuid, db_session)
    return {"detail": "Resource unlinked"}


# Public storefront (no auth)
@router.get("/{org_id}/offers/public-listing")
async def api_public_offers(org_id: int, db_session: AsyncSession = Depends(get_db_session)):
    return await service.list_public_offers(org_id, db_session)


@router.get("/{org_id}/offers/{offer_uuid}/public")
async def api_public_offer(org_id: int, offer_uuid: str, db_session: AsyncSession = Depends(get_db_session)):
    return await service.get_public_offer(org_id, offer_uuid, db_session)


@router.get("/{org_id}/offers/by-resource")
async def api_offers_by_resource(org_id: int, resource_uuid: str, db_session: AsyncSession = Depends(get_db_session)):
    return await service.list_offers_by_resource(org_id, resource_uuid, db_session)


# Checkout (authenticated buyer)
@router.post("/{org_id}/offers/{offer_uuid}/checkout")
async def api_offer_checkout(
    org_id: int,
    offer_uuid: str,
    redirect_uri: str,
    amount: Optional[float] = None,
    method: Optional[str] = None,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user_id = resolve_acting_user_id(current_user)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="You must be logged in to checkout")
    user = current_user
    email = getattr(user, "email", None)
    if not email:
        raise HTTPException(status_code=401, detail="No email on account")
    from src.security.redirects import is_allowed_return_url

    if not await is_allowed_return_url(redirect_uri, db_session):
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")
    return await service.create_checkout_session(
        org_id, offer_uuid, email, user_id, redirect_uri, db_session, amount=amount,
        method=method,
    )


@router.post("/{org_id}/checkout/verify")
async def api_verify_checkout(
    org_id: int,
    reference: str,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Buyer returned from Paystack: confirm the payment and unlock now."""
    user_id = resolve_acting_user_id(current_user)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="You must be logged in")
    return await service.verify_checkout(org_id, reference[:100], user_id, db_session)


# ── Enrollments & customers ──────────────────────────────────────────────────

@router.get("/{org_id}/enrollments/mine")
async def api_my_enrollments(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user_id = resolve_acting_user_id(current_user)
    await require_org_membership(user_id, org_id, db_session)
    return await service.list_my_enrollments(org_id, user_id, db_session)


@router.delete("/{org_id}/enrollments/{offer_id}")
async def api_cancel_subscription(
    org_id: int,
    offer_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user_id = resolve_acting_user_id(current_user)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="You must be logged in to cancel a subscription")
    return await service.cancel_subscription(org_id, user_id, offer_id, db_session)


@router.get("/{org_id}/customers")
async def api_customers(
    org_id: int, db_session: AsyncSession = Depends(get_db_session), _=Depends(require_payments_admin)
):
    return await service.list_customers(org_id, db_session)


# ── Billing portal (buyer self-service) ──────────────────────────────────────

@router.get("/{org_id}/billing/overview")
async def api_billing_overview(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user_id = resolve_acting_user_id(current_user)
    await require_org_membership(user_id, org_id, db_session)
    return await service.billing_overview(org_id, user_id, db_session)


@router.get("/{org_id}/billing/invoices")
async def api_billing_invoices(
    org_id: int,
    current_user=Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    user_id = resolve_acting_user_id(current_user)
    await require_org_membership(user_id, org_id, db_session)
    return await service.billing_transactions(org_id, user_id, db_session)


# ── Webhook (public, Paystack signature-verified) ────────────────────────────

@router.post("/paystack/webhook")
async def api_paystack_webhook(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    raw_body = await request.body()
    signature = request.headers.get("x-paystack-signature")
    return await service.dispatch_webhook(raw_body, signature, db_session)
