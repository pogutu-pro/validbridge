"""
Lifecycle mail for people who signed up but belong to no organization.

The org catalog cannot reach them — every nudge there is anchored on an
organization — yet "signed up, never joined or created a school" is the first
place people fall out. Four emails, a week apart, for the first month: join
your school or create your own, with a person to help. Nothing after day 30.

Same guardrails as the org runner, deliberately: SaaS only, off until
``VALIDBRIDGE_NUDGES_ENABLED``, opt-outs and suppressed addresses honoured, a
per-run budget, and a ledger row claimed before each send so a crash or an
overlapping run cannot send twice. Accounts created before the system's
activation date are never mailed, so switching it on does not reach history.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import exists
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.core.deployment_mode import get_deployment_mode
from src.db.nudges import NudgeSendStatus, UserNudgeSend
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.email.translations import t
from src.services.email.utils import _configured_frontend_base_url, get_media_base_url
from src.services.nudges import links, setup_progress
from src.services.nudges.preferences import get_opted_out_user_ids
from src.services.nudges.snapshot import parse_ts
from src.services.users.emails import PLATFORM_LOGO_URL, display_name, send_nudge_email

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OrglessNudge:
    id: str
    day_min: int
    day_max: int


# Two-day windows, like the org catalog: creation timestamps are accurate to
# about a day, and the dedupe key stops a window from firing twice.
ORGLESS_CATALOG: tuple[OrglessNudge, ...] = (
    OrglessNudge("orgless.get_started_d7", 7, 9),
    OrglessNudge("orgless.two_ways_d14", 14, 16),
    OrglessNudge("orgless.we_can_help_d21", 21, 23),
    OrglessNudge("orgless.last_note_d28", 28, 30),
)
ORGLESS_MAX_AGE_DAYS = max(n.day_max for n in ORGLESS_CATALOG)


@dataclass
class OrglessStats:
    considered: int = 0
    sent: int = 0
    failed: int = 0
    skipped_dedupe: int = 0
    skipped_optout: int = 0
    budget_exhausted: bool = False
    by_nudge: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "considered": self.considered, "sent": self.sent, "failed": self.failed,
            "skipped_dedupe": self.skipped_dedupe, "skipped_optout": self.skipped_optout,
            "budget_exhausted": self.budget_exhausted, "by_nudge": dict(self.by_nudge),
        }


def nudge_for_age(age_days: float) -> Optional[OrglessNudge]:
    for nudge in ORGLESS_CATALOG:
        if nudge.day_min <= age_days <= nudge.day_max:
            return nudge
    return None


def _age_days(created: Optional[datetime], now: datetime) -> Optional[float]:
    if created is None:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (now - created).total_seconds() / 86400


async def _candidates(db_session: AsyncSession, now: datetime) -> list[User]:
    """Verified, non-staff users with no organization, signed up in the window.

    ``creation_date`` is a string column, so the window is applied in Python
    after a cheap SQL pre-filter on membership; the result is small (only
    accounts that never joined anything).
    """
    has_membership = exists().where(UserOrganization.user_id == User.id)
    rows = (
        await db_session.execute(
            select(User).where(
                ~has_membership,
                User.email_verified.is_(True),
                User.is_superadmin.is_(False),
            )
        )
    ).scalars().all()
    oldest = now - timedelta(days=ORGLESS_MAX_AGE_DAYS + 1)
    out = []
    for user in rows:
        created = parse_ts(user.creation_date)
        if created is None:
            continue
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created >= oldest:
            out.append(user)
    return out


async def _claim(
    db_session: AsyncSession, nudge: OrglessNudge, user: User, now: datetime, dry_run: bool
) -> Optional[UserNudgeSend]:
    key = f"{'dryrun:' if dry_run else ''}{nudge.id}:{user.id}"
    row = UserNudgeSend(
        nudge_id=nudge.id,
        dedupe_key=key,
        user_id=user.id,
        status=NudgeSendStatus.DRY_RUN if dry_run else NudgeSendStatus.CLAIMED,
        claimed_at=now,
    )
    db_session.add(row)
    try:
        await db_session.commit()
    except IntegrityError:
        await db_session.rollback()
        return None
    await db_session.refresh(row)
    return row


def _support(lang: str) -> dict:
    return {
        "help_url": setup_progress.help_center_url(),
        "whatsapp_url": setup_progress.whatsapp_url(t(lang, "nudge.common.whatsapp_prefill_orgless")),
        "email_url": setup_progress.email_url(
            t(lang, "nudge.common.email_subject_orgless"),
            t(lang, "nudge.common.email_body_orgless"),
        ),
    }


async def run_orgless_nudges(
    db_session: AsyncSession,
    *,
    dry_run: bool = False,
    max_sends: int = 500,
    now: Optional[datetime] = None,
    force: bool = False,
    activation: Optional[datetime] = None,
) -> OrglessStats:
    """Send what is due to users with no organization."""
    from src.services.nudges.runner import activation_date, nudges_enabled

    stats = OrglessStats()
    now = now or datetime.now(timezone.utc)

    if not force and get_deployment_mode() != "saas":
        return stats
    if not force and not dry_run and not nudges_enabled():
        return stats

    platform = _configured_frontend_base_url()
    if not platform:
        logger.warning("Org-less nudges skipped: no platform URL configured")
        return stats
    media_base = get_media_base_url()
    cutoff = activation or await activation_date(db_session, now=now)
    lang = "en"  # users carry no language preference; English is the source copy

    candidates = await _candidates(db_session, now)
    opted_out = await get_opted_out_user_ids(db_session, [u.id for u in candidates])

    for user in candidates:
        created = parse_ts(user.creation_date)
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        # Accounts older than the system are history, not a sequence to start.
        if created is None or created < cutoff:
            continue
        nudge = nudge_for_age(_age_days(created, now))
        if nudge is None:
            continue
        stats.considered += 1
        if user.id in opted_out:
            stats.skipped_optout += 1
            continue
        if stats.sent >= max_sends:
            stats.budget_exhausted = True
            break

        row = await _claim(db_session, nudge, user, now, dry_run)
        if row is None:
            stats.skipped_dedupe += 1
            continue
        if dry_run:
            stats.by_nudge[nudge.id] = stats.by_nudge.get(nudge.id, 0) + 1
            logger.info("[dry-run] %s -> %s", nudge.id, user.email)
            continue

        result = send_nudge_email(
            nudge_id=nudge.id,
            email=user.email,
            org_name="ValidBridge",
            cta_url=f"{platform}/new",
            unsubscribe_url=links.unsubscribe_url(media_base, user.user_uuid),
            lang=lang,
            logo_url=PLATFORM_LOGO_URL,
            track="activation",
            powered_by=False,
            support=_support(lang),
            # Not "you're an admin of …": these readers belong to no org.
            footer_key="nudge.common.footer_account",
            name=display_name(user),
        )
        if result is False:
            row.status = NudgeSendStatus.FAILED
            row.error = "provider rejected or unavailable"
            stats.failed += 1
        else:
            row.status = NudgeSendStatus.SENT
            row.sent_at = now
            stats.sent += 1
            stats.by_nudge[nudge.id] = stats.by_nudge.get(nudge.id, 0) + 1
        db_session.add(row)
        await db_session.commit()

    logger.info("Org-less nudge run finished: %s", stats.as_dict())
    return stats
