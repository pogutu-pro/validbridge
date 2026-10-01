'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, HelpCircle, Lightbulb, Megaphone, Star } from 'lucide-react'
import { DISCUSSION_LABELS } from '@services/communities/discussions'
import { cn } from '@/lib/utils'

interface CommunityLabelChipsProps {
  value: string | null
  onChange: (value: string | null) => void
}

function getLabelIcon(iconName: string) {
  switch (iconName) {
    case 'HelpCircle':
      return <HelpCircle size={13} className="flex-shrink-0" />
    case 'Lightbulb':
      return <Lightbulb size={13} className="flex-shrink-0" />
    case 'Megaphone':
      return <Megaphone size={13} className="flex-shrink-0" />
    case 'Star':
      return <Star size={13} className="flex-shrink-0" />
    default:
      return <MessageSquare size={13} className="flex-shrink-0" />
  }
}

export function CommunityLabelChips({ value, onChange }: CommunityLabelChipsProps) {
  const { t } = useTranslation()

  return (
    <div
      role="tablist"
      aria-label={t('communities.label_filter.label', { defaultValue: 'Filter by category' })}
      className="flex items-center gap-2 overflow-x-auto scrollbar-hide py-1 px-0.5 flex-nowrap scroll-smooth"
    >
      {/* "All" category pill */}
      <button
        type="button"
        role="tab"
        aria-selected={value === null}
        onClick={() => onChange(null)}
        className={cn(
          'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer',
          value === null
            ? 'bg-foreground text-background shadow-xs font-semibold'
            : 'bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/70 hover:border-border'
        )}
      >
        <MessageSquare size={13} className="flex-shrink-0" />
        <span>{t('communities.label_filter.all', { defaultValue: 'All' })}</span>
      </button>

      {/* Label category pills: General, Question, Idea, Announcement, Showcase */}
      {DISCUSSION_LABELS.map((label) => {
        const isActive = value === label.id
        return (
          <button
            key={label.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(isActive ? null : label.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer',
              isActive
                ? 'shadow-xs font-semibold'
                : 'bg-muted/70 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/70 hover:border-border'
            )}
            style={
              isActive
                ? { backgroundColor: label.color, color: '#ffffff' }
                : undefined
            }
          >
            <span
              style={isActive ? { color: '#ffffff' } : { color: label.color }}
              className="flex-shrink-0"
            >
              {getLabelIcon(label.icon)}
            </span>
            <span>{t(`communities.labels.${label.id}`)}</span>
          </button>
        )
      })}
    </div>
  )
}

export default CommunityLabelChips
