import React from 'react'
import type { Metadata } from 'next'
import GlobalAnalytics from '@components/Admin/GlobalAnalytics'

export const metadata: Metadata = {
  title: 'Analytics',
}

export default function AdminAnalyticsPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#262626]">Global Analytics</h1>
        <p className="text-[#737373] mt-1">
          Cross-organization analytics overview
        </p>
      </div>
      <GlobalAnalytics days={30} />
    </div>
  )
}
