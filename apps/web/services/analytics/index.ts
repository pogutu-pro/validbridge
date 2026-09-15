/**
 * validbridge-analytics — the single import surface for product analytics.
 *
 *   import { useVBAnalytics, AnalyticsEvent } from '@services/analytics'
 *   const { track } = useVBAnalytics('learner')
 *   track(AnalyticsEvent.CourseStarted, { course_uuid })
 */
export { AnalyticsEvent } from './events'
export { useVBAnalytics, type EventProps } from './useVBAnalytics'
export { useTrackView } from './useTrackView'
export { useStandardProps, type StandardProps } from './context'
