import React from 'react'
import Image from 'next/image'

/** Mark + one-word wordmark, orange on "Bridge". */
export default function SiteLogo({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em] text-[var(--s-text)]">
      <Image src="/site-mark.jpg" alt="" width={size} height={size} className="block rounded-md object-contain" />
      <span className="whitespace-nowrap">
        Valid<span className="text-[var(--s-accent)]">Bridge</span>
      </span>
    </span>
  )
}
