'use client'

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Clock, Copy, LogIn, Lock, SearchX, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useLiveAccessToken, useLiveClassroom } from '@/hooks/queries/useLive'
import { queryKeys } from '@lib/query/keys'
import { getUriWithOrg } from '@services/config/config'
import { startCourse } from '@services/courses/activity'
import {
  LiveApiError,
  isEndedStatus,
  isStaffRole,
  joinLiveSession,
  startLiveSession,
  type LiveJoin,
} from '@services/live/live'
import type { ExitReason, MediaChoices } from './Classroom'
import { liveErrorCode, liveErrorKey } from './liveErrors'
import StatusScreen from './StatusScreen'

// LiveKit touches browser-only APIs; keep it out of SSR and out of every other bundle.
const Classroom = dynamic(() => import('./Classroom'), { ssr: false })
const PreJoin = dynamic(() => import('./PreJoin'), { ssr: false })

type Phase =
  | { kind: 'lobby' }
  | { kind: 'room'; connection: LiveJoin; choices: MediaChoices }
  | { kind: 'exited'; reason: ExitReason }

const primaryButton =
  'inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90'
const secondaryButton =
  'inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50'

export default function LiveBridge({
  sessionUuid,
  courseUuid,
  orgslug,
}: {
  sessionUuid: string
  courseUuid: string
  orgslug: string
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const vbSession = useVBSession() as any
  const accessToken = useLiveAccessToken()
  const [phase, setPhase] = useState<Phase>({ kind: 'lobby' })
  const [joining, setJoining] = useState(false)
  const [enrolling, setEnrolling] = useState(false)
  const { data: classroom, error, isLoading, refetch } = useLiveClassroom(sessionUuid, {
    pollWhileWaiting: phase.kind === 'lobby',
  })

  const courseHref = getUriWithOrg(orgslug, `/course/${courseUuid}`)
  const backToCourse = (
    <Link href={courseHref} className={secondaryButton}>
      {t('live.common.back_to_course')}
    </Link>
  )

  const onExit = useCallback(
    (reason: ExitReason) => {
      setPhase({ kind: 'exited', reason })
      qc.invalidateQueries({ queryKey: queryKeys.live.classroom(sessionUuid) })
    },
    [qc, sessionUuid]
  )

  const join = async (choices: MediaChoices) => {
    if (!classroom) return
    setJoining(true)
    try {
      if (isStaffRole(classroom.role) && classroom.session.status === 'scheduled') {
        await startLiveSession(sessionUuid, accessToken)
      }
      const connection = await joinLiveSession(sessionUuid, accessToken)
      setPhase({ kind: 'room', connection, choices })
    } catch (err) {
      toast.error(t(liveErrorKey(err)))
      if (liveErrorCode(err) === 'SESSION_NOT_LIVE' || liveErrorCode(err) === 'SESSION_ENDED') void refetch()
    } finally {
      setJoining(false)
    }
  }

  // ---- Auth ---------------------------------------------------------------
  if (vbSession?.status === 'loading' || (isLoading && !!accessToken)) {
    return <StatusScreen loading title={t('live.states.preparing')} />
  }
  if (vbSession?.status === 'unauthenticated' || !accessToken) {
    const loginHref = `/login?redirect=${encodeURIComponent(`/course/${courseUuid}/live/${sessionUuid}`)}`
    return (
      <StatusScreen icon={<LogIn className="size-6" />} title={t('live.states.sign_in_title')} description={t('live.states.sign_in_description')}>
        <Link href={loginHref} className={primaryButton}>
          {t('live.states.sign_in')}
        </Link>
      </StatusScreen>
    )
  }

  // ---- In the room ------------------------------------------------------------
  // Rendered before any error handling: a failed background refetch must never
  // unmount a live call. LiveKit itself reports removals and room closure.
  if (phase.kind === 'room' && classroom) {
    return (
      <Classroom
        sessionUuid={sessionUuid}
        classroom={classroom}
        connection={phase.connection}
        choices={phase.choices}
        onExit={onExit}
      />
    )
  }

  // ---- Could not load / not allowed ------------------------------------------
  // A definitive answer (4xx) replaces stale data; a transient failure only
  // matters when there is nothing to show yet.
  const definitive = error instanceof LiveApiError && error.status >= 400 && error.status < 500
  if ((error && (definitive || !classroom)) || !classroom) {
    const code = liveErrorCode(error)
    if (code === 'NOT_FOUND') {
      return (
        <StatusScreen icon={<SearchX className="size-6" />} title={t('live.states.not_found_title')} description={t('live.states.not_found_description')}>
          {backToCourse}
        </StatusScreen>
      )
    }
    if (code === 'ENROLLMENT_REQUIRED') {
      // Invite links land here for students who can see the course but haven't
      // started it: one click enrols (with the course's own rules) and joins.
      const enroll = async () => {
        setEnrolling(true)
        try {
          await startCourse(`course_${courseUuid.replace(/^course_/, '')}`, orgslug, accessToken)
          await refetch()
        } catch {
          toast.error(t('live.invite.enroll_failed'))
        } finally {
          setEnrolling(false)
        }
      }
      return (
        <StatusScreen icon={<Lock className="size-6" />} tone="warning" title={t('live.invite.enroll_title')} description={t('live.invite.enroll_description')}>
          <button type="button" onClick={enroll} disabled={enrolling} className={primaryButton}>
            {t(enrolling ? 'live.invite.enrolling' : 'live.invite.enroll_and_join')}
          </button>
          <Link href={courseHref} className={secondaryButton}>
            {t('live.states.go_to_course')}
          </Link>
        </StatusScreen>
      )
    }
    if (code === 'PAYMENT_REQUIRED') {
      return (
        <StatusScreen icon={<Lock className="size-6" />} tone="warning" title={t('live.states.enroll_title')} description={t(liveErrorKey(error))}>
          <Link href={courseHref} className={primaryButton}>
            {t('live.states.go_to_course')}
          </Link>
        </StatusScreen>
      )
    }
    if (code === 'REMOVED_FROM_SESSION') {
      return (
        <StatusScreen icon={<Ban className="size-6" />} tone="danger" title={t('live.states.removed_title')} description={t('live.states.removed_description')}>
          {backToCourse}
        </StatusScreen>
      )
    }
    if (['FORBIDDEN', 'UNAUTHENTICATED', 'ACTIVITY_LOCKED', 'LIVE_STAFF_REQUIRED'].includes(code)) {
      return (
        <StatusScreen icon={<Lock className="size-6" />} tone="danger" title={t('live.states.unauthorized_title')} description={t(liveErrorKey(error))}>
          {backToCourse}
        </StatusScreen>
      )
    }
    return (
      <StatusScreen icon={<WifiOff className="size-6" />} tone="warning" title={t('live.states.load_failed_title')} description={t(liveErrorKey(error))}>
        <button type="button" onClick={() => refetch()} className={primaryButton}>
          {t('live.common.retry')}
        </button>
        {backToCourse}
      </StatusScreen>
    )
  }

  const staff = isStaffRole(classroom.role)
  const status = classroom.session.status
  const displayName =
    `${vbSession?.data?.user?.first_name ?? ''} ${vbSession?.data?.user?.last_name ?? ''}`.trim() ||
    vbSession?.data?.user?.username ||
    ''

  // ---- Lesson over -----------------------------------------------------------
  if (isEndedStatus(status) || (phase.kind === 'exited' && phase.reason === 'ended')) {
    return (
      <StatusScreen icon={<CheckCircle2 className="size-6" />} tone="success" title={t('live.states.ended_title')} description={t('live.states.ended_description')}>
        <Link href={courseHref} className={primaryButton}>
          {t('live.common.back_to_course')}
        </Link>
      </StatusScreen>
    )
  }

  // ---- Left / dropped ----------------------------------------------------------
  if (phase.kind === 'exited') {
    const rejoin = (
      <button type="button" onClick={() => setPhase({ kind: 'lobby' })} className={primaryButton}>
        {t(phase.reason === 'duplicate' ? 'live.states.use_this_tab' : 'live.states.rejoin')}
      </button>
    )
    if (phase.reason === 'removed') {
      return (
        <StatusScreen icon={<Ban className="size-6" />} tone="danger" title={t('live.states.removed_title')} description={t('live.states.removed_description')}>
          {backToCourse}
        </StatusScreen>
      )
    }
    if (phase.reason === 'duplicate') {
      return (
        <StatusScreen icon={<Copy className="size-6" />} title={t('live.states.duplicate_title')} description={t('live.states.duplicate_description')}>
          {rejoin}
          {backToCourse}
        </StatusScreen>
      )
    }
    if (phase.reason === 'failed') {
      return (
        <StatusScreen icon={<WifiOff className="size-6" />} tone="warning" title={t('live.states.connection_failed_title')} description={t('live.states.connection_failed_description')}>
          {rejoin}
          {backToCourse}
        </StatusScreen>
      )
    }
    return (
      <StatusScreen icon={<LogIn className="size-6" />} title={t('live.states.left_title')} description={t('live.states.left_description')}>
        {rejoin}
        {backToCourse}
      </StatusScreen>
    )
  }

  // ---- Lobby -----------------------------------------------------------------
  if (!staff && status !== 'live') {
    const when = new Date(classroom.session.scheduled_at).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })
    return (
      <StatusScreen
        icon={<Clock className="size-6" />}
        title={t('live.states.waiting_title')}
        description={
          <>
            <span className="block font-medium text-neutral-700">{classroom.session.title}</span>
            <span className="mt-1 block">{t('live.states.waiting_description', { when })}</span>
          </>
        }
      >
        {backToCourse}
      </StatusScreen>
    )
  }

  return (
    <PreJoin
      classroom={classroom}
      displayName={displayName}
      busy={joining}
      primaryLabel={t(staff ? (status === 'scheduled' ? 'live.prejoin.start' : 'live.prejoin.join_staff') : 'live.prejoin.join')}
      onJoin={join}
    />
  )
}
