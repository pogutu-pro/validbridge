'use client'

import { useMemo, useState } from 'react'
import { CalendarPlus, Check, Copy, Link2, Loader2, Mail, Share2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLiveAccessToken } from '@/hooks/queries/useLive'
import { getAbsoluteUriWithOrg } from '@services/config/config'
import { liveClassroomPath, sendLiveInvitations, type LiveSession } from '@services/live/live'
import { liveErrorKey } from './liveErrors'

const MAX_EMAILS = 100
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/

/** Split pasted text (commas, semicolons, spaces, new lines, "Name <a@b.c>") into addresses. */
export function parseEmails(raw: string): { valid: string[]; invalid: string[] } {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((token) => token.replace(/^<|>$/g, '').trim().toLowerCase())
    .filter(Boolean)
  const valid = Array.from(new Set(tokens.filter((token) => EMAIL_RE.test(token))))
  const invalid = tokens.filter((token) => !EMAIL_RE.test(token))
  return { valid, invalid }
}

export function googleCalendarUrl(title: string, details: string, startIso: string, minutes = 60): string {
  const start = new Date(startIso)
  const end = new Date(start.getTime() + minutes * 60_000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, details, dates: `${fmt(start)}/${fmt(end)}` })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

type InviteSession = Pick<LiveSession, 'session_uuid' | 'title' | 'scheduled_at' | 'status'>

/**
 * Meet-style "Add others": the classroom link is the invite. Opening it still
 * enforces course access, so sharing it never widens who can get in.
 */
export default function InviteDialog({
  session,
  courseUuid,
  courseName,
  orgslug,
  open,
  onOpenChange,
}: {
  session: InviteSession
  courseUuid: string
  courseName?: string
  /** Omit inside the classroom: the current page URL is then the link. */
  orgslug?: string
  open: boolean
  onOpenChange: (_open: boolean) => void
}) {
  const { t } = useTranslation()
  const token = useLiveAccessToken()
  const [copied, setCopied] = useState<'link' | 'info' | null>(null)
  const [emailsText, setEmailsText] = useState('')
  const [allEnrolled, setAllEnrolled] = useState(true)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const link = useMemo(() => {
    const path = liveClassroomPath(courseUuid, session.session_uuid)
    if (orgslug) return getAbsoluteUriWithOrg(orgslug, path)
    return typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : path
  }, [courseUuid, orgslug, session.session_uuid])

  const live = session.status === 'live' || session.status === 'ready'
  const when = live
    ? t('live.invite.happening_now')
    : new Date(session.scheduled_at).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })
  const details = [courseName, t('live.invite.join_with', { link })].filter(Boolean).join('\n')
  const joiningInfo = [session.title, courseName, when, '', t('live.invite.join_with', { link })]
    .filter((line) => line !== undefined)
    .join('\n')
  const calendarUrl = googleCalendarUrl(session.title, details, live ? new Date().toISOString() : session.scheduled_at)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const { valid, invalid } = parseEmails(emailsText)
  const canSend = !sending && (allEnrolled || valid.length > 0) && valid.length <= MAX_EMAILS

  const copy = async (what: 'link' | 'info') => {
    try {
      await navigator.clipboard.writeText(what === 'link' ? link : joiningInfo)
      setCopied(what)
      toast.success(t(what === 'link' ? 'live.invite.link_copied' : 'live.invite.info_copied'))
      window.setTimeout(() => setCopied((current) => (current === what ? null : current)), 2000)
    } catch {
      toast.error(t('live.invite.copy_failed'))
    }
  }

  const share = async () => {
    try {
      await navigator.share({ title: session.title, text: joiningInfo, url: link })
    } catch {
      /* dismissed */
    }
  }

  const send = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const { queued } = await sendLiveInvitations(
        session.session_uuid,
        { emails: valid, all_enrolled: allEnrolled, message: message.trim() || undefined },
        token
      )
      toast.success(t('live.invite.sent', { count: queued }))
      setEmailsText('')
      setMessage('')
      onOpenChange(false)
    } catch (error) {
      toast.error(t(liveErrorKey(error)))
    } finally {
      setSending(false)
    }
  }

  const action =
    'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50'
  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('live.invite.title')}</DialogTitle>
          <DialogDescription>{t('live.invite.description')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="link">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="link" className="gap-1.5">
              <Link2 className="size-4" /> {t('live.invite.tab_link')}
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="size-4" /> {t('live.invite.tab_email')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="link" className="space-y-4 pt-2">
            <div className="flex items-center gap-2 rounded-lg bg-neutral-100 p-1.5 ps-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-700" title={link}>
                {link}
              </span>
              <button
                type="button"
                onClick={() => copy('link')}
                aria-label={t('live.invite.copy_link')}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {copied === 'link' ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t(copied === 'link' ? 'live.invite.copied' : 'live.invite.copy')}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => copy('info')} className={action}>
                {copied === 'info' ? <Check className="size-4" /> : <Copy className="size-4" />}
                {t('live.invite.copy_info')}
              </button>
              <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className={action}>
                <CalendarPlus className="size-4" /> {t('live.invite.add_to_calendar')}
              </a>
              {canShare && (
                <button type="button" onClick={share} className={`${action} sm:col-span-2`}>
                  <Share2 className="size-4" /> {t('live.invite.share')}
                </button>
              )}
            </div>
            <p className="text-xs leading-relaxed text-neutral-500">{t('live.invite.access_note')}</p>
          </TabsContent>

          <TabsContent value="email" className="space-y-4 pt-2">
            <label className="flex items-start gap-3 rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={allEnrolled}
                onChange={(e) => setAllEnrolled(e.target.checked)}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span>
                {t('live.invite.all_enrolled')}
                <span className="block text-xs text-neutral-500">{t('live.invite.all_enrolled_hint')}</span>
              </span>
            </label>
            <div className="space-y-1.5">
              <label htmlFor="vb-live-invite-emails" className="text-sm font-medium text-neutral-800">
                {t('live.invite.emails_label')}
              </label>
              <textarea
                id="vb-live-invite-emails"
                value={emailsText}
                onChange={(e) => setEmailsText(e.target.value.slice(0, 10000))}
                rows={3}
                placeholder={t('live.invite.emails_placeholder')}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-xs text-neutral-500">
                {valid.length > MAX_EMAILS
                  ? t('live.invite.too_many', { max: MAX_EMAILS })
                  : invalid.length > 0
                    ? t('live.invite.invalid_emails', { list: invalid.slice(0, 3).join(', ') })
                    : t('live.invite.emails_hint')}
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="vb-live-invite-message" className="text-sm font-medium text-neutral-800">
                {t('live.invite.message_label')}
              </label>
              <textarea
                id="vb-live-invite-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                rows={2}
                placeholder={t('live.invite.message_placeholder')}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
                {t('live.invite.send')}
              </button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
