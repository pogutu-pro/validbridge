import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

export default function PanelState({
  icon,
  title,
  description,
  loading = false,
  action,
}: {
  icon?: ReactNode
  title?: string
  description?: string
  loading?: boolean
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 py-8 text-center">
      {loading ? (
        <Loader2 className="size-5 animate-spin text-neutral-400" aria-hidden />
      ) : (
        <>
          {icon && <span className="mb-3 flex size-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">{icon}</span>}
          {title && <p className="text-sm font-medium text-neutral-800">{title}</p>}
          {description && <p className="mt-1 text-xs leading-relaxed text-neutral-500">{description}</p>}
          {action && (
            <button type="button" onClick={action.onClick} className="mt-3 text-sm font-medium text-primary hover:underline">
              {action.label}
            </button>
          )}
        </>
      )}
    </div>
  )
}
