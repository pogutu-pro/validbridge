import html
import logging
from typing import Optional
from urllib.parse import quote

from pydantic import EmailStr
from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.email.translations import t
from src.services.email.utils import send_email

logger = logging.getLogger(__name__)


def _send_notification_email(**kwargs):
    """Send mail whose failure must not fail the caller's request.

    Welcome/lifecycle notifications are a side effect of an action that has
    already happened and been committed — the account exists, the org was
    created, the role changed. When the provider is rate-limited or times out,
    raising here turned "no welcome email" into "signup returned 503", which the
    user then retried. Delivery failures are logged and swallowed instead.

    Mail the user is actively waiting on (password reset, invitation, address
    verification) still calls ``send_email`` directly and still raises.
    """
    try:
        return send_email(**kwargs)
    except Exception as e:
        logger.warning("Non-critical email to %s not sent: %s", kwargs.get("to"), e)
        return False


# Public academy — footer "learn more" target, and last-resort CTA fallback.
ACADEMY_URL = "https://university.validbridge.co.ke"


# ValidBridge mark + wordmark for platform (non-org) emails. A hosted PNG, not
# inline SVG: Gmail and Outlook strip inline <svg>, which left these emails with
# no logo. The file is apps/web/public/validbridge-email-logo.png (508×84, 3x
# this display size) served from the marketing site.
PLATFORM_LOGO_URL = "https://validbridge.co.ke/validbridge-email-logo.png"
PLATFORM_LOGO_HTML = (
    f'<img src="{PLATFORM_LOGO_URL}" alt="ValidBridge" width="145" height="24" '
    'style="display: inline-block; width: 145px; height: 24px; border: 0; outline: none; text-decoration: none;">'
)

# Shared email styles matching the platform's design system
STYLES = {
    "body": "margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
    "wrapper": "padding: 48px 24px;",
    "container": "max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e5e5e5;",
    "header": "padding: 48px 48px 0 48px; text-align: center;",
    "content": "padding: 36px 48px 48px 48px; text-align: center;",
    "h1": "margin: 0 0 12px 0; font-size: 22px; font-weight: 900; color: #000000; letter-spacing: -0.02em; line-height: 1.3;",
    "p": "margin: 0 0 20px 0; font-size: 14px; color: rgba(0,0,0,0.45); font-weight: 500; line-height: 1.7;",
    "button": "display: inline-block; padding: 14px 32px; background-color: #000000; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 14px; font-weight: 700; line-height: 1;",
    "link_text": "margin: 24px 0 0 0; font-size: 11px; color: rgba(0,0,0,0.2); word-break: break-all; font-weight: 500; line-height: 1.6;",
    "divider": "margin: 28px 0; border: none; border-top: 1px solid #f0f0f0;",
    "footer": "padding: 0 48px 40px 48px; text-align: center;",
    "footer_text": "margin: 0; font-size: 12px; color: rgba(0,0,0,0.2); font-weight: 500; line-height: 1.6;",
    "code": "display: inline-block; padding: 14px 28px; background-color: #fafafa; border: 1px solid #e5e5e5; border-radius: 10px; font-size: 28px; font-weight: 900; letter-spacing: 0.12em; color: #000000; font-family: monospace;",
}


# Media directory of the square logo variant (see ``upload_org_square_logo``).
# The URL path is the one place the shape of an uploaded logo is knowable
# without a database round-trip, so the renderer keys off it.
SQUARE_LOGO_DIR = "/square_logos/"


def _org_logo_img(logo_url: str, alt: str) -> str:
    """<img> for a white-labeled org logo.

    A square logo (uploaded on the branding page, served from
    ``square_logos/``) sits in a 56px rounded box; a wide logo is letterboxed
    into the same footprint as the ValidBridge wordmark. Raster logos (PNG/JPG)
    render in every mail client; an SVG logo may be stripped by some (e.g.
    Gmail), in which case the ``alt`` (the org name) shows instead — still
    org-branded, never a broken ValidBridge mark.

    The ``height``/``width`` attributes are for desktop Outlook, whose
    Word-based renderer ignores ``max-width``/``max-height`` and would
    otherwise paint the upload at its native pixel size; every other client
    lets the inline style win.
    """
    src = html.escape(logo_url)
    safe_alt = html.escape(alt)
    if SQUARE_LOGO_DIR in logo_url:
        return (
            f'<img src="{src}" alt="{safe_alt}" width="56" height="56" '
            'style="width: 56px; height: 56px; object-fit: cover; border-radius: 12px; '
            'display: inline-block; border: 0;" />'
        )
    return (
        f'<img src="{src}" alt="{safe_alt}" height="40" '
        'style="max-height: 40px; max-width: 180px; height: auto; width: auto; '
        'display: inline-block; border: 0;" />'
    )


def _org_wordmark(org_name: str) -> str:
    """The org's name set as a wordmark, for orgs that have not uploaded a logo.

    An org-scoped email must never open with the ValidBridge mark — the
    recipient has a relationship with the academy, not the platform, and a
    foreign logo above "Reset your Acme Academy password" reads as phishing.
    """
    return (
        f'<span style="display: inline-block; font-size: 20px; font-weight: 900; '
        f'color: #000000; letter-spacing: -0.02em; line-height: 1.2;">'
        f"{html.escape(org_name)}</span>"
    )


