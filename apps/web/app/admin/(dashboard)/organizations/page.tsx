import React from 'react'
import type { Metadata } from 'next'
import OrganizationList from '@components/Admin/OrganizationList'

export const metadata: Metadata = {
  title: 'Organizations',
}

export default function AdminOrganizationsPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">Organizations</h1>
        <p className="text-[#737373] mt-1">
          Manage all organizations across the platform
        </p>
      </div>
      <OrganizationList />
    </div>
  )
}
