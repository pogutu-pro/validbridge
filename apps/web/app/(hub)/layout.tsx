import type { ReactNode } from 'react'

// Root org-management hub (create / upgrade / delete orgs, billing, account).
//
// This build is ungated: the enterprise deployment-mode gates were removed and
// `get_deployment_mode()` always reports 'ee' with every feature enabled. The
// hub is therefore always available — the SaaS-only 404 gate that used to call
// notFound() for non-saas modes no longer applies.
export const dynamic = 'force-dynamic'

export default function HubLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}