def _brand_logo_html(logo_url: str | None, org_name: str) -> str:
    """Header mark for an org-branded email: its logo, else its name."""
    if logo_url:
        return _org_logo_img(logo_url, org_name)
    return _org_wordmark(org_name)


def _button_style(brand_color: str | None) -> str:
    """CTA button style, tinted with the org's brand color when it has one.

    ``brand_color`` must already be normalized (``#rrggbb``) — see
    ``services.email.branding.normalize_brand_color``; anything else keeps the
    default black button rather than risk an unbalanced ``style`` attribute.
    """
    from src.services.email.branding import contrasting_text_color, normalize_brand_color

    color = normalize_brand_color(brand_color)
    if not color:
        return STYLES["button"]
    return (
        STYLES["button"]
        .replace("background-color: #000000;", f"background-color: {color};")
        .replace("color: #ffffff;", f"color: {contrasting_text_color(color)};")
    )


def _powered_by_html(lang: str) -> str:
    """The small "Powered by ValidBridge" line under an org-branded footer."""
    from src.services.email.branding import POWERED_BY_URL

    return (
        f'\n            <p style="{STYLES["footer_text"]} margin-top: 12px;">'
        f'<a href="{POWERED_BY_URL}" style="color: rgba(0,0,0,0.35); text-decoration: none;">'
        f'{t(lang, "common.powered_by")}</a></p>'
    )


def _first_sentence(text: str, limit: int = 110) -> str:
    """Opening sentence of a body string, for use as preheader text.

    Handles the full stops of every locale we ship — the CJK ideographic
    period, the Arabic and Devanagari terminators — then falls back to a word
    boundary. Inbox previews are cut around 100 characters anyway.
    """
    if not text:
        return ""

    for terminator in ("。", "۔", "।", ". ", "! ", "? ", "؟ "):
        head, sep, _tail = text.partition(terminator)
        if sep and len(head) <= limit:
            return (head + sep).strip()

    if len(text) <= limit:
        return text.strip()
    return text[:limit].rsplit(" ", 1)[0].strip() + "…"


def _reply_to_address() -> str:
    """Where a reply to a lifecycle email should land, or "" if unconfigured."""
    try:
        from config.config import get_validbridge_config

        return (get_validbridge_config().contact_email or "").strip()
    except Exception:  # pragma: no cover - config is always present in practice
        return ""


def _stat_strip(stats: list[tuple[str, int]]) -> str:
    """A row of label/value pairs, e.g. "LESSONS 8   LEARNERS 0".

    Deliberately not prose. Writing "8 lessons" into copy means solving plural
    agreement in twenty languages — Russian has three forms, Arabic six — and
    without an ICU library the result is "1 lessons" in production. A label
    beside a bare figure needs no agreement in any of them, and it reads faster
    than a sentence anyway.
    """
    if not stats:
        return ""

    cells = []
    for label, value in stats:
        cells.append(
            '<td style="padding: 0 14px; text-align: center;">'
            '<div style="font-size: 22px; font-weight: 900; color: #000000; '
            f'line-height: 1.2;">{value}</div>'
            '<div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; '
            'text-transform: uppercase; color: rgba(0,0,0,0.35); margin-top: 2px;">'
            f"{html.escape(label)}</div>"
            "</td>"
        )

    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'align="center" style="margin: 0 auto 24px auto; border-collapse: collapse;">'
        f"<tr>{''.join(cells)}</tr>"
        "</table>"
    )


def _preheader_block(text: str) -> str:
    """The grey line an inbox list shows after the subject.

    Without one, clients scrape the first visible text — which here is the
    heading, so the list entry reads as the subject said twice. Setting it
    explicitly buys a second line of information in the only place a reader
    looks before deciding to open.

    The zero-width padding after the text stops the client continuing into the
    body copy once the preheader runs out.
    """
    if not text:
        return ""
    padding = "&#847;&zwnj;&nbsp;" * 60
    hide = (
        "display:none;max-height:0;overflow:hidden;mso-hide:all;"
        "font-size:1px;line-height:1px;color:#ffffff;opacity:0;"
    )
    return (
        f'<div style="{hide}">{html.escape(text)}</div>'
        f'<div style="{hide}">{padding}</div>'
    )


