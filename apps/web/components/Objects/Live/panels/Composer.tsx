'use client'

import { useState, type KeyboardEvent } from 'react'
import { Loader2, SendHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const MAX_LENGTH = 1000

/** Message input: Enter sends, Shift+Enter adds a line. */
export default function Composer({
  placeholder,
  disabledReason,
  onSend,
}: {
  placeholder: string
  disabledReason?: string | null
  onSend: (_body: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const disabled = !!disabledReason

  const submit = async () => {
    const body = draft.trim()
    if (!body || sending || disabled) return
    setSending(true)
    const ok = await onSend(body)
    setSending(false)
    if (ok) setDraft('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  if (disabled) {
    return (
      <p className="border-t border-neutral-100 px-4 py-3 text-center text-xs text-neutral-500">{disabledReason}</p>
    )
  }

  return (
    <div className="border-t border-neutral-100 p-3">
      <div className="flex items-end gap-2 rounded-xl bg-neutral-50 p-1.5 ring-1 ring-neutral-200 focus-within:ring-2 focus-within:ring-primary/60">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 [field-sizing:content]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || sending}
          aria-label={t('live.chat.send')}
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition',
            'disabled:bg-neutral-200 disabled:text-neutral-400'
          )}
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </button>
      </div>
      {draft.length > MAX_LENGTH - 200 && (
        <p className="mt-1 text-end text-[11px] text-neutral-400">
          {draft.length}/{MAX_LENGTH}
        </p>
      )}
    </div>
  )
}
