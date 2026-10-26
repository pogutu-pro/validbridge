import React from 'react'
import type { Metadata } from 'next'
import AuditLogViewer from '@components/Admin/AuditLogViewer'

export const metadata: Metadata = {
  title: 'Audit log',
}

export default function AdminAuditPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">Audit log</h1>
        <p className="mt-1 text-[#737373]">
          Every change made from the platform console: who did it, to which school, why, and what it changed.
        </p>
      </div>
      <AuditLogViewer />
    </div>
  )
}