def _email_layout(
    title: str,
    body_content: str,
    footer_note: str = "",
    logo_html: str = PLATFORM_LOGO_HTML,
    unsubscribe_url: str = "",
    unsubscribe_label: str = "Unsubscribe from these emails",
    preheader: str = "",
    powered_by: bool = False,
    lang: str = "en",
) -> str:
    """Wrap content in the standard email layout.

    ``logo_html`` defaults to the ValidBridge mark; white-labeled emails pass the
    org's logo <img> (or its name as a wordmark) instead.

    ``powered_by`` adds the "Powered by ValidBridge" line to the footer. Only
    org-branded mail sets it, and only when the org's watermark is on — a
    platform email already carries the ValidBridge mark up top.

    ``unsubscribe_url`` is set only by bulk lifecycle mail. Transactional email
    (password reset, invitation, verification) leaves it empty and renders
    byte-identically to before — you cannot unsubscribe from a password reset.
    The link is deliberately legible rather than hidden: someone who wants out
    and can't find the exit reports spam instead, which costs the sending domain
    far more than the opt-out does.
    """
    note_html = ""
    if footer_note:
        note_html = f'\n            <p style="{STYLES["footer_text"]}">{footer_note}</p>'

    unsub_html = ""
    if unsubscribe_url:
        unsub_html = (
            f'\n            <p style="{STYLES["footer_text"]} margin-top: 12px;">'
            f'<a href="{html.escape(unsubscribe_url)}" '
            'style="color: rgba(0,0,0,0.35); text-decoration: underline;">'
            f'{html.escape(unsubscribe_label)}</a></p>'
        )

    powered_html = _powered_by_html(lang) if powered_by else ""

    footer_html = ""
    if note_html or unsub_html or powered_html:
        footer_html = f"""
        <div style="{STYLES['footer']}">
            <hr style="{STYLES['divider']}" />{note_html}{unsub_html}{powered_html}
        </div>"""

    # Prefixed with its own newline so that an absent preheader leaves the
    # document byte-identical to before — the twelve transactional emails
    # share this layout and none of their output may shift.
    block = _preheader_block(preheader)
    preheader_html = f"\n    {block}" if block else ""

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="{STYLES['body']}">{preheader_html}
    <div style="{STYLES['wrapper']}">
        <div style="{STYLES['container']}">
            <div style="{STYLES['header']}">
                {logo_html}
            </div>
            <div style="{STYLES['content']}">
                {body_content}
            </div>
            {footer_html}
        </div>
    </div>
</body>
</html>"""


# Every key the rich welcome renders. A locale gets the rich version only if it
# ships all of them; otherwise the short welcome, which every locale has, so a
# reader never gets a mail that switches language halfway down.
# Paths a new account can take, in the order /new offers them. Each links to
# /new?role=<id>, which opens setup straight after the role question.
WELCOME_PATHS = ("admin", "teacher", "creator", "company", "student")

_RICH_WELCOME_KEYS = (
    "account_creation.intro",
    "account_creation.paths_title",
    *(f"account_creation.path_{p}_{part}" for p in WELCOME_PATHS for part in ("title", "body")),
    "account_creation.public_note",
    "account_creation.features_title",
    "account_creation.feature_live", "account_creation.feature_assess",
    "account_creation.feature_certs", "account_creation.feature_analytics",
    "account_creation.cta_start", "account_creation.invited_note",
    "account_creation.help_reply",
)
_RICH_ORG_WELCOME_KEYS = (
    "account_creation.org_intro",
    "account_creation.org_point1", "account_creation.org_point2", "account_creation.org_point3",
    "account_creation.org_cta",
)


def _locale_has(lang: str, keys: tuple[str, ...]) -> bool:
    from src.services.email.translations import EMAIL_TRANSLATIONS, normalize_language

    bundle = EMAIL_TRANSLATIONS.get(normalize_language(lang)) or {}
    return all(bundle.get(key) for key in keys)


def display_name(user) -> str:
    """What to call someone: their first name (from Google or the signup
    form), else their username. Never an empty greeting."""
    first = (getattr(user, "first_name", None) or "").strip()
    return first or (getattr(user, "username", None) or "").strip() or "there"


def _platform_origin(url: str | None) -> str | None:
    """``https://host`` of a platform URL, for building sibling links."""
    from urllib.parse import urlsplit

    if not url:
        return None
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def _path_links(rows: list[tuple[str, str, str]]) -> str:
    """"What brings you here?" choices: each row is a full-width link card."""
    cells = []
    for href, title, body in rows:
        cells.append(
            "<tr><td style=\"padding: 0 0 8px 0;\">"
            f'<a href="{html.escape(href)}" style="display: block; text-decoration: none; '
            'border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px 14px; '
            'background-color: #ffffff; text-align: left;">'
            '<span style="display: block; font-size: 14px; font-weight: 800; color: #000000; '
            f'line-height: 1.4;">{title} <span style="color: rgba(0,0,0,0.3);">&rarr;</span></span>'
            '<span style="display: block; font-size: 12px; color: rgba(0,0,0,0.5); font-weight: 500; '
            f'line-height: 1.5; margin-top: 2px;">{body}</span>'
            "</a></td></tr>"
        )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse: collapse;">{"".join(cells)}</table>'
    )


def _section_title(text: str) -> str:
    return (
        '<p style="margin: 0 0 14px 0; font-size: 11px; font-weight: 800; '
        'letter-spacing: 0.08em; text-transform: uppercase; color: rgba(0,0,0,0.35); '
        f'text-align: left;">{text}</p>'
    )


def _numbered_steps(steps: list[tuple[str, str]], accent: str) -> str:
    """Numbered checklist as a table: lists and flexbox render inconsistently
    across Gmail/Outlook, a table renders the same everywhere."""
    from src.services.email.branding import contrasting_text_color

    badge_text = contrasting_text_color(accent)
    rows = []
    for number, (title, body) in enumerate(steps, start=1):
        rows.append(
            "<tr>"
            '<td valign="top" style="padding: 0 14px 18px 0; width: 28px;">'
            f'<div style="width: 26px; height: 26px; line-height: 26px; border-radius: 13px; '
            f'background-color: {accent}; color: {badge_text}; font-size: 13px; font-weight: 800; '
            f'text-align: center;">{number}</div></td>'
            '<td valign="top" style="padding: 0 0 18px 0; text-align: left;">'
            f'<div style="font-size: 14px; font-weight: 800; color: #000000; line-height: 1.4;">{title}</div>'
            f'<div style="font-size: 13px; color: rgba(0,0,0,0.5); font-weight: 500; line-height: 1.6; '
            f'margin-top: 2px;">{body}</div></td>'
            "</tr>"
        )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse: collapse; margin: 0 0 8px 0;">{"".join(rows)}</table>'
    )


