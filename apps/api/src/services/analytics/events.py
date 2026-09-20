# Analytics event name constants

# Frontend events
PAGE_VIEW = "page_view"
COURSE_VIEW = "course_view"
ACTIVITY_VIEW = "activity_view"
SEARCH_QUERY = "search_query"
TIME_ON_ACTIVITY = "time_on_activity"

# API events
COURSE_ENROLLED = "course_enrolled"
COURSE_COMPLETED = "course_completed"
ACTIVITY_COMPLETED = "activity_completed"
ASSIGNMENT_SUBMITTED = "assignment_submitted"
USER_SIGNED_UP = "user_signed_up"
USER_REMOVED_FROM_ORG = "user_removed_from_org"
CERTIFICATE_CLAIMED = "certificate_claimed"
CERTIFICATE_REVOKED = "certificate_revoked"
DISCUSSION_POSTED = "discussion_posted"

# Lifecycle email. Recorded per delivered nudge so returns can be attributed
# to the specific message that prompted them, rather than to "we sent emails".
NUDGE_SENT = "nudge_sent"

# Allowed frontend event names (whitelist for the proxy endpoint).
#
# Source of truth: apps/web/services/analytics/events.ts (the `AnalyticsEvent`
# enum). The hook fans every event out to both this backend sink and PostHog,
# so this set must mirror the frontend registry — adding an event on the web
# side without adding its wire name here makes the proxy reject it with 400.
ALLOWED_FRONTEND_EVENTS = {
    "account_billing_portal_opened", "account_delete_initiated", "account_deleted",
    "account_profile_updated", "account_subpage_viewed", "activity_content_saved",
    "activity_created", "activity_editor_opened", "activity_file_uploaded",
    "activity_marked_complete", "activity_next_clicked", "activity_view",
    "ai_assistant_opened", "ai_course_created", "ai_editor_content_inserted",
    "ai_editor_error", "ai_editor_message_sent", "ai_editor_panel_opened", "ai_message_sent",
    "api_token_created", "api_token_revoked", "assignment_created", "assignment_grade_viewed",
    "assignment_publish_toggled", "assignment_retried", "assignment_submissions_viewed",
    "assignment_submitted", "assignment_task_created", "assignment_task_progress_saved",
    "board_ai_prompt_sent", "board_block_added", "board_created", "board_feedback_submitted",
    "board_member_added", "board_opened", "board_viewed", "certificate_downloaded",
    "certificate_shared_linkedin", "certificate_verification_viewed", "certificate_viewed",
    "chapter_created", "checkout_login_redirected", "checkout_returned",
    "checkout_session_created", "checkout_session_failed", "command_palette_opened",
    "command_palette_result_selected", "comment_posted", "comment_upvoted",
    "communities_list_viewed", "community_created", "community_viewed",
    "contributor_application_submitted", "copilot_bubble_message_sent",
    "copilot_bubble_opened", "copilot_message_sent", "copilot_response_completed",
    "copilot_response_failed", "course_access_changed", "course_card_opened",
    "course_changes_saved", "course_completed", "course_created",
    "course_creation_type_selected", "course_left", "course_offer_cta_clicked",
    "course_progress_viewed", "course_published_toggled", "course_searched", "course_shared",
    "course_signup_prompted", "course_started", "course_structure_reordered", "course_view",
    "create_discussion_modal_opened", "custom_domain_added", "custom_domain_verified",
    "dashboard_entered", "dashboard_nav_clicked", "discussion_created",
    "discussion_reaction_toggled", "discussion_upvoted", "discussion_viewed",
    "editor_block_inserted", "email_verification_completed", "email_verification_resent",
    "episode_completed", "episode_created", "episode_played", "episode_publish_toggled",
    "error_view_shown", "feature_gate_upgrade_clicked", "feature_gate_upgrade_shown",
    "feedback_submitted", "focus_mode_entered", "folder_created", "folder_link_shared",
    "folder_viewed", "google_oauth_callback_completed", "invite_code_created",
    "join_org_banner_clicked", "language_changed", "library_content_added", "library_viewed",
    "login_clicked", "login_failed", "login_google_clicked", "login_sso_clicked",
    "login_submitted", "login_succeeded", "logout_clicked", "magic_block_generation_requested",
    "magic_block_saved", "media_upload_failed", "media_uploaded", "members_batch_invited",
    "not_found_view_shown", "offer_checkout_started", "offer_created", "offer_viewed",
    "onboarding_org_create_failed", "onboarding_org_create_submitted",
    "onboarding_org_created", "onboarding_org_form_started", "onboarding_plan_selected",
    "onboarding_started", "onboarding_step_action_clicked", "onboarding_step_completed",
    "onboarding_step_skipped", "onboarding_use_type_selected", "onboarding_welcome_completed",
    "org_delete_initiated", "org_deleted", "org_general_settings_updated", "org_joined",
    "org_selected", "page_view", "password_reset_link_requested", "password_reset_submitted",
    "payment_provider_connect_clicked", "payment_provider_connected",
    "payments_feature_gate_blocked", "paywall_get_access_clicked", "paywall_viewed",
    "plan_checkout_initiated", "plan_page_viewed", "playground_created",
    "playground_generation_completed", "playground_generation_failed",
    "playground_generation_started", "playground_opened", "playground_publish_toggled",
    "playground_saved", "playground_viewed", "podcast_card_opened", "podcast_created",
    "podcast_updated", "podcast_viewed", "podcasts_list_viewed", "quiz_block_submitted",
    "resource_visibility_changed", "search_executed", "search_query", "search_result_clicked",
    "signup_clicked", "signup_failed", "signup_google_clicked", "signup_mechanism_changed",
    "signup_submitted", "signup_succeeded", "sso_callback_completed", "sso_config_saved",
    "store_offer_card_clicked", "store_viewed", "submission_evaluate_opened",
    "submission_finalized", "submission_graded", "time_on_activity", "trail_viewed",
    "upgrade_banner_cta_clicked", "upgrade_modal_viewed", "upgrade_plan_selected",
    "usergroup_created", "usergroup_linked", "usergroup_unlinked", "webhook_created",
}
