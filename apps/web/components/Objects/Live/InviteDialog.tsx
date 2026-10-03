'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, CalendarPlus, Check, Copy, Link2, Loader2, Mail, MessageCircle, Radio, Send, Share2 } from 'lucide-react'
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
import { useOrg } from '@components/Contexts/OrgContext'
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
  const org = useOrg() as any
  const orgName: string = org?.name ?? ''
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
  // Prefilled shares name the school, the lesson, when, and the link, so the
  // message makes sense to someone who sees it out of context.
  const shareText = t('live.invite.share_message', {
    org: orgName || courseName || 'ValidBridge',
    title: session.title,
    course: courseName ? ` (${courseName})` : '',
    when,
    link,
  })
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(
    t('live.invite.email_subject', { title: session.title, org: orgName || courseName || 'ValidBridge' })
  )}&body=${encodeURIComponent(shareText)}`
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
      await navigator.share({ title: session.title, text: shareText })
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

  const shareBtn =
    'inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium ring-1 transition-colors'
  const neutral = `${shareBtn} text-neutral-700 ring-neutral-200 hover:bg-neutral-50`
  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      {/* The shared DialogContent carries no padding; this dialog sets its own
          and caps its width so a long lesson link truncates instead of
          stretching the dialog past the viewport. */}
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg overflow-hidden p-0">
        <DialogHeader className="space-y-1 px-6 pt-6 pe-14 text-start">
          <DialogTitle>{t('live.invite.title')}</DialogTitle>
          <DialogDescription>{t('live.invite.description')}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 px-6 pb-6 pt-4">
          {/* What is being shared — so the sender can sanity-check it. */}
          <div className="mb-4 flex min-w-0 items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <span className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${live ? 'bg-red-100 text-red-600' : 'bg-primary/10 text-primary'}`}>
              {live ? <Radio className="size-4" /> : <CalendarClock className="size-4" />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{session.title}</p>
              <p className="truncate text-xs text-neutral-500">
                {[orgName, courseName].filter(Boolean).join(' · ')}
              </p>
              <p className={`text-xs font-medium ${live ? 'text-red-600' : 'text-neutral-600'}`}>{when}</p>
            </div>
          </div>

          <Tabs defaultValue="link" className="min-w-0">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="link" className="gap-1.5">
                <Link2 className="size-4" /> {t('live.invite.tab_link')}
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-1.5">
                <Send className="size-4" /> {t('live.invite.tab_email')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="min-w-0 space-y-4 pt-3">
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white p-1.5 ps-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-600" title={link}>
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

              <div className="min-w-0">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  {t('live.invite.share_via')}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${shareBtn} bg-[#25D366] text-white ring-[#25D366] hover:bg-[#1ebe5b]`}
                  >
                    <MessageCircle className="size-4 shrink-0" />
                    <span className="truncate">{t('live.invite.whatsapp')}</span>
                  </a>
                  <a href={mailtoUrl} className={neutral}>
                    <Mail className="size-4 shrink-0" />
                    <span className="truncate">{t('live.invite.email_app')}</span>
                  </a>
                  <button type="button" onClick={() => copy('info')} className={neutral}>
                    {copied === 'info' ? <Check className="size-4 shrink-0" /> : <Copy className="size-4 shrink-0" />}
                    <span className="truncate">{t('live.invite.copy_info')}</span>
                  </button>
                  <a href={calendarUrl} target="_blank" rel="noopener noreferrer" className={neutral}>
                    <CalendarPlus className="size-4 shrink-0" />
                    <span className="truncate">{t('live.invite.add_to_calendar')}</span>
                  </a>
                  {canShare && (
                    <button type="button" onClick={share} className={`${neutral} col-span-2`}>
                      <Share2 className="size-4 shrink-0" />
                      <span className="truncate">{t('live.invite.share')}</span>
                    </button>
                  )}
                </div>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