def _check_list(items: list[str]) -> str:
    rows = "".join(
        "<tr>"
        '<td valign="top" style="padding: 0 10px 10px 0; width: 16px; font-size: 14px; '
        'font-weight: 900; color: #16a34a; line-height: 1.5;">&#10003;</td>'
        '<td valign="top" style="padding: 0 0 10px 0; text-align: left; font-size: 13px; '
        f'color: rgba(0,0,0,0.6); font-weight: 500; line-height: 1.5;">{item}</td>'
        "</tr>"
        for item in items
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse: collapse;">{rows}</table>'
    )


def _panel(inner: str) -> str:
    return (
        '<div style="background-color: #fafafa; border: 1px solid #f0f0f0; border-radius: 12px; '
        f'padding: 18px 20px 8px 20px; margin: 0 0 28px 0; text-align: left;">{inner}</div>'
    )


def send_account_creation_email(
    user: UserRead,
    email: EmailStr,
    lang: str = "en",
    cta_url: str | None = None,
    org_name: str | None = None,
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Welcome email sent once an account exists.

    ``cta_url`` is where the main button lands: the org-scoped URL when the
    account was created inside an org, or the platform org-picker for org-less
    signups. Falls back to the public academy when no URL is supplied.

    Org-less signups (people starting a school) get the ValidBridge welcome:
    three first steps, what is included, and a way to reach a person. When
    ``org_name`` is set the email is WHITE-LABELED to that organization — a
    learner's welcome naming the org, with its logo (or name), button colour
    and an optional "Powered by ValidBridge" line; it never markets ValidBridge.

    Locales without the rich copy get the short welcome, fully translated.
    """
    # Greet people by name; the template placeholder is still {username}.
    safe_username = html.escape(display_name(user))
    white_label = bool(org_name)
    safe_org = html.escape(org_name) if org_name else ""
    target = html.escape(cta_url or ACADEMY_URL)
    heading = t(lang, "account_creation.heading", username=safe_username)
    preheader = ""

    if white_label:
        subject = t(lang, "account_creation.subject_org", org_name=safe_org, username=safe_username)
        footer_note = ""
        logo_html = _brand_logo_html(logo_url, org_name)
        button = _button_style(brand_color)
        if _locale_has(lang, _RICH_ORG_WELCOME_KEYS):
            intro = t(lang, "account_creation.org_intro", org_name=safe_org)
            preheader = _first_sentence(t(lang, "account_creation.org_intro", org_name=org_name))
            body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{intro}</p>
        {_panel(_check_list([t(lang, f"account_creation.org_point{n}") for n in (1, 2, 3)]))}
        <a href="{target}" style="{button}">{t(lang, "account_creation.org_cta")}</a>
    """
        else:
            body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{t(lang, "account_creation.body_in_org", org_name=safe_org)}</p>
        <a href="{target}" style="{button}">{t(lang, "account_creation.cta")}</a>
    """
    else:
        subject = t(lang, "account_creation.subject", username=safe_username)
        logo_html = PLATFORM_LOGO_HTML
        academy_link = (
            f'<a href="{ACADEMY_URL}" '
            'style="color: rgba(0,0,0,0.35); text-decoration: underline;">'
            f'{t(lang, "academy_link_text")}</a>'
        )
        origin = _platform_origin(cta_url)
        if origin and _locale_has(lang, _RICH_WELCOME_KEYS):
            intro = t(lang, "account_creation.intro")
            preheader = _first_sentence(intro)
            paths = [
                (
                    f"{origin}/new?role={path}",
                    t(lang, f"account_creation.path_{path}_title"),
                    t(lang, f"account_creation.path_{path}_body"),
                )
                for path in WELCOME_PATHS
            ]
            features = [
                t(lang, f"account_creation.feature_{key}")
                for key in ("live", "assess", "certs", "analytics")
            ]
            # Replies only promise a person when replies actually reach one.
            footer_note = (
                t(lang, "account_creation.help_reply", academy_link=academy_link)
                if _reply_to_address()
                else t(lang, "account_creation.footer", academy_link=academy_link)
            )
            body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{intro}</p>
        <div style="text-align: left; margin: 0 0 8px 0;">
            {_section_title(t(lang, "account_creation.paths_title"))}
            {_path_links(paths)}
        </div>
        <p style="margin: 6px 0 24px 0; font-size: 12px; color: rgba(0,0,0,0.45); font-weight: 500; line-height: 1.6; text-align: left;">
            {t(lang, "account_creation.public_note")}
        </p>
        <a href="{target}" style="{STYLES['button']}">{t(lang, "account_creation.cta_start")}</a>
        <p style="margin: 14px 0 0 0; font-size: 12px; color: rgba(0,0,0,0.35); font-weight: 500; line-height: 1.6;">
            {t(lang, "account_creation.invited_note")}
        </p>
        <hr style="{STYLES['divider']}">
        <div style="text-align: left;">
            {_section_title(t(lang, "account_creation.features_title"))}
            {_check_list(features)}
        </div>
    """
        else:
            footer_note = t(lang, "account_creation.footer", academy_link=academy_link)
            body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{t(lang, "account_creation.body")}</p>
        <a href="{target}" style="{STYLES['button']}">{t(lang, "account_creation.cta")}</a>
    """

    headers: dict[str, str] = {}
    reply_to = _reply_to_address()
    if reply_to and not white_label:
        headers["Reply-To"] = reply_to

    return _send_notification_email(
        to=email,
        subject=subject,
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=footer_note,
            logo_html=logo_html,
            preheader=preheader,
            powered_by=white_label and powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
        **({"headers": headers} if headers else {}),
    )


_ORG_ROLES = ("admin", "teacher", "creator", "company")
_PUBLIC_ED_INSTITUTIONS = ("public_school", "tvet_college", "university")


def _org_role_keys(role: str) -> tuple[str, ...]:
    return (
        "org_created.greeting", "org_created.steps_title", f"org_created.{role}.intro",
        *(f"org_created.{role}.step{n}_{part}" for n in (1, 2, 3, 4) for part in ("title", "body")),
        f"org_created.{role}.cta",
    )


def send_org_created_email(
    email: EmailStr,
    org_name: str,
    dashboard_url: str,
    lang: str = "en",
    role: str | None = None,
    institution_type: str | None = None,
    name: str | None = None,
):
    """Confirmation when a user creates an organization, personalised to what
    they told /new about themselves.

    ``role`` (admin / teacher / creator / company) picks a first-week guide
    that mirrors that role's in-app checklist; public schools, TVET colleges
    and universities also hear about free Public Education access. Without a
    role (older clients, API callers) — or in a locale without the guide — the
    short confirmation is sent instead.
    """
    safe_name = html.escape(org_name)
    dashboard = html.escape(dashboard_url)
    footer = t(lang, "org_created.footer")

    if role in _ORG_ROLES and _locale_has(lang, _org_role_keys(role)):
        greeting_name = html.escape((name or "").strip()) or safe_name
        heading = t(lang, "org_created.greeting", org_name=safe_name, name=greeting_name)
        steps = []
        for n in (1, 2, 3, 4):
            body_key = f"org_created.{role}.step{n}_body"
            if role == "creator" and n == 3:
                from src.services.payments import paystack

                if paystack.learner_pays_fees():
                    body_key = "org_created.creator.step3_body_fees"
            steps.append((t(lang, f"org_created.{role}.step{n}_title"), t(lang, body_key)))

        public_ed = ""
        if institution_type in _PUBLIC_ED_INSTITUTIONS:
            setup_url = html.escape(f"{dashboard_url.rstrip('/')}/onboarding")
            public_ed = (
                '<p style="margin: 0 0 24px 0; font-size: 12px; color: rgba(0,0,0,0.55); '
                'font-weight: 500; line-height: 1.6; text-align: left; background-color: #f0fdf4; '
                'border: 1px solid #dcfce7; border-radius: 10px; padding: 12px 14px;">'
                f'{t(lang, "org_created.public_ed")} '
                f'<a href="{setup_url}" style="color: #15803d; font-weight: 700;">'
                f'{t(lang, "org_created.public_ed_link")}</a></p>'
            )

        body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{t(lang, f"org_created.{role}.intro")}</p>
        {_panel(_section_title(t(lang, "org_created.steps_title")) + _numbered_steps(steps, "#000000"))}
        {public_ed}
        <a href="{dashboard}" style="{STYLES['button']}">{t(lang, f"org_created.{role}.cta")}</a>
    """
        preheader = _first_sentence(t(lang, f"org_created.{role}.intro"))
    else:
        heading = t(lang, "org_created.heading", org_name=safe_name)
        preheader = ""
        body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{t(lang, "org_created.body")}</p>
        <a href="{dashboard}" style="{STYLES['button']}">{t(lang, "org_created.cta")}</a>
    """

    return _send_notification_email(
        to=email,
        subject=t(lang, "org_created.subject", org_name=safe_name),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=footer,
            preheader=preheader,
        ),
    )


def send_org_deleted_email(
    email: EmailStr,
    org_name: str,
    lang: str = "en",
):
    """Confirmation email sent to org admins after an organization is deleted."""
    safe_name = html.escape(org_name)
    heading = t(lang, "org_deleted.heading", org_name=safe_name)
    body_text = t(lang, "org_deleted.body")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{body_text}</p>
    """
    return _send_notification_email(
        to=email,
        subject=t(lang, "org_deleted.subject", org_name=safe_name),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "org_deleted.footer"),
        ),
    )


