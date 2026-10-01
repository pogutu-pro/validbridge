from fastapi import APIRouter, Depends
from src.routers import admin as admin_router_module
from src.routers import analytics as analytics_router_module
from src.routers import audit as audit_router_module
from src.routers import audit_logs as audit_logs_router_module
from src.routers import code_execution
from src.routers import code_submissions
from src.routers import health
from src.routers import demo as demo_router_module
from src.routers import instance
from src.routers import plans
from src.routers import usergroups
from src.routers import dev, trail, users, auth, orgs, roles, search, sso as sso_router_module
from src.routers import superadmin as superadmin_router_module
from src.routers import mfa as mfa_router_module
from src.routers import monitoring
from src.routers import nudges as nudges_router_module
from src.routers import stream
from src.routers import live as live_router_module
from src.routers import api_tokens
from src.routers import webhooks
from src.routers.integrations import zapier as zapier_integration
from src.routers.ai import ai, magicblocks, courseplanning, rag, assistant, images, quiz, assignment_gen, scenario, audio
from src.routers.boards import boards_playground
from src.routers.orgs import ai_credits
from src.routers.orgs import custom_domains
from src.routers.orgs import packs
from src.routers import payments as payments_router_module
from src.routers import billing as billing_router_module
from src.routers import superadmin_billing as superadmin_billing_router_module
from src.routers.courses import chapters, courses, assignments, certifications
from src.routers.folders import folders as folders_router_module
from src.routers.media import media as media_router_module
from src.routers.courses import migration as migration_router_module
from src.routers.communities import communities as communities_router_module
from src.routers.communities import discussions as discussions_router_module
from src.routers.courses.activities import activities, blocks
from src.routers.podcasts import podcasts as podcasts_router_module
from src.routers.podcasts import episodes as episodes_router_module
from src.routers.boards import boards as boards_router_module
from src.routers.orgs import org_plan
from src.routers.orgs import public_education as public_education_router
from src.routers.playgrounds import playgrounds as playgrounds_router_module
from src.routers.playgrounds import playgrounds_generator as playgrounds_generator_router
from src.core.ee_hooks import register_ee_routers
from src.services.dev.dev import isDevModeEnabledOrRaise
from src.routers.utils import router as utils_router
from src.security.auth import get_current_user
from src.security.api_token_utils import (
    get_authenticated_non_api_token_user,
    require_authenticated_user_or_api_token,
    require_non_api_token_user,
)
from src.security.features_utils.plan_check import require_plan, require_plan_for_boards, require_plan_for_certifications, require_plan_for_community, require_plan_for_usergroups, require_plan_for_playgrounds


v1_router = APIRouter(prefix="/api/v1")

# Helper dependency to reject API token access (still admits AnonymousUser —
# use on routers that contain at least one deliberately-public endpoint).
async def get_non_api_token_user(user = Depends(get_current_user)):
    """Dependency that rejects API token access."""
    return await require_non_api_token_user(user)


# Alias used by routers that have zero public endpoints. Requires a real
# authenticated session AND rejects API tokens. See F-2 in the security
# audit for context: the plain ``get_non_api_token_user`` silently admits
# anonymous callers, which is the wrong default for admin-only or
# billing/compute-sensitive routes.
require_authenticated_user = get_authenticated_non_api_token_user

