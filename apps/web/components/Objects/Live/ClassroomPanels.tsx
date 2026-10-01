'use client'

import dynamic from 'next/dynamic'
import { useParticipants } from '@livekit/components-react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { BarChart3, CircleHelp, ClipboardList, GraduationCap, Info, MessageSquare, Users, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useClassroom, type PanelTab, type UnreadTab } from './ClassroomContext'
import ChatPanel from './panels/ChatPanel'
import ParticipantsPanel from './panels/ParticipantsPanel'
import PollsPanel from './panels/PollsPanel'
import QuestionsPanel from './panels/QuestionsPanel'
import InfoPanel from './panels/InfoPanel'
import QuizPanel from './panels/QuizPanel'

const AttendancePanel = dynamic(() => import('./panels/AttendancePanel'))

interface TabDef {
  id: PanelTab
  icon: LucideIcon
  labelKey: string
  staffOnly?: boolean
}

export const PANEL_TABS: TabDef[] = [
  { id: 'chat', icon: MessageSquare, labelKey: 'live.panels.chat' },
  { id: 'questions', icon: CircleHelp, labelKey: 'live.panels.questions' },
  { id: 'polls', icon: BarChart3, labelKey: 'live.panels.polls' },
  { id: 'quiz', icon: GraduationCap, labelKey: 'live.panels.quiz' },
  { id: 'people', icon: Users, labelKey: 'live.panels.people' },
  { id: 'info', icon: Info, labelKey: 'live.panels.info' },
  { id: 'attendance', icon: ClipboardList, labelKey: 'live.panels.attendance', staffOnly: true },
]

export function useVisibleTabs() {
  const { isStaff } = useClassroom()
  return PANEL_TABS.filter((tab) => !tab.staffOnly || isStaff)
}

function PanelBody({ tab }: { tab: PanelTab }) {
  switch (tab) {
    case 'chat':
      return <ChatPanel />
    case 'questions':
      return <QuestionsPanel />
    case 'polls':
      return <PollsPanel />
    case 'quiz':
      return <QuizPanel />
    case 'people':
      return <ParticipantsPanel />
    case 'attendance':
      return <AttendancePanel />
    default:
      return <InfoPanel />
  }
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="absolute -end-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
      {count > 9 ? '9+' : count}
    </span>
  )
}

function TabButtons({ size, dark = false }: { size: 'desktop' | 'mobile'; dark?: boolean }) {
  const { t } = useTranslation()
  const { tab: active, openPanel, unread } = useClassroom()
  const participants = useParticipants()
  const tabs = useVisibleTabs()

  return (
    <div
      role="tablist"
      aria-label={t('live.panels.label')}
      className={cn('flex gap-1', size === 'mobile' ? 'overflow-x-auto px-3 pb-2 scrollbar-hide' : 'flex-wrap')}
    >
      {tabs.map(({ id, icon: Icon, labelKey }) => {
        const count = id in unread ? unread[id as UnreadTab] : 0
        const selected = active === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => openPanel(id)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium transition',
              size === 'mobile' ? 'h-10 px-4 text-sm' : 'h-9 px-3 text-xs',
              dark
                ? selected
                  ? 'bg-white text-neutral-900'
                  : 'bg-white/10 text-white/85 hover:bg-white/15'
                : selected
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100'
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(labelKey)}
            {id === 'people' && (
              <span className={cn(dark ? (selected ? 'text-neutral-500' : 'text-white/50') : selected ? 'text-white/70' : 'text-neutral-400')}>
                {participants.length}
              </span>
            )}
            <UnreadDot count={count} />
          </button>
        )
      })}
    </div>
  )
}

/** Desktop: Meet-style card docked beside the stage; opened from the
 * control bar's panel icons, so the header just names it. */
export function SidePanel() {
  const { t } = useTranslation()
  const { tab, closePanel } = useClassroom()
  const current = PANEL_TABS.find((p) => p.id === tab)
  return (
    <aside
      className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-2xl bg-white text-neutral-900 shadow-2xl"
      aria-label={current ? t(current.labelKey) : t('live.panels.label')}
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-5">
        <h2 className="text-lg font-medium text-neutral-900">{current ? t(current.labelKey) : ''}</h2>
        <button
          type="button"
          onClick={closePanel}
          aria-label={t('live.panels.close')}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100"
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1" role="tabpanel">
        <PanelBody tab={tab} />
      </div>
    </aside>
  )
}

/** Mobile: tabs under the video that open a bottom sheet. */
export function MobilePanelTabs() {
  return <TabButtons size="mobile" dark />
}

export function MobileSheet() {
  const { t } = useTranslation()
  const { tab, panelOpen, closePanel } = useClassroom()
  return (
    <DialogPrimitive.Root open={panelOpen} onOpenChange={(open) => !open && closePanel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-black/40" style={{ zIndex: 'var(--z-modal-backdrop)' }} />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 flex h-[85dvh] flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl outline-none"
          style={{ zIndex: 'var(--z-modal)' }}
        >
          <DialogPrimitive.Title className="sr-only">{t('live.panels.label')}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{t('live.panels.description')}</DialogPrimitive.Description>
          <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 rounded-full bg-neutral-200" aria-hidden />
          <div className="flex items-center gap-1 pe-2">
            <div className="min-w-0 flex-1 pt-1">
              <TabButtons size="mobile" />
            </div>
            <DialogPrimitive.Close
              aria-label={t('live.panels.close')}
              className="mb-2 flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 border-t border-neutral-100">
            <PanelBody tab={tab} />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
