'use client'
import React from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { getOrgCustomers } from '@services/payments/payments'
import { Badge } from '@components/ui/badge'
import PageLoading from '@components/Objects/Loaders/PageLoading'
import {
  RefreshCcw,
  SquareCheck,
} from 'lucide-react'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import UserAvatar from '@components/Objects/UserAvatar'
import { usePaymentsEnabled } from '@hooks/usePaymentsEnabled'
import UnconfiguredPaymentsDisclaimer from '@components/Pages/Payments/UnconfiguredPaymentsDisclaimer'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@components/ui/table'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(amount: number, currency = 'KES') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Active',    cls: 'bg-green-100 text-green-700' },
  completed: { label: 'Completed', cls: 'bg-blue-100 text-blue-700' },
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700' },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
  canceled:  { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500' },
  refunded:  { label: 'Refunded',  cls: 'bg-orange-100 text-orange-700' },
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

function Empty({ message }: { message: string }) {
  return <div className="bg-white border border-gray-200 rounded-xl py-12 text-center text-sm text-gray-400">{message}</div>
}

// ---------------------------------------------------------------------------
// Customers list (org-scoped enrollments)
// ---------------------------------------------------------------------------
function CustomersTab({ orgId, accessToken }: { orgId: number; accessToken: string }) {
  const { data: customers, error, isLoading } = useQuery({
    queryKey: queryKeys.payments.customers(orgId),
    queryFn: () => getOrgCustomers(orgId, accessToken),
    enabled: !!(orgId && accessToken),
    staleTime: 60_000,
  })

  if (isLoading) return <PageLoading />
  if (error) return <div className="p-6 text-sm text-red-500">Error loading customers</div>
  if (!customers || customers.length === 0) {
    return <Empty message="No customers yet" />
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Offer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Since</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((item: any) => {
            const offer = item.offer
            return (
              <TableRow key={item.enrollment_id}>
                <TableCell>
                  <div className="flex items-center space-x-3">
                    <UserAvatar
                      border="border-2"
                      rounded="rounded-md"
                      avatar_url={getUserAvatarMediaDirectory(item.user?.user_uuid, item.user?.avatar_image)}
                    />
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">
                        {item.user?.first_name ? `${item.user.first_name} ${item.user.last_name ?? ''}`.trim() : item.user?.username}
                      </span>
                      <span className="text-xs text-gray-400 truncate">{item.user?.email}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{offer?.name ?? '—'}</TableCell>
                <TableCell>
                  {offer?.offer_type === 'subscription' ? (
                    <Badge variant="outline" className="flex items-center gap-1 w-fit"><RefreshCcw size={11} /><span>Subscription</span></Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 w-fit"><SquareCheck size={11} /><span>One-time</span></Badge>
                  )}
                </TableCell>
                <TableCell>{offer ? fmt(offer.amount, offer.currency) : '—'}</TableCell>
                <TableCell><StatusPill status={item.status} /></TableCell>
                <TableCell className="text-sm text-gray-500">{fmtDate(item.creation_date)}</TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function PaymentsCustomersPage() {
  const org = useOrg() as any
  const session = useVBSession() as any
  const access_token = session?.data?.tokens?.access_token
  const { isEnabled, isLoading } = usePaymentsEnabled()

  if (!isEnabled && !isLoading) return <UnconfiguredPaymentsDisclaimer />
  if (isLoading) return <PageLoading />

  return (
    <div className="ms-10 me-10 mx-auto space-y-4">
      <CustomersTab orgId={org.id} accessToken={access_token} />
    </div>
  )
}

export default PaymentsCustomersPage
