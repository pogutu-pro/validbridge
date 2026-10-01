'use client'

import { useTranslation } from 'react-i18next'
import { useClassroom } from '../ClassroomContext'

/** null when the caller may post; otherwise the reason they can't (mirrors the API). */
export function useCanInteract(): string | null {
  const { t } = useTranslation()
  const { classroom, isStaff } = useClassroom()
  const status = classroom.session.status
  if (status === 'live' || (status === 'ready' && isStaff)) return null
  if (status === 'scheduled' || status === 'ready') return t('live.errors.not_live')
  return t('live.errors.session_ended')
}