def send_account_deleted_email(
    email: EmailStr,
    username: str = "",
    lang: str = "en",
):
    """Confirmation ('goodbye') email sent after an account is deleted."""
    heading = t(lang, "account_deleted.heading")
    body_text = t(lang, "account_deleted.body")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">{body_text}</p>
    """
    return _send_notification_email(
        to=email,
        subject=t(lang, "account_deleted.subject"),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "account_deleted.footer"),
        ),
    )


def send_password_reset_email(
    generated_reset_code: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Password reset for an account inside an organization.

    Branded to the org: its logo (or name) in the header, its color on the
    button, its name as the From display name. Platform-level resets go
    through ``send_password_reset_email_platform`` instead.
    """
    safe_username = html.escape(user.username)
    safe_code = html.escape(generated_reset_code)
    safe_email = quote(str(email), safe='')
    safe_code_param = quote(generated_reset_code, safe='')
    reset_url = f"{base_url}/reset?email={safe_email}&amp;resetCode={safe_code_param}"

    heading = t(lang, "password_reset.heading")
    body_text = t(lang, "password_reset.body", username=safe_username)
    cta = t(lang, "password_reset.cta")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        <div style="margin: 28px 0;">
            <span style="{STYLES['code']}">{safe_code}</span>
        </div>
        <a href="{reset_url}" style="{_button_style(brand_color)}">
            {cta}
        </a>
    """

    return send_email(
        to=email,
        subject=t(lang, "password_reset.subject"),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "password_reset.footer_org"),
            logo_html=_brand_logo_html(logo_url, organization.name),
            powered_by=powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


def send_password_reset_email_platform(
    generated_reset_code: str,
    user: UserRead,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
):
    safe_username = html.escape(user.username)
    safe_code = html.escape(generated_reset_code)
    safe_email = quote(str(email), safe='')
    safe_code_param = quote(generated_reset_code, safe='')
    reset_url = f"{base_url}/reset?email={safe_email}&amp;resetCode={safe_code_param}"

    heading = t(lang, "password_reset.heading")
    body_text = t(lang, "password_reset.body", username=safe_username)
    cta = t(lang, "password_reset.cta")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        <div style="margin: 28px 0;">
            <span style="{STYLES['code']}">{safe_code}</span>
        </div>
        <a href="{reset_url}" style="{STYLES['button']}">
            {cta}
        </a>
    """

    return send_email(
        to=email,
        subject=t(lang, "password_reset.subject"),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "password_reset.footer_platform"),
        ),
    )