# API Routes
v1_router.include_router(
    users.router,
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    usergroups.router,
    prefix="/usergroups",
    tags=["usergroups"],
    # Admit API tokens (headless enrollment/usergroup management) while still
    # rejecting anonymous callers — same pattern as /assignments. `usergroups`
    # is already an allowed API-token resource type in the RBAC layer
    # (rbac.py authorization_verify_api_token_permissions), and every handler
    # authorizes through usergroups.rbac_check, which has an APITokenUser branch
    # enforcing the token's usergroups rights + org boundary. The two handlers
    # that authorize against a placeholder uuid (create, get-by-resource) get an
    # explicit token org-boundary check in the service layer.
    dependencies=[
        Depends(require_authenticated_user_or_api_token),
        Depends(require_plan_for_usergroups("starter", "User Groups")),
    ],
)
v1_router.include_router(auth.router, prefix="/auth", tags=["auth"])
# SSO: admin CRUD + public authorize/callback flow. Mounted under /auth/sso so
# routes resolve to /api/v1/auth/sso/... exactly as the frontend expects and as
# _callback_url() advertises for the OAuth redirect_uri. Its own module — see
# the SSO implementation plan.
v1_router.include_router(sso_router_module.router, prefix="/auth/sso", tags=["auth"])
# Two-factor: enrollment/management plus the /auth/login/mfa challenge.
v1_router.include_router(mfa_router_module.router, prefix="/auth", tags=["auth"])
v1_router.include_router(
    orgs.router,
    prefix="/orgs",
    tags=["orgs"],
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    public_education_router.router,
    prefix="/orgs",
    tags=["public-education"],
    dependencies=[Depends(require_authenticated_user)],
)
v1_router.include_router(
    ai_credits.router,
    prefix="/orgs",
    tags=["ai-credits"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    roles.router,
    prefix="/roles",
    tags=["roles"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    api_tokens.router,
    prefix="/orgs",
    tags=["api-tokens"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan("growth", "API Access"))]
)
v1_router.include_router(
    webhooks.router,
    prefix="/orgs",
    tags=["webhooks"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan("growth", "Webhooks"))]
)
v1_router.include_router(
    zapier_integration.router,
    prefix="/integrations/zapier",
    tags=["integrations", "zapier"],
)
v1_router.include_router(
    custom_domains.router,
    prefix="/orgs",
    tags=["custom-domains"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan("growth", "Custom Domains"))]
)
# Public domain resolution endpoint (no auth required)
v1_router.include_router(
    custom_domains.public_router,
    prefix="/orgs",
    tags=["custom-domains"],
)
# Public unsubscribe endpoints (no auth — the HMAC token in the link is the
# authorisation; a nudge recipient may have no session at all)
v1_router.include_router(
    nudges_router_module.public_router,
    prefix="/emails",
    tags=["emails"],
)
# Email delivery feedback from the provider (protected by a shared secret).
# Bounces and complaints have to reach us or a dead address is mailed forever.
v1_router.include_router(
    nudges_router_module.internal_router,
    prefix="/internal/emails",
    tags=["emails-internal"],
)
# Internal domain listing endpoint (protected by internal key)
v1_router.include_router(
    custom_domains.internal_router,
    prefix="/internal",
    tags=["custom-domains-internal"],
)
# Internal packs endpoint (protected by platform key)
v1_router.include_router(
    packs.internal_router,
    prefix="/internal/packs",
    tags=["packs-internal"],
)
# Org-facing packs endpoint (user auth, admin only)
v1_router.include_router(
    packs.router,
    prefix="/orgs",
    tags=["packs"],
    dependencies=[Depends(require_authenticated_user)],
)
# Payments (org-scoped storefront + provider integration). Public storefront and
# the Paystack webhook are unauthenticated; org-facing management and checkout
# authorize inside the router.
v1_router.include_router(
    payments_router_module.router,
    prefix="/payments",
    tags=["payments"],
)
# Platform billing (the school paying ValidBridge). The catalogue and the
# Paystack webhook are public; every org endpoint authorizes inside the router
# and rejects API tokens.
v1_router.include_router(
    billing_router_module.router,
    prefix="/billing",
    tags=["billing"],
)
# Superadmin billing console (every endpoint requires a superadmin; money
# actions a signed-in session plus a reason, audit-logged).
v1_router.include_router(
    superadmin_billing_router_module.router,
    prefix="/superadmin/billing",
    tags=["superadmin", "billing"],
)
# Internal cloud plan-state endpoint (protected by cloud internal key).
v1_router.include_router(
    org_plan.internal_router,
    prefix="/cloud_internal",
    tags=["cloud-internal"],
)
v1_router.include_router(
    blocks.router,
    prefix="/blocks",
    tags=["blocks"],
    # Mixed router: public course pages legitimately fetch block media as
    # anonymous visitors. Anonymous access is gated per-handler: GET block
    # handlers run RBAC + org-membership checks in the service layer; POST
    # block handlers (creates) require ownership via check_resource_access.
    dependencies=[Depends(get_non_api_token_user)]
)
v1_router.include_router(
    admin_router_module.router,
    prefix="/admin",
    tags=["admin"],
)
v1_router.include_router(courses.router, prefix="/courses", tags=["courses"])
v1_router.include_router(
    migration_router_module.router,
    prefix="/courses",
    tags=["migration"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(search.router, prefix="/search", tags=["search"])
v1_router.include_router(
    assignments.router,
    prefix="/assignments",
    tags=["assignments"],
    # Admit API tokens (headless assignments) while still rejecting anonymous.
    # Individual handlers gate access: authoring + grading go through
    # authorize_assignment_access (assignments rights bucket), while learner
    # /me + submission endpoints keep _block_api_tokens (session-only).
    dependencies=[Depends(require_authenticated_user_or_api_token)]
)
v1_router.include_router(chapters.router, prefix="/chapters", tags=["chapters"])
v1_router.include_router(activities.router, prefix="/activities", tags=["activities"])
v1_router.include_router(
    folders_router_module.router, prefix="/folders", tags=["folders"]
)
v1_router.include_router(
    media_router_module.router, prefix="/media", tags=["media"]
)
v1_router.include_router(
    communities_router_module.router,
    prefix="/communities",
    tags=["communities"],
    dependencies=[Depends(require_plan_for_community("starter", "Communities"))]
)
v1_router.include_router(
    discussions_router_module.router,
    tags=["discussions"],
    dependencies=[Depends(require_plan_for_community("starter", "Communities"))]
)
v1_router.include_router(
    podcasts_router_module.router,
    prefix="/podcasts",
    tags=["podcasts"]
)
v1_router.include_router(
    episodes_router_module.router,
    prefix="/podcasts",
    tags=["podcasts", "episodes"]
)
v1_router.include_router(
    certifications.router,
    prefix="/certifications",
    tags=["certifications"],
    dependencies=[Depends(require_plan_for_certifications("starter", "Certifications"))]
)
v1_router.include_router(
    boards_router_module.router,
    prefix="/boards",
    tags=["boards"],
    dependencies=[Depends(get_non_api_token_user), Depends(require_plan_for_boards("starter", "Boards"))]
)
v1_router.include_router(
    boards_router_module.internal_router,
    prefix="/boards",
    tags=["boards-internal"],
)
v1_router.include_router(
    trail.router,
    prefix="/trail",
    tags=["trail"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    ai.router,
    prefix="/ai",
    tags=["ai"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    magicblocks.router,
    prefix="/ai",
    tags=["ai", "magicblocks"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    courseplanning.router,
    prefix="/ai",
    tags=["ai", "courseplanning"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    rag.router,
    prefix="/ai",
    tags=["ai", "rag"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    assistant.router,
    prefix="/ai",
    tags=["ai", "assistant"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    images.router,
    prefix="/ai",
    tags=["ai", "images"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    audio.router,
    prefix="/ai",
    tags=["ai", "audio"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    quiz.router,
    prefix="/ai",
    tags=["ai", "quiz"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    assignment_gen.router,
    prefix="/ai",
    tags=["ai", "assignment-gen"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    scenario.router,
    prefix="/ai",
    tags=["ai", "scenario"],
    dependencies=[Depends(require_authenticated_user)]
)
v1_router.include_router(
    boards_playground.router,
    prefix="/boards",
    tags=["boards", "boards-playground"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan_for_boards("starter", "Boards"))]
)
v1_router.include_router(
    playgrounds_router_module.router,
    prefix="/playgrounds",
    tags=["playgrounds"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan_for_playgrounds("starter", "Playgrounds"))]
)
v1_router.include_router(
    playgrounds_generator_router.router,
    prefix="/playgrounds",
    tags=["playgrounds", "playgrounds-generator"],
    dependencies=[Depends(require_authenticated_user), Depends(require_plan_for_playgrounds("starter", "Playgrounds"))]
)

v1_router.include_router(
    analytics_router_module.router,
    prefix="/analytics",
    tags=["analytics"],
    dependencies=[Depends(require_authenticated_user)],
)

# Per-student audit & analytics (org-admin only; enforced inside the router)
v1_router.include_router(
    audit_router_module.router,
    prefix="/audit",
    tags=["audit"],
    dependencies=[Depends(require_authenticated_user)],
)

# Org-wide request audit log viewer (org-admin only; enforced inside the router)
v1_router.include_router(
    audit_logs_router_module.router,
    prefix="/ee/audit_logs",
    tags=["audit_logs"],
    dependencies=[Depends(require_authenticated_user)],
)

# Live classroom: session management + join tokens (signed-in users only; RBAC
# per course inside the service). The LiveKit webhook is public and verified by
# LiveKit's signed JWT over the body.
v1_router.include_router(
    live_router_module.router,
    prefix="/live",
    tags=["live"],
    dependencies=[Depends(require_authenticated_user)],
)
v1_router.include_router(
    live_router_module.webhook_router,
    prefix="/live",
    tags=["live"],
)

v1_router.include_router(
    code_execution.router,
    prefix="/code",
    tags=["code-execution"],
    dependencies=[Depends(require_authenticated_user)],
)

v1_router.include_router(
    code_submissions.router,
    prefix="/code/submissions",
    tags=["code_submissions"],
    dependencies=[Depends(require_authenticated_user)],
)

# Instance info (public, no auth)
v1_router.include_router(instance.router, prefix="/instance", tags=["instance"])
# Demo: /demo/status is public (the onboarding page calls it before the
# visitor has done anything); /demo/enter resolves the user itself.
v1_router.include_router(demo_router_module.router, prefix="/demo", tags=["demo"])

# Sentry feedback relay (rejects API tokens; works for both anonymous and
# authenticated callers so the in-app feedback modal keeps working everywhere)
v1_router.include_router(
    monitoring.router,
    prefix="/monitoring",
    tags=["monitoring"],
    dependencies=[Depends(get_non_api_token_user)],
)

# Plan limits (public, no auth — used by frontend pricing pages)
v1_router.include_router(plans.router, prefix="/plans", tags=["plans"])

# Register EE Routers if available

v1_router.include_router(
    health.router,
    prefix="/health",
    tags=["health"],
    dependencies=[Depends(get_non_api_token_user)]
)

# Dev Routes
v1_router.include_router(
    dev.router,
    prefix="/dev",
    tags=["dev"],
    dependencies=[Depends(isDevModeEnabledOrRaise), Depends(get_non_api_token_user)],
)

v1_router.include_router(
    utils_router,
    prefix="/utils",
    tags=["utils"],
    dependencies=[Depends(require_authenticated_user)]
)

# Video Streaming Routes
v1_router.include_router(
    stream.router,
    prefix="/stream",
    tags=["stream"],
    dependencies=[Depends(get_non_api_token_user)]
)
# First-party platform superadmin API (replaces the absent Enterprise package).
# Mounted at the /ee/superadmin prefix the web admin client already targets.
v1_router.include_router(
    superadmin_router_module.router,
    prefix="/ee/superadmin",
    tags=["superadmin"],
)
# Superadmin org management (suspend / unsuspend / guarded delete).
from src.routers import superadmin_orgs as superadmin_orgs_router_module  # noqa: E402

v1_router.include_router(
    superadmin_orgs_router_module.router,
    prefix="/ee/superadmin",
    tags=["superadmin"],
)

register_ee_routers(v1_router)
