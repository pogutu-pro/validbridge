import type { Metadata } from 'next'
import SchoolRevenueDetail from '@components/Admin/SchoolRevenueDetail'

export const metadata: Metadata = {
  title: 'School revenue',
}

export default function AdminSchoolRevenuePage() {
  return (
    <div className="p-8">
      <SchoolRevenueDetail />
    </div>
  )
}
