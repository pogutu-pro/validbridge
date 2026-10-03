"""
"Where you left off": a setup checklist and a way to reach a person.

The checklist is built only from facts the snapshot can prove — a logo is on
file, a course exists, a member joined — never from page visits, so an email
never claims a step is done (or missing) when it is not. Each role gets the
steps that matter for it, mirroring the first-week list it saw on /new and in
the in-app onboarding (``useOnboarding.ROLE_STEPS``); steps with no server-side
signal (opening analytics, sharing a link) are left out rather than guessed.

The support block offers the two ways people in our market actually ask for
help: WhatsApp (prefilled, to the support number) and email (prefilled, to the
configured contact address), plus the public getting-started guide.
"""

import os
from dataclasses import dataclass
from typing import Optional
from urllib.parse import quote

from src.services.nudges import links
from src.services.nudges.snapshot import OrgSnapshot

# The number people reach on WhatsApp (international form, no "+"). The user
# supplied 0792 475 624; overridable without a deploy.
DEFAULT_SUPPORT_WHATSAPP = "254792475624"
DEFAULT_HELP_CENTER_URL = "https://help.validbridge.co.ke"


@dataclass(frozen=True)
class SetupItem:
    key: str      # translation suffix: nudge.common.setup.<key>
    done: bool
    url: str


def _student_count(s: OrgSnapshot) -> int:
    # member_count counts every non-admin; teachers (maintainers) are part of
    # staff_count, and extra admins never were members.
    extra_admins = max(s.admin_count - 1, 0)
    maintainers = max(s.staff_count - extra_admins, 0)
    return max(s.member_count - maintainers, 0)


def setup_checklist(s: OrgSnapshot, base: str) -> list[SetupItem]:
    """The steps for this org's role, each marked done from real data."""
    add_people = f"{base}/dash/users/settings/add"
    course_target = (
        links.course_editor_url(base, s.newest_course_uuid, "content")
        if s.newest_course_uuid
        else links.courses_url(base)
    )
    item = {
        "brand": SetupItem("brand", bool(s.logo_image or s.square_logo_image),
                           links.org_settings_url(base, "branding")),
        "teachers": SetupItem("teachers", s.staff_count > 0, add_people),
        "course": SetupItem("course", s.course_count > 0, links.courses_url(base)),
        "content": SetupItem("content", s.activity_count > 0, course_target),
        "publish": SetupItem("publish", s.published_course_count > 0, links.courses_url(base)),
        "learners": SetupItem("learners", _student_count(s) > 0, add_people),
        "payouts": SetupItem("payouts", s.payouts_ready, f"{base}/dash/payments/configuration"),
        "offer": SetupItem("offer", s.public_offer_count > 0, f"{base}/dash/payments/offers"),
        "groups": SetupItem("groups", s.usergroup_count > 0,
                            f"{base}/dash/users/settings/usergroups"),
    }
    order = {
        "admin": ("brand", "teachers", "course", "learners"),
        "teacher": ("course", "content", "publish", "learners"),
        "creator": ("course", "content", "payouts", "offer"),
        "company": ("groups", "learners", "course", "publish"),
    }.get(s.onboarding_role or "", ("course", "content", "publish", "learners"))
    return [item[key] for key in order]


def setup_complete(s: OrgSnapshot, base: str = "") -> bool:
    return all(i.done for i in setup_checklist(s, base))


def help_center_url(path: str = "getting-started") -> str:
    base = (os.environ.get("VALIDBRIDGE_HELP_CENTER_URL") or DEFAULT_HELP_CENTER_URL).rstrip("/")
    return f"{base}/{path}" if path else base


def whatsapp_url(prefill: str) -> Optional[str]:
    number = "".join(
        ch for ch in (os.environ.get("VALIDBRIDGE_SUPPORT_WHATSAPP") or DEFAULT_SUPPORT_WHATSAPP)
        if ch.isdigit()
    )
    if not number:
        return None
    return f"https://wa.me/{number}?text={quote(prefill, safe='')}"


def email_url(subject: str, body: str) -> Optional[str]:
    try:
        from config.config import get_validbridge_config

        address = (get_validbridge_config().contact_email or "").strip()
    except Exception:  # pragma: no cover - config is always present in practice
        address = ""
    if not address:
        return None
    return f"mailto:{address}?subject={quote(subject, safe='')}&body={quote(body, safe='')}"
