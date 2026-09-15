'use client'
import {
  Buildings,
  ChartBar,
  Key,
  SignOut,
  User,
  Users,
} from '@phosphor-icons/react'
import { signOut } from '@components/Contexts/AuthContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import Link from 'next/link'
import React from 'react'

function AdminTopMenu() {
  const session = useVBSession() as any

  async function logOutUI() {
    await signOut({ redirect: true, callbackUrl: '/admin/login' })
  }

  if (!session) return null

  const user = session?.data?.user
  const avatarUrl = user?.avatar_image
    ? user.avatar_image.startsWith('http')
      ? user.avatar_image
      : getUserAvatarMediaDirectory(user.user_uuid, user.avatar_image)
    : null

  return (
    <>
      {/* Spacer to push content below the fixed menu */}
      <div className="h-14" />
      {/* Fixed menu bar */}
      <div
        className="fixed top-0 start-0 end-0 h-14 bg-[#F8F7F2] border-b border-[#E7E5E4] flex items-center text-[#262626] px-4 gap-6"
        style={{ zIndex: 'var(--z-overlay)' }}
      >
        {/* Logo */}
        <Link className="flex items-center gap-2 transition-opacity hover:opacity-70 shrink-0" href="/admin">
          <img src="/validbridge-dash.svg" alt="ValidBridge logo" className="h-7 w-7" />
          <span className="font-semibold text-sm text-[#262626]">Admin</span>
          <span className="text-[9px] font-medium uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
            Superadmin
          </span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          <NavLink
            href="/admin/organizations"
            icon={<Buildings size={16} weight="fill" />}
            label="Organizations"
          />
          <NavLink
            href="/admin/users"
            icon={<Users size={16} weight="fill" />}
            label="Users"
          />
          <NavLink
            href="/admin/analytics"
            icon={<ChartBar size={16} weight="fill" />}
            label="Analytics"
          />
          <NavLink
            href="/admin/developers"
            icon={<Key size={16} weight="fill" />}
            label="Developers"
          />
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User section */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-6 h-6 rounded-full object-cover bg-gray-700"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center">
                <User size={14} weight="fill" className="text-[#737373]/80" />
              </div>
            )}
            <span className="text-sm text-[#737373]/80 hidden sm:inline">
              {user?.username}
            </span>
          </div>
          <button
            onClick={logOutUI}
            className="flex items-center gap-1.5 rounded-lg text-red-500 hover:text-red-400 hover:bg-black/[0.04] transition-all px-2 py-1.5"
            title="Sign Out"
          >
            <SignOut size={16} weight="fill" data-dir-flip />
            <span className="text-xs font-medium hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </div>
    </>
  )
}

const NavLink = ({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) => {
  return (
    <Link aria-label={label} href={href}>
      <div className="flex items-center rounded-lg text-[#737373]/80 hover:text-[#262626] hover:bg-black/[0.04] transition-all px-3 py-1.5 gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
    </Link>
  )
}

export default AdminTopMenu
