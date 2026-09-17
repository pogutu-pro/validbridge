import logging
import importlib.util
import os

logger = logging.getLogger(__name__)

def is_ee_available():
    """
    Check if the Enterprise Edition code is present on disk and not disabled.

    NOTE: This does NOT indicate the deployment mode is 'ee'.
    SaaS deployments also ship with the EE folder present.
    Use get_deployment_mode() from src.core.deployment_mode to determine the actual mode.
    """
    if os.environ.get("VALIDBRIDGE_DISABLE_EE") == "1":
        return False
    # Require the hooks module itself, not merely a directory named "ee":
    # a directory without it imports nothing, so it is not an EE install.
    return os.path.isdir("ee") and os.path.isfile(os.path.join("ee", "hooks.py"))

def get_ee_hooks():
    """Safely import and return the EE hooks module if available."""
    if not is_ee_available():
        return None
    
    try:
        # We use importlib to avoid hardcoded top-level imports that might 
        # fail during linting or when the folder is missing.
        spec = importlib.util.find_spec("ee.hooks")
        if spec is None:
            return None
        
        module = importlib.import_module("ee.hooks")
        return module
    except ImportError as e:
        logger.error(f"Failed to import EE hooks: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error loading EE hooks: {e}")
        return None

def register_ee_middlewares(app):
    """Call EE to register its middlewares."""
    from config.config import get_validbridge_config
    if get_validbridge_config().general_config.saas_mode:
        return
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_middlewares"):
        hooks.register_middlewares(app)

def register_ee_routers(v1_router):
    """Call EE to register its routers."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "register_routers"):
        hooks.register_routers(v1_router)

def run_ee_startup(app):
    """Call EE to run its startup tasks."""
    hooks = get_ee_hooks()
    if hooks and hasattr(hooks, "on_startup"):
        hooks.on_startup(app)

def is_multi_org_allowed() -> bool:
    """Check if multi-org mode is allowed (requires EE or SaaS)."""
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    return mode in ('ee', 'saas')


async def check_ee_activity_paid_access(request, activity_id, user, db_session) -> bool:
    """
    Whether the user may see the full content of this activity.

    Fail-closed: any error (missing row, DB failure, unexpected exception)
    returns False, gating the content instead of leaking it. Superadmins and the
    activity's course authors/maintainers always see their own content. A course
    that is not behind a paid offer is treated as free.
    """
    from sqlmodel import select

    from src.db.courses.activities import Activity
    from src.db.courses.courses import Course
    from src.security.superadmin import is_user_superadmin
    from src.services.payments.payments_access import check_enrollment_access, get_paywall_offer

    user_id = getattr(user, "id", None)
    if not user_id:
        return False

    try:
        if await is_user_superadmin(user_id, db_session):
            return True
        course_uuid = (
            await db_session.execute(
                select(Course.course_uuid)
                .join(Activity, Activity.course_id == Course.id)
                .where(Activity.id == activity_id)
            )
        ).scalars().first()
    except Exception:
        return False

    if not course_uuid:
        return True

    try:
        paywall_offer = await get_paywall_offer(course_uuid, db_session)
        if paywall_offer is None:
            return True
        return await check_enrollment_access(course_uuid, user_id, db_session)
    except Exception:
        return False