def send_invitation_email(
    email: EmailStr,
    org_name: str,
    inviter_username: str,
    signup_url: str,
    invite_code: Optional[str] = None,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Invitation into an organization, branded to that organization."""
    safe_org_name = html.escape(org_name)
    safe_inviter = html.escape(inviter_username)

    code_section = ""
    if invite_code:
        safe_code = html.escape(invite_code)
        code_hint = t(lang, "invitation.code_hint")
        code_section = f"""
        <div style="margin: 28px 0;">
            <span style="{STYLES['code']}">{safe_code}</span>
        </div>
        <p style="{STYLES['p']}">
            {code_hint}
        </p>"""
    else:
        code_section = f"""
        <p style="{STYLES['p']}">
            {t(lang, "invitation.no_code_hint")}
        </p>"""

    heading = t(lang, "invitation.heading")
    intro = t(lang, "invitation.intro", inviter=safe_inviter, org_name=safe_org_name)
    cta = t(lang, "invitation.cta", org_name=safe_org_name)

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {intro}
        </p>
        {code_section}
        <a href="{signup_url}" style="{_button_style(brand_color)}">
            {cta}
        </a>
    """

    return send_email(
        to=email,
        subject=t(lang, "invitation.subject", org_name=safe_org_name),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "invitation.footer", inviter=safe_inviter),
            logo_html=_brand_logo_html(logo_url, org_name),
            powered_by=powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


def send_org_join_email(
    email: EmailStr,
    username: str,
    org_name: str,
    cta_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """Greeting sent when an EXISTING account becomes a member of an organization.

    Complements ``send_account_creation_email``, which only fires for brand new
    accounts: a user who already had an account and then joined a second org
    (invite code, open join, OAuth invite, admin provisioning) previously got no
    mail at all and had to find their way to the org on their own.

    Always white-labeled to the org — the user is being welcomed into that
    academy, not onto ValidBridge — with the org's logo (or name) up top.
    """
    safe_username = html.escape(username)
    safe_org_name = html.escape(org_name)

    heading = t(lang, "org_join.heading", username=safe_username)
    body_text = t(lang, "org_join.body", org_name=safe_org_name)
    cta = t(lang, "org_join.cta")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        <a href="{html.escape(cta_url)}" style="{_button_style(brand_color)}">
            {cta}
        </a>
        <p style="{STYLES['link_text']}">{html.escape(cta_url)}</p>
    """

    return _send_notification_email(
        to=email,
        subject=t(lang, "org_join.subject", org_name=safe_org_name),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "org_join.footer", org_name=safe_org_name),
            logo_html=_brand_logo_html(logo_url, org_name),
            powered_by=powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


def send_role_changed_email(
    email: EmailStr,
    username: str,
    org_name: str,
    new_role_name: str,
    lang: str = "en",
    cta_url: str | None = None,
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """
    Send an email notifying a user that their role has changed in an organization.

    ``cta_url`` is the org's own landing page, on the org's host (verified
    custom domain when it has one). Without it the mail told someone their
    permissions had changed and then gave them nowhere to go.
    """
    safe_username = html.escape(username)
    safe_org_name = html.escape(org_name)
    safe_role_name = html.escape(new_role_name)

    heading = t(lang, "role_changed.heading")
    body_1 = t(
        lang, "role_changed.body_1",
        username=safe_username, org_name=safe_org_name, role=safe_role_name,
    )
    body_2 = t(lang, "role_changed.body_2")

    cta_html = ""
    if cta_url:
        cta_html = (
            f'<a href="{html.escape(cta_url)}" style="{_button_style(brand_color)}">'
            f'{t(lang, "role_changed.cta", org_name=safe_org_name)}</a>'
        )

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_1}
        </p>
        <p style="{STYLES['p']}">
            {body_2}
        </p>
        {cta_html}
    """

    return _send_notification_email(
        to=email,
        subject=t(lang, "role_changed.subject", org_name=safe_org_name),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "role_changed.footer", org_name=safe_org_name),
            logo_html=_brand_logo_html(logo_url, org_name),
            powered_by=powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


def send_email_verification_email(
    token: str,
    user: UserRead,
    organization: OrganizationRead | None,
    email: EmailStr,
    base_url: str,
    lang: str = "en",
    sender_name: str | None = None,
    logo_url: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
):
    """
    Send email verification email with verification link.

    With an ``organization`` the mail is branded to it (its name in the copy,
    its logo or name in the header, its color on the button). Without one it
    is a platform email under the ValidBridge mark.

    Args:
        token: Verification token
        user: User receiving the email
        organization: Organization context (can be None for no-org signups)
        email: Email address to send to
        base_url: Base URL for constructing the verification link
        lang: ISO 639-1 language code for email content (defaults to 'en')

    Returns:
        Boolean indicating if email was sent successfully
    """
    safe_username = html.escape(user.username)
    brand = html.escape(organization.name) if organization else "ValidBridge"
    safe_token = quote(token, safe='')
    safe_user_uuid = quote(user.user_uuid, safe='')
    org_uuid = organization.org_uuid if organization else "none"
    safe_org_uuid = quote(org_uuid, safe='')
    verification_url = f"{base_url}/verify-email?token={safe_token}&amp;user={safe_user_uuid}&amp;org={safe_org_uuid}"

    heading = t(lang, "email_verification.heading")
    body_text = t(lang, "email_verification.body", username=safe_username, brand=brand)
    cta = t(lang, "email_verification.cta")
    copy_paste = t(lang, "email_verification.copy_paste")

    body_content = f"""
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        <a href="{verification_url}" style="{_button_style(brand_color if organization else None)}">
            {cta}
        </a>
        <p style="{STYLES['link_text']}">
            {copy_paste}<br />{verification_url}
        </p>
    """

    return send_email(
        to=email,
        subject=t(lang, "email_verification.subject"),
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, "email_verification.footer", brand=brand),
            logo_html=_brand_logo_html(logo_url, organization.name) if organization else PLATFORM_LOGO_HTML,
            powered_by=bool(organization) and powered_by,
            lang=lang,
        ),
        sender_name=sender_name,
    )


