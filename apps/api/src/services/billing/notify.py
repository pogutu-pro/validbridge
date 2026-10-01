"""
Billing emails: invoice issued, payment failed, account paused, receipt.

Billing mail is essential mail (pricing-implementation.md W4e): it is always
sent through the platform provider. Recipients are the billing email if the
school set one, else the org's admins. Sending never raises: a failed email
must not roll back a payment or an invoice.
"""

from __future__ import annotations

import asyncio
import html
import logging
from urllib.parse import quote

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.billing import BillingAccount, Invoice

logger = logging.getLogger(__name__)

ADMIN_ROLE_ID = 1


def kes(cents: int) -> str:
    return f"KES {int(cents) / 100:,.2f}"


def billing_url(org_slug: str, invoice_id: int | None = None) -> str:
    """The hub billing page (root domain, admin-only), where invoices are paid."""
    from config.config import get_validbridge_config

    hosting = get_validbridge_config().hosting_config
    scheme = "https" if hosting.ssl else "http"
    url = f"{scheme}://{hosting.frontend_domain.rstrip('/')}/billing?org={quote(org_slug, safe='')}"
    if invoice_id is not None:
        url += f"&invoice={int(invoice_id)}"
    return url


async def _recipients(org_id: int, db: AsyncSession) -> list[str]:
    account = await db.get(BillingAccount, org_id)
    if account is not None and account.billing_email:
        return [account.billing_email]
    from src.db.user_organizations import UserOrganization
    from src.db.users import User

    rows = (
        await db.execute(
            select(User.email)
            .join(UserOrganization, UserOrganization.user_id == User.id)
            .where(UserOrganization.org_id == org_id, UserOrganization.role_id == ADMIN_ROLE_ID)
        )
    ).scalars().all()
    return [email for email in rows if email][:5]


async def _org(org_id: int, db: AsyncSession):
    from src.db.organizations import Organization

    return await db.get(Organization, org_id)


def _lines_table(invoice: Invoice) -> str:
    rows = "".join(
        f"<tr><td style='padding:4px 12px 4px 0'>{html.escape(str(line.get('description', '')))}</td>"
        f"<td style='padding:4px 0;text-align:right'>{kes(line.get('amount_cents', 0))}</td></tr>"
        for line in (invoice.lines or [])
        if isinstance(line, dict)
    )
    return (
        f"<table style='border-collapse:collapse'>{rows}"
        f"<tr><td style='padding:8px 12px 0 0'><b>Total</b></td>"
        f"<td style='padding:8px 0 0;text-align:right'><b>{kes(invoice.total_cents)}</b></td></tr></table>"
    )


async def _send(org_id: int, subject: str, body_html: str, db: AsyncSession) -> None:
    try:
        from src.services.email.utils import send_email

        for to in await _recipients(org_id, db):
            await asyncio.to_thread(send_email, to, subject, body_html)
    except Exception:
        logger.warning("Billing email %r for org %s failed", subject, org_id, exc_info=True)


def _button(url: str, label: str) -> str:
    return (
        f"<p><a href='{html.escape(url, quote=True)}' style='display:inline-block;"
        f"background:#111;color:#fff;padding:10px 18px;border-radius:8px;"
        f"text-decoration:none'>{html.escape(label)}</a></p>"
    )


async def invoice_due(invoice: Invoice, db: AsyncSession) -> None:
    org = await _org(invoice.org_id, db)
    if org is None:
        return
    url = billing_url(org.slug, invoice.id)
    body = (
        f"<p>Your ValidBridge invoice <b>{html.escape(invoice.number)}</b> for "
        f"{html.escape(org.name)} is ready and awaiting payment.</p>"
        f"{_lines_table(invoice)}"
        f"{_button(url, 'Pay with card or M-Pesa')}"
        f"<p>Paid features pause if the invoice stays unpaid for five days. "
        f"Nothing is ever deleted.</p>"
    )
    await _send(invoice.org_id, f"Invoice {invoice.number} — {kes(invoice.total_cents)}", body, db)


async def payment_failed(invoice: Invoice, attempt_day: int, db: AsyncSession) -> None:
    org = await _org(invoice.org_id, db)
    if org is None:
        return
    url = billing_url(org.slug, invoice.id)
    body = (
        f"<p>We couldn't collect {kes(invoice.total_cents)} for invoice "
        f"<b>{html.escape(invoice.number)}</b> ({html.escape(org.name)}).</p>"
        f"<p>We'll try again automatically. To avoid a pause, pay now:</p>"
        f"{_button(url, 'Pay invoice')}"
    )
    await _send(
        invoice.org_id, f"Payment failed for {invoice.number} (day {attempt_day})", body, db
    )


async def account_paused(invoice: Invoice, db: AsyncSession) -> None:
    org = await _org(invoice.org_id, db)
    if org is None:
        return
    url = billing_url(org.slug, invoice.id)
    body = (
        f"<p>Paid features for {html.escape(org.name)} are paused because invoice "
        f"<b>{html.escape(invoice.number)}</b> is unpaid. Your courses, learners and "
        f"content are untouched and nothing has been deleted.</p>"
        f"<p>Paying the invoice restores everything immediately.</p>"
        f"{_button(url, 'Pay and resume')}"
    )
    await _send(invoice.org_id, "Paid features paused", body, db)


async def limits_override(org_id: int, until, reason: str, db: AsyncSession) -> None:
    """A superadmin kept the school's plan and limits open while a payment
    settles."""
    org = await _org(org_id, db)
    if org is None:
        return
    body = (
        f"<p>We've kept full access open for {html.escape(org.name)} until "
        f"<b>{until:%d %b %Y, %H:%M} UTC</b> while your payment is confirmed.</p>"
        f"<p>Note from our team: {html.escape(reason)}</p>"
        f"<p>No action is needed if your payment goes through. If it doesn't, "
        f"please pay before then to keep your plan's features.</p>"
        f"{_button(billing_url(org.slug), 'View billing')}"
    )
    await _send(org_id, "We've kept your plan open while your payment clears", body, db)


async def receipt(invoice: Invoice, db: AsyncSession) -> None:
    org = await _org(invoice.org_id, db)
    if org is None:
        return
    body = (
        f"<p>Thanks — invoice <b>{html.escape(invoice.number)}</b> for "
        f"{html.escape(org.name)} is paid ({html.escape(invoice.paid_via or 'card')}).</p>"
        f"{_lines_table(invoice)}"
    )
    await _send(invoice.org_id, f"Receipt for {invoice.number}", body, db)
