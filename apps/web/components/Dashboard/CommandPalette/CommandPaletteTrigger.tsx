'use client'
import React, { useEffect, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useCommandPalette } from './CommandPaletteContext'

interface Props {
  isCollapsed?: boolean
}

export default function CommandPaletteTrigger({ isCollapsed = false }: Props) {
  const { t } = useTranslation()
  const { setOpen } = useCommandPalette()
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad/.test(navigator.platform))
    }
  }, [])

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('dashboard.search.trigger')}
        className="flex h-9 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MagnifyingGlass size={16} />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t('dashboard.search.trigger')}
      className="group flex h-9 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 text-start transition-colors hover:border-primary/40"
    >
      <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground group-hover:text-foreground" />
      <span className="flex-1 text-[12.5px] font-normal text-muted-foreground group-hover:text-foreground">
        {t('dashboard.search.trigger')}
      </span>
      <kbd className="hidden sm:inline-flex shrink-0 h-[18px] items-center rounded border border-border bg-background px-1.5 font-sans text-[10.5px] font-medium leading-none tracking-wide text-muted-foreground group-hover:text-foreground">
        {isMac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  )
}
