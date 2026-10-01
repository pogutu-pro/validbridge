'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'

/**
 * Mounts the Copilot drawer for the managerial dashboard.
 *
 * Two things matter here:
 *
 * 1. `dynamic()` with `ssr: false`. The drawer pulls in the i18n, org and
 *    session contexts plus the SSE transport; loading it eagerly would put all
 *    of that in the /dash bundle for users who never open the copilot.
 *
 * 2. A portal onto `document.body`. ClientAdminLayout wraps page content in
 *    `relative isolate`, and `isolate` creates a containing block for
 *    `position: fixed` descendants. Without the portal the panel would be
 *    pinned inside that container instead of the viewport, and would slide in
 *    from the wrong edge.
 */
const AICopilotDrawer = dynamic(
  () => import('@components/Copilot/AICopilotDrawer'),
  { ssr: false }
)

export default function GenieCopilotHost({ orgslug }: { orgslug?: string }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // No portal target during SSR / first paint.
  if (!mounted || !orgslug) return null

  return createPortal(<AICopilotDrawer orgslug={orgslug} />, document.body)
}
