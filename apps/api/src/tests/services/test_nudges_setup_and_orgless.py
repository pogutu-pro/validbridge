"""Setup checklist ("where you left off"), support links, and the sequence for
users with no organization."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlmodel import select

from src.db.nudges import EmailPreference, NudgeSendStatus, UserNudgeSend
from src.db.users import User
from src.services.nudges import orgless, setup_progress
from src.services.nudges.catalog import NUDGE_CATALOG
from src.services.nudges.eligibility import build_snapshots
from src.services.nudges.runner import _setup_extras
from src.services.nudges.snapshot import OrgSnapshot

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
BASE = "https://acme.test"


def snap(**kw) -> OrgSnapshot:
    base = dict(org_id=1, org_slug="acme", org_name="Acme", plan="starter", lang="en", now=NOW)
    base.update(kw)
    return OrgSnapshot(**base)


def spec(track: str):
    return next(s for s in NUDGE_CATALOG if s.track == track)


# ── Checklist ────────────────────────────────────────────────────────────────

class TestChecklist:
    @pytest.mark.parametrize("role,keys", [
        ("admin", ["brand", "teachers", "course", "learners"]),
        ("teacher", ["course", "content", "publish", "learners"]),
        ("creator", ["course", "content", "payouts", "offer"]),
        ("company", ["groups", "learners", "course", "publish"]),
        (None, ["course", "content", "publish", "learners"]),
    ])
    def test_steps_follow_the_role(self, role, keys):
        items = setup_progress.setup_checklist(snap(onboarding_role=role), BASE)
        assert [i.key for i in items] == keys
        assert not any(i.done for i in items)

    def test_done_comes_from_real_data(self):
        s = snap(onboarding_role="creator", course_count=1, activity_count=3,
                 payouts_ready=True, public_offer_count=0, newest_course_uuid="course_abc")
        items = {i.key: i for i in setup_progress.setup_checklist(s, BASE)}
        assert items["course"].done and items["content"].done and items["payouts"].done
        assert not items["offer"].done
        assert items["offer"].url == f"{BASE}/dash/payments/offers"
        assert items["content"].url.startswith(f"{BASE}/dash/courses/course/abc")

    def test_teachers_are_not_counted_as_learners(self):
        # Three non-admin members, two of them teachers (maintainers).
        s = snap(onboarding_role="admin", member_count=3, staff_count=2, admin_count=1)
        items = {i.key: i.done for i in setup_progress.setup_checklist(s, BASE)}
        assert items["teachers"] is True
        assert items["learners"] is True  # one real learner
        s = snap(onboarding_role="admin", member_count=2, staff_count=2, admin_count=1)
        assert {i.key: i.done for i in setup_progress.setup_checklist(s, BASE)}["learners"] is False


class TestSetupExtras:
    def test_setup_tracks_get_checklist_and_both_contact_options(self, monkeypatch):
        monkeypatch.setattr(
            "config.config.get_validbridge_config",
            lambda: SimpleNamespace(contact_email="hello@validbridge.co.ke"),
        )
        checklist, support = _setup_extras(spec("activation"), snap(), BASE)
        assert checklist and checklist[0][0] == "Create your first course"
        assert support["whatsapp_url"].startswith("https://wa.me/254792475624?text=Hi%20ValidBridge")
        assert "Acme" in support["whatsapp_url"].replace("%20", " ")
        assert support["email_url"].startswith("mailto:hello@validbridge.co.ke?subject=")
        assert support["help_url"] == "https://help.validbridge.co.ke/getting-started"

    def test_finished_setup_or_other_tracks_get_nothing(self):
        done = snap(course_count=1, activity_count=1, published_course_count=1, member_count=1)
        assert _setup_extras(spec("activation"), done, BASE) == (None, None)
        assert _setup_extras(spec("monetization"), snap(), BASE) == (None, None)

    def test_whatsapp_number_is_configurable(self, monkeypatch):
        monkeypatch.setenv("VALIDBRIDGE_SUPPORT_WHATSAPP", "+254 700 000 000")
        assert setup_progress.whatsapp_url("hi").startswith("https://wa.me/254700000000?")


class TestRendering:
    def test_nudge_shows_checklist_next_step_and_support(self):
        from src.services.users import emails

        with patch.object(emails, "send_email", return_value=True) as send:
            emails.send_nudge_email(
                nudge_id="activation.first_course_d1", email="a@x.com", org_name="Acme",
                cta_url=f"{BASE}/dash/courses", unsubscribe_url="https://u", lang="en",
                checklist=[("Add your logo", True, "https://b"), ("Invite your teachers", False, "https://t"),
                           ("Create your first course", False, "https://c")],
                support={"whatsapp_url": "https://wa.me/1?text=x", "email_url": "mailto:a@b?subject=s",
                         "help_url": "https://help.test/getting-started"},
            )
        body = send.call_args.kwargs["body"]
        assert "Where you left off" in body
        assert body.count("Next step") == 1  # only the first open step
        assert body.index("Next step") > body.index("Invite your teachers")
        assert "line-through" in body  # done step
        for text in ("Want a hand?", "Chat on WhatsApp", "Email us", "https://wa.me/1?text=x",
                     "getting-started guide"):
            assert text in body, text

    def test_nudge_without_extras_is_unchanged(self):
        from src.services.users import emails

        with patch.object(emails, "send_email", return_value=True) as send:
            emails.send_nudge_email(
                nudge_id="activation.first_course_d1", email="a@x.com", org_name="Acme",
                cta_url=f"{BASE}/dash/courses", unsubscribe_url="https://u", lang="en",
            )
        body = send.call_args.kwargs["body"]
        assert "Where you left off" not in body and "Want a hand?" not in body


# ── Snapshot signals ─────────────────────────────────────────────────────────

class TestSnapshotSignals:
    async def test_role_payouts_offers_groups_staff(self, db, org, admin_user, regular_user):
        from src.db.organization_config import OrganizationConfig
        from src.db.payments.payments import PaymentsConfig
        from src.db.payments.payments_offers import PaymentsOffer
        from src.db.usergroups import UserGroup

        config = (await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )).scalars().first()
        if config is None:
            config = OrganizationConfig(org_id=org.id, config={})
        config.config = {**(config.config or {}), "onboarding": {"role": "creator"}}
        db.add(config)
        db.add(PaymentsConfig(org_id=org.id, active=True, enabled=True, provider_config={}))
        db.add(PaymentsOffer(offer_uuid="o1", org_id=org.id, name="x", amount=1.0,
                             is_publicly_listed=True))
        db.add(PaymentsOffer(offer_uuid="o2", org_id=org.id, name="y", amount=1.0,
                             is_publicly_listed=True, is_archived=True))
        db.add(UserGroup(org_id=org.id, name="Team A", description="", usergroup_uuid="ug_1",
                         creation_date="", update_date=""))
        await db.commit()

        s = (await build_snapshots(db, [org]))[0]
        assert s.onboarding_role == "creator"
        assert s.payouts_ready is True
        assert s.public_offer_count == 1  # archived offer excluded
        assert s.usergroup_count == 1


# ── Users with no organization ───────────────────────────────────────────────

async def _orgless_user(db, uid, days_ago, verified=True, email=None):
    user = User(
        id=uid, username=f"u{uid}", first_name="Amina", last_name="K",
        email=email or f"u{uid}@test.com", user_uuid=f"user_{uid}", email_verified=verified,
        creation_date=str((NOW - timedelta(days=days_ago)).replace(tzinfo=None)),
    )
    db.add(user)
    await db.commit()
    return user


@pytest.fixture
def platform(monkeypatch):
    monkeypatch.setattr(orgless, "_configured_frontend_base_url", lambda: "https://validbridge.test")
    monkeypatch.setattr(orgless, "get_media_base_url", lambda: "https://api.validbridge.test")


async def _run(db, **kw):
    with patch.object(orgless, "send_nudge_email", return_value={"id": "m1"}) as send:
        stats = await orgless.run_orgless_nudges(
            db, force=True, now=NOW, activation=NOW - timedelta(days=90), **kw
        )
    return stats, send


class TestOrgless:
    def test_weekly_windows_for_one_month(self):
        assert [orgless.nudge_for_age(d).id if orgless.nudge_for_age(d) else None
                for d in (6, 7, 9, 10, 14, 21, 28, 30, 31)] == [
            None, "orgless.get_started_d7", "orgless.get_started_d7", None,
            "orgless.two_ways_d14", "orgless.we_can_help_d21", "orgless.last_note_d28",
            "orgless.last_note_d28", None,
        ]

    async def test_sends_the_due_email_once_with_name_and_help(self, db, platform):
        await _orgless_user(db, 501, days_ago=7.5)
        stats, send = await _run(db)
        assert stats.sent == 1
        kw = send.call_args.kwargs
        assert kw["nudge_id"] == "orgless.get_started_d7"
        assert kw["name"] == "Amina"
        assert kw["cta_url"] == "https://validbridge.test/new"
        assert kw["footer_key"] == "nudge.common.footer_account"
        assert kw["support"]["whatsapp_url"].startswith("https://wa.me/254792475624")
        rows = (await db.execute(select(UserNudgeSend))).scalars().all()
        assert [r.status for r in rows] == [NudgeSendStatus.SENT]

        stats, send = await _run(db)  # same day again: never twice
        assert stats.sent == 0 and stats.skipped_dedupe == 1
        send.assert_not_called()

    async def test_skips_members_unverified_optouts_old_and_out_of_window(
        self, db, platform, regular_user
    ):
        # regular_user belongs to an org — make it look newly signed up anyway.
        member = (await db.execute(select(User).where(User.id == regular_user.id))).scalars().first()
        member.creation_date = str((NOW - timedelta(days=7.5)).replace(tzinfo=None))
        db.add(member)
        await _orgless_user(db, 601, days_ago=7.5, verified=False)
        opted = await _orgless_user(db, 602, days_ago=14.5)
        db.add(EmailPreference(user_id=opted.id, lifecycle_opt_out=True))
        await _orgless_user(db, 603, days_ago=11)   # between windows
        await _orgless_user(db, 604, days_ago=45)   # past the month
        await db.commit()

        stats, send = await _run(db)
        assert stats.sent == 0
        assert stats.skipped_optout == 1
        send.assert_not_called()

    async def test_accounts_older_than_the_system_are_not_mailed(self, db, platform):
        await _orgless_user(db, 701, days_ago=8)
        with patch.object(orgless, "send_nudge_email", return_value=True) as send:
            stats = await orgless.run_orgless_nudges(db, force=True, now=NOW, activation=NOW - timedelta(days=2))
        assert stats.sent == 0
        send.assert_not_called()

    async def test_disabled_unless_switched_on(self, db, platform, monkeypatch):
        monkeypatch.delenv("VALIDBRIDGE_NUDGES_ENABLED", raising=False)
        await _orgless_user(db, 801, days_ago=7.5)
        with patch("src.services.nudges.orgless.get_deployment_mode", return_value="saas"), \
             patch.object(orgless, "send_nudge_email") as send:
            stats = await orgless.run_orgless_nudges(db, now=NOW, activation=NOW - timedelta(days=90))
        assert stats.sent == 0
        send.assert_not_called()

    async def test_failed_send_is_recorded_not_retried_as_sent(self, db, platform):
        await _orgless_user(db, 901, days_ago=21.5)
        with patch.object(orgless, "send_nudge_email", return_value=False):
            stats = await orgless.run_orgless_nudges(db, force=True, now=NOW, activation=NOW - timedelta(days=90))
        assert stats.failed == 1
        row = (await db.execute(select(UserNudgeSend))).scalars().first()
        assert row.status == NudgeSendStatus.FAILED and row.nudge_id == "orgless.we_can_help_d21"


class TestOrglessEmailRenders:
    def test_platform_branded_with_account_footer(self):
        from src.services.users import emails

        with patch.object(emails, "send_email", return_value=True) as send:
            emails.send_nudge_email(
                nudge_id="orgless.get_started_d7", email="a@x.com", org_name="ValidBridge",
                cta_url="https://validbridge.test/new", unsubscribe_url="https://u", lang="en",
                logo_url=emails.PLATFORM_LOGO_URL, powered_by=False,
                footer_key="nudge.common.footer_account", name="Amina",
                support={"whatsapp_url": "https://wa.me/1?text=x"},
            )
        kw = send.call_args.kwargs
        assert kw["subject"] == "Amina, you're one step away"
        assert "signed up for ValidBridge" in kw["body"]
        assert "admin of" not in kw["body"]
        assert "Continue setup" in kw["body"]
