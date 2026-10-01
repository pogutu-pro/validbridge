'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUriWithOrg } from '@services/config/config'
import { Question, ChatCircleDots, Lifebuoy, Buildings } from '@phosphor-icons/react'
import { COMPANY } from '@lib/help/brand'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { FeedbackModal } from '@components/Objects/Modals/FeedbackModal'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'

export function HelpMenu({ orgslug, triggerClassName }: { orgslug?: string; triggerClassName?: string }) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  className={triggerClassName}
                  aria-label={t('common.help')}
                >
                  <Question size={18} weight="fill" />
                  <span>{t('common.help')}</span>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {t('common.help')}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex items-center gap-2">
            <Question size={16} weight="fill" />
            <span>{t('common.help')}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href={orgslug ? getUriWithOrg(orgslug, '/help') : '/help'}
              className="flex items-center gap-2"
            >
              <Lifebuoy size={16} weight="fill" />
              <span>Help Center</span>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setFeedbackModalOpen(true)}
            className="flex items-center gap-2"
          >
            <ChatCircleDots size={16} weight="fill" />
            <span>{t('common.help_menu.report_feedback')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a
              href={COMPANY.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Buildings size={14} weight="fill" />
              <span>ValidBridge by {COMPANY.name}</span>
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Feedback Modal */}
      <FeedbackModal
        open={feedbackModalOpen}
        onOpenChange={setFeedbackModalOpen}
        theme="light"
        userName={session?.data?.user?.username}
        userEmail={session?.data?.user?.email}
      />
    </>
  )
}