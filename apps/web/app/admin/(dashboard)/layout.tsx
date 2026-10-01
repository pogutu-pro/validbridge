'use client'
import AdminSidebar from '@components/Admin/AdminSidebar'
import SuperadminAuthorization from '@components/Security/SuperadminAuthorization'
import React from 'react'

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SuperadminAuthorization>
      <div className="flex min-h-screen bg-[#F8F7F2]">
        <AdminSidebar />
        <main className="flex-1 min-w-0 p-6 overflow-x-hidden">{children}</main>
      </div>
    </SuperadminAuthorization>
  )
}
