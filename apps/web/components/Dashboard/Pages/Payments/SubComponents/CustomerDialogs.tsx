'use client'
// Add a customer by hand, or change one. For payments made outside Paystack, demo rows and mistakes.
import React, { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@components/Objects/StyledElements/Modal/Modal'
import { queryKeys } from '@/lib/query/keys'
import { getOffers } from '@services/payments/offers'
import { addCustomer, updateCustomer } from '@services/payments/payments'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

const field = 'h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-400'
const label = 'mb-1 block text-xs font-semibold text-gray-600'

function Footer({ busy, onCancel, submit }: { busy: boolean; onCancel: () => void; submit: string }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onCancel} className="h-10 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">
        Cancel
      </button>
      <button type="submit" disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
        {busy && <Loader2 className="size-4 animate-spin" />} {submit}
      </button>
    </div>
  )
}

export function AddCustomerDialog({ open, onClose, orgId, token }: { open: boolean; onClose: () => void; orgId: number; token: string }) {
  const queryClient = useQueryClient()
  const [offerId, setOfferId] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'completed' | 'pending'>('completed')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const offers = useQuery({
    queryKey: queryKeys.payments.offers(orgId),
    queryFn: () => getOffers(orgId, token),
    enabled: open && !!orgId && !!token,
  })
  const list: any[] = Array.isArray(offers.data?.data) ? offers.data.data : []
  const chosen = list.find((o) => String(o.id) === offerId)

  const close = () => {
    setOfferId(''); setEmail(''); setStatus('completed'); setAmount(''); setNote('')
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await addCustomer(
        orgId,
        { offer_id: Number(offerId), email: email.trim(), status, amount: amount ? Number(amount) : undefined, note: note.trim() || undefined },
        token
      )
      if (!res.success) {
        toast.error(getErrorMessage(res.data?.detail, 'Could not add the customer.'))
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.customers(orgId) })
      toast.success(status === 'completed' ? 'Customer added with access.' : 'Customer added as pending.')
      close()
    } finally {
      setBusy(false)
    }
  }

  const content = (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-600">
        For someone who paid outside the platform, such as cash or M-PESA to your own number. They need an account on your school already.
      </p>
      <div>
        <label className={label} htmlFor="cust-offer">Offer</label>
        <select id="cust-offer" required className={field} value={offerId} onChange={(e) => setOfferId(e.target.value)}>
          <option value="">Choose an offer</option>
          {list.filter((o) => o.offer_type !== 'subscription').map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="cust-email">Student email</label>
        <input id="cust-email" required type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.com" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="cust-status">Status</label>
          <select id="cust-status" className={field} value={status} onChange={(e) => setStatus(e.target.value as 'completed' | 'pending')}>
            <option value="completed">Paid, give access</option>
            <option value="pending">Pending, no access yet</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="cust-amount">Amount paid{chosen?.total_amount ? ` (full price ${chosen.total_amount})` : ''}</label>
          <input id="cust-amount" type="number" min={0} step="any" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={chosen ? String(chosen.amount) : ''} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="cust-note">Note (kept on the record)</label>
        <input id="cust-note" maxLength={500} className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid cash at the office, receipt 204" />
      </div>
      <Footer busy={busy} onCancel={close} submit="Add customer" />
    </form>
  )
  return <Modal isDialogOpen={open} onOpenChange={(o) => !o && close()} dialogTitle="Add a customer" dialogContent={content} minHeight="no-min" />
}

export function EditCustomerDialog({
  customer, onClose, orgId, token,
}: { customer: any | null; onClose: () => void; orgId: number; token: string }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<string | null>(null)
  const [paid, setPaid] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const inParts = customer?.total_amount != null

  const close = () => {
    setStatus(null); setPaid(null); setNote('')
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customer) return
    const body: { status?: string; amount_paid?: number; note?: string } = {}
    if (status && status !== customer.status) body.status = status
    if (paid !== null && paid !== '' && Number(paid) !== (customer.amount_paid ?? 0)) body.amount_paid = Number(paid)
    if (!body.status && body.amount_paid === undefined) {
      close()
      return
    }
    if (note.trim()) body.note = note.trim()
    setBusy(true)
    try {
      const res = await updateCustomer(orgId, customer.enrollment_id, body, token)
      if (!res.success) {
        toast.error(getErrorMessage(res.data?.detail, 'Could not update the customer.'))
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.payments.customers(orgId) })
      toast.success('Customer updated.')
      close()
    } finally {
      setBusy(false)
    }
  }

  const name = customer?.user?.first_name ? `${customer.user.first_name} ${customer.user.last_name ?? ''}`.trim() : customer?.user?.username
  const content = customer && (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-600">{name} · {customer.offer?.name}</p>
      <div>
        <label className={label} htmlFor="edit-status">Status</label>
        <select id="edit-status" className={field} value={status ?? customer.status} onChange={(e) => setStatus(e.target.value)} disabled={customer.has_live_subscription}>
          <option value="pending">Pending (no access)</option>
          <option value="completed" disabled={customer.offer?.offer_type === 'subscription'}>Paid (access)</option>
          <option value="cancelled">Cancelled (no access)</option>
          <option value="refunded">Refunded (no access)</option>
          <option value="failed">Failed (no access)</option>
          {['active'].includes(customer.status) && <option value="active">Active subscription</option>}
        </select>
        {customer.has_live_subscription && <p className="mt-1 text-xs text-gray-500">This is a live Paystack subscription. Cancel it in Paystack or from the student's side first.</p>}
      </div>
      {inParts && (
        <div>
          <label className={label} htmlFor="edit-paid">Amount paid so far (full price {customer.total_amount})</label>
          <input id="edit-paid" type="number" min={0} max={customer.total_amount} step="any" className={field} value={paid ?? String(customer.amount_paid ?? 0)} onChange={(e) => setPaid(e.target.value)} />
        </div>
      )}
      <div>
        <label className={label} htmlFor="edit-note">Note (kept on the record)</label>
        <input id="edit-note" maxLength={500} className={field} value={note} onChange={(e) => setNote(e.target.value)} placeholder="M-PESA code QK12..." />
      </div>
      <Footer busy={busy} onCancel={close} submit="Save" />
    </form>
  )
  return <Modal isDialogOpen={!!customer} onOpenChange={(o) => !o && close()} dialogTitle="Edit customer" dialogContent={content || <div />} minHeight="no-min" />
}