def _setup_checklist_html(lang: str, items: list[tuple[str, bool, str]] | None) -> str:
    """"Where you left off": done steps ticked, the first open step marked
    "Next step", every open step a link straight to where it is done."""
    if not items:
        return ""
    rows = []
    next_marked = False
    for label, done, url in items:
        safe_label = html.escape(label)
        if done:
            mark = '<span style="color: #16a34a; font-weight: 900;">&#10003;</span>'
            text = f'<span style="color: rgba(0,0,0,0.4); text-decoration: line-through;">{safe_label}</span>'
        else:
            mark = '<span style="color: rgba(0,0,0,0.25); font-weight: 900;">&#9675;</span>'
            badge = ""
            if not next_marked:
                next_marked = True
                badge = (
                    ' <span style="display: inline-block; font-size: 10px; font-weight: 800; '
                    'letter-spacing: 0.04em; text-transform: uppercase; color: #ffffff; '
                    'background-color: #000000; border-radius: 6px; padding: 2px 6px; '
                    f'margin-left: 4px;">{html.escape(t(lang, "nudge.common.next_step"))}</span>'
                )
            text = (
                f'<a href="{html.escape(url)}" style="color: #000000; font-weight: 700; '
                f'text-decoration: underline;">{safe_label}</a>{badge}'
            )
        rows.append(
            "<tr>"
            f'<td valign="top" style="padding: 0 10px 10px 0; width: 16px; font-size: 14px; line-height: 1.5;">{mark}</td>'
            f'<td valign="top" style="padding: 0 0 10px 0; font-size: 13px; line-height: 1.5; text-align: left;">{text}</td>'
            "</tr>"
        )
    return (
        '<div style="background-color: #fafafa; border: 1px solid #f0f0f0; border-radius: 12px; '
        'padding: 16px 18px 6px 18px; margin: 0 0 24px 0; text-align: left;">'
        '<p style="margin: 0 0 12px 0; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; '
        'text-transform: uppercase; color: rgba(0,0,0,0.35);">'
        f'{html.escape(t(lang, "nudge.common.checklist_title"))}</p>'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
        f'style="border-collapse: collapse;">{"".join(rows)}</table></div>'
    )


