import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LiveBridgeBrand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight text-neutral-900', className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Radio className="size-4" aria-hidden />
      </span>
      {!compact && <span>LiveBridge</span>}
    </span>
  )
}
