import React from 'react'
import type { Metadata } from 'next'
import PublicEdReview from '@components/Admin/PublicEdReview'

export const metadata: Metadata = {
  title: 'Public Education',
}

export default function AdminPublicEducationPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">Public Education</h1>
        <p className="mt-1 text-[#737373]">
          Review verification requests from public institutions. Approving moves the school to the free Public
          Education plan for 12 months.
        </p>
      </div>
      <PublicEdReview />
    </div>
  )
}