def _support_html(lang: str, support: dict | None) -> str:
    """"Want a hand?": WhatsApp or email (both prefilled — the reader picks)
    and the getting-started guide. Renders only the channels configured."""
    if not support:
        return ""
    buttons = []
    if support.get("whatsapp_url"):
        buttons.append(
            f'<a href="{html.escape(support["whatsapp_url"])}" style="display: inline-block; '
            'margin: 0 4px 8px 4px; padding: 10px 16px; background-color: #16a34a; color: #ffffff; '
            'text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 700;">'
            f'{html.escape(t(lang, "nudge.common.support_whatsapp"))}</a>'
        )
    if support.get("email_url"):
        buttons.append(
            f'<a href="{html.escape(support["email_url"])}" style="display: inline-block; '
            'margin: 0 4px 8px 4px; padding: 10px 16px; background-color: #ffffff; color: #000000; '
            'border: 1px solid #e5e5e5; text-decoration: none; border-radius: 10px; font-size: 13px; '
            f'font-weight: 700;">{html.escape(t(lang, "nudge.common.support_email"))}</a>'
        )
    guide = ""
    if support.get("help_url"):
        guide = (
            '<p style="margin: 6px 0 0 0; font-size: 12px; line-height: 1.6;">'
            f'<a href="{html.escape(support["help_url"])}" style="color: rgba(0,0,0,0.5); '
            f'text-decoration: underline;">{html.escape(t(lang, "nudge.common.support_help"))}</a></p>'
        )
    if not buttons and not guide:
        return ""
    return (
        f'<hr style="{STYLES["divider"]}">'
        '<p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 800; color: #000000;">'
        f'{html.escape(t(lang, "nudge.common.support_title"))}</p>'
        '<p style="margin: 0 0 14px 0; font-size: 13px; color: rgba(0,0,0,0.5); font-weight: 500; line-height: 1.6;">'
        f'{html.escape(t(lang, "nudge.common.support_body"))}</p>'
        f'<div>{"".join(buttons)}</div>{guide}'
    )


def send_nudge_email(
    nudge_id: str,
    email: EmailStr,
    org_name: str,
    cta_url: str,
    unsubscribe_url: str,
    lang: str = "en",
    logo_url: str | None = None,
    has_cta: bool = True,
    track: str = "",
    stats: list[tuple[str, int]] | None = None,
    sender_name: str | None = None,
    brand_color: str | None = None,
    powered_by: bool = True,
    checklist: list[tuple[str, bool, str]] | None = None,
    support: dict | None = None,
    footer_key: str = "nudge.common.footer",
    **copy_vars,
):
    """Send one lifecycle nudge.

    Generic over the catalog: the nudge id selects its copy from the
    ``nudge.<id>.*`` namespace, so adding a nudge never means adding a function
    here. ``copy_vars`` fills the placeholders that nudge's strings declare
    (course name, plan name, and so on) — every value is escaped before it
    reaches the template.

    ``track`` selects the illustration. It is drawn as a table mosaic rather
    than an image because Gmail strips inline SVG and both Gmail and Outlook
    block ``data:`` URIs, so an embedded picture would render as a blank gap
    for a large share of readers.

    Unlike transactional mail this always carries an unsubscribe link and the
    matching ``List-Unsubscribe`` headers. Gmail and Outlook expect them on
    bulk mail, and without them a run at any real volume puts the sending
    domain at risk.

    Failures are swallowed via ``_send_notification_email``: a nudge nobody
    asked for must never be the reason a batch job dies.
    """
    safe_org_name = html.escape(org_name)
    raw_vars = {key: str(value) for key, value in copy_vars.items() if value is not None}
    raw_vars.setdefault("org_name", org_name)
    safe_vars = {key: html.escape(value) for key, value in raw_vars.items()}

    heading = t(lang, f"nudge.{nudge_id}.heading", **safe_vars)
    body_text = t(lang, f"nudge.{nudge_id}.body", **safe_vars)
    # The subject is plain text, not HTML: escaping it would deliver
    # "Maths &amp; Physics" to the inbox, and ampersands in course names are
    # common enough that this is not an edge case.
    subject = t(lang, f"nudge.{nudge_id}.subject", **raw_vars)

    from src.services.nudges.illustrations import render_illustration

    stat_html = _stat_strip(
        [(t(lang, f"nudge.stat.{key}"), value) for key, value in (stats or [])]
    )

    body_content = f"""
        {render_illustration(track)}
        <h1 style="{STYLES['h1']}">{heading}</h1>
        <p style="{STYLES['p']}">
            {body_text}
        </p>
        {stat_html}
        {_setup_checklist_html(lang, checklist)}"""
    if has_cta and cta_url:
        cta = t(lang, f"nudge.{nudge_id}.cta", **safe_vars)
        body_content += f"""
        <a href="{html.escape(cta_url)}" style="{_button_style(brand_color)}">
            {cta}
        </a>
        <p style="{STYLES['link_text']}">{html.escape(cta_url)}</p>
    """
    body_content += _support_html(lang, support)

    # The preheader is the body's opening sentence rather than a thirty-first
    # set of translated strings. It is already localised, and it gives the
    # inbox list a second line of information instead of echoing the subject.
    preheader = _first_sentence(t(lang, f"nudge.{nudge_id}.body", **raw_vars))

    headers: dict[str, str] = {}
    if unsubscribe_url:
        headers["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    # Several nudges invite a reply. Without this they would arrive from the
    # no-reply sender and the invitation would be a lie.
    reply_to = _reply_to_address()
    if reply_to:
        headers["Reply-To"] = reply_to

    return _send_notification_email(
        to=email,
        subject=subject,
        body=_email_layout(
            title=heading,
            body_content=body_content,
            footer_note=t(lang, footer_key, org_name=safe_org_name),
            logo_html=_brand_logo_html(logo_url, org_name),
            unsubscribe_url=unsubscribe_url,
            unsubscribe_label=t(lang, "nudge.common.unsubscribe"),
            preheader=preheader,
            powered_by=powered_by,
            lang=lang,
        ),
        headers=headers or None,
        sender_name=sender_name,
    )
