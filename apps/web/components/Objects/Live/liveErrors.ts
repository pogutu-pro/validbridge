import { LiveApiError } from '@services/live/live'

/**
 * Map any failure to an i18n key. Raw server or LiveKit text is never shown:
 * unknown codes fall through to a generic message.
 */
const CODE_KEYS: Record<string, string> = {
  NOT_FOUND: 'live.errors.not_found',
  FORBIDDEN: 'live.errors.unauthorized',
  UNAUTHENTICATED: 'live.errors.unauthenticated',
  LIVE_STAFF_REQUIRED: 'live.errors.staff_only',
  ENROLLMENT_REQUIRED: 'live.errors.enrollment_required',
  PAYMENT_REQUIRED: 'live.errors.payment_required',
  ACTIVITY_LOCKED: 'live.errors.activity_locked',
  REMOVED_FROM_SESSION: 'live.errors.removed',
  SESSION_ENDED: 'live.errors.session_ended',
  SESSION_NOT_LIVE: 'live.errors.not_live',
  SESSION_NOT_STARTED: 'live.errors.not_started',
  LIVE_NOT_CONFIGURED: 'live.errors.unavailable',
  LIVE_SERVER_UNAVAILABLE: 'live.errors.unavailable',
  SERVER_UNAVAILABLE: 'live.errors.unavailable',
  NETWORK_ERROR: 'live.errors.network',
  SLOW_DOWN: 'live.errors.slow_down',
  POLL_CLOSED: 'live.errors.poll_closed',
  NOT_CONNECTED: 'live.errors.not_connected',
  CANNOT_MODERATE_STAFF: 'live.errors.cannot_moderate',
  CANNOT_MODERATE_SELF: 'live.errors.cannot_moderate',
  QUIZ_RUNNING: 'live.errors.quiz_running',
  QUIZ_EMPTY: 'live.errors.quiz_empty',
  QUIZ_QUESTION_CLOSED: 'live.errors.quiz_closed',
  QUIZ_ALREADY_ANSWERED: 'live.errors.quiz_answered',
  QUIZ_FINISHED: 'live.errors.quiz_finished',
  QUIZ_STAFF_CANNOT_ANSWER: 'live.errors.staff_only',
  RECORDING_NOT_ENABLED: 'live.errors.recording_unavailable',
  RECORDING_STORAGE_UNAVAILABLE: 'live.errors.recording_unavailable',
  RECORDING_ACTIVE: 'live.errors.recording_active',
  RECORDING_FAILED_TO_START: 'live.errors.recording_failed'
}

export function liveErrorCode(error: unknown): string {
  return error instanceof LiveApiError ? error.code : 'UNKNOWN'
}

export function liveErrorKey(error: unknown): string {
  return CODE_KEYS[liveErrorCode(error)] ?? 'live.errors.generic'
}
