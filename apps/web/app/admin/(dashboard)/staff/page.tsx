import React from 'react'
import type { Metadata } from 'next'
import StaffManager from '@components/Admin/StaffManager'

export const metadata: Metadata = {
  title: 'Staff',
}

export default function AdminStaffPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">Staff</h1>
        <p className="mt-1 text-[#737373]">
          Give teammates Support or Finance access to the console. Owners keep full control.
        </p>
      </div>
      <StaffManager />
    </div>
  )
}
