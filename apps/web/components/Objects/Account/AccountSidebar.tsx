'use client'
import React from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { User, Lock, ShoppingBag, ReceiptText, Settings } from 'lucide-react'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import UserAvatar from '@components/Objects/UserAvatar'
import { getUriWithOrg } from '@services/config/config'

interface AccountSidebarProps {
  orgslug: string
  currentSubpage: string
}

const NAV_ITEMS = [
  { id: 'general', icon: Settings, labelKey: 'account.general' },
  { id: 'profile', icon: User, labelKey: 'account.profile' },
  { id: 'security', icon: Lock, labelKey: 'account.security' },
  { id: 'purchases', icon: ShoppingBag, labelKey: 'account.purchases' },
  { id: 'billing', icon: ReceiptText, labelKey: 'account.billing' },
]

export function AccountSidebar({ orgslug, currentSubpage }: AccountSidebarProps) {
  const { t } = useTranslation()
  const session = useVBSession() as any
  const user = session?.data?.user

  return (
    <div className="space-y-4">
      {/* User Info Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* User Profile Header */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex flex-col items-center text-center">
            <UserAvatar
              border="border-4"
              rounded="rounded-full"
              width={80}
            />
            <div className="mt-3">
              <h2 className="font-semibold text-slate-900">
                {user?.first_name} {user?.last_name}
              </h2>
              <p className="text-sm text-slate-500">@{user?.username}</p>
            </div>
          </div>
        </div>

        {/* User Bio (truncated) */}
        {user?.bio && (
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-sm text-slate-600 leading-relaxed line-clamp-3">
              {user.bio}
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="p-2">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = currentSubpage === item.id
              return (
                <Link
                  key={item.id}
                  href={getUriWithOrg(orgslug, `/account/${item.id}`)}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                    isActive
                      ? 'bg-orange-50/80 text-[#FF5A1F] font-semibold shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <span className="absolute start-0 top-2 bottom-2 w-1 bg-[#FF5A1F] rounded-r-full shadow-sm shadow-[#FF5A1F]/40" />
                  )}
                  <Icon size={18} className={isActive ? 'text-[#FF5A1F]' : 'text-slate-400'} />
                  <span className="text-sm font-medium">{t(item.labelKey)}</span>
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </div>
  )
}

export default AccountSidebar
