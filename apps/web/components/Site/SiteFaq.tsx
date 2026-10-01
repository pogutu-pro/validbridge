'use client'
import React, { useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { FAQ, type FaqItem } from '@lib/site/content'

/** Accordion; several items can be open at once. The first starts open. */
export default function SiteFaq({ items = FAQ }: { items?: FaqItem[] }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true })

  return (
    <div className="s-rules">
      {items.map((item, i) => {
        const isOpen = !!open[i]
        return (
          <div key={item.q}>
            <h3 className="!text-[17px] !font-semibold sm:!text-lg">
              <button
                type="button"
                id={`faq-q-${i}`}
                aria-expanded={isOpen}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpen((s) => ({ ...s, [i]: !s[i] }))}
                className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-start"
              >
                {item.q}
                <span className="s-faq-icon" data-open={isOpen} aria-hidden>
                  <Plus size={16} weight="bold" />
                </span>
              </button>
            </h3>
            <div
              id={`faq-a-${i}`}
              role="region"
              aria-labelledby={`faq-q-${i}`}
              className="s-faq-panel"
              data-open={isOpen}
              inert={!isOpen}
            >
              <div className="overflow-hidden">
                <p className="s-muted m-0 max-w-[640px] pb-6 leading-relaxed">{item.a}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
