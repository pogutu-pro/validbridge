'use client'

import { createContext, useContext } from 'react'
import type { LiveClassroom, LiveRole } from '@services/live/live'

export type PanelTab = 'people' | 'chat' | 'questions' | 'polls' | 'quiz' | 'info' | 'attendance'
export type UnreadTab = 'chat' | 'questions' | 'polls' | 'quiz'

export interface FloatingReaction {
  id: string
  emoji: string
  name: string
}

export interface ClassroomContextValue {
  sessionUuid: string
  classroom: LiveClassroom
  role: LiveRole
  isStaff: boolean
  userUuid: string
  accessToken?: string
  isDesktop: boolean
  panelOpen: boolean
  tab: PanelTab
  openPanel: (_tab?: PanelTab) => void
  closePanel: () => void
  unread: Record<UnreadTab, number>
  bumpUnread: (_tab: UnreadTab) => void
  reactions: FloatingReaction[]
  pushReaction: (_reaction: Omit<FloatingReaction, 'id'>) => void
  leave: () => void
  endForEveryone: () => Promise<void>
}

export const ClassroomContext = createContext<ClassroomContextValue | null>(null)

export function useClassroom(): ClassroomContextValue {
  const value = useContext(ClassroomContext)
  if (!value) throw new Error('useClassroom must be used inside the LiveBridge classroom')
  return value
}
