'use client'
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Buildings,
  Users,
  ChartBar,
  Key,
  SignOut,
  User,
  SidebarSimple,
  CaretRight,
  ShieldCheck,
  House,
  Gear,
  Sparkle,
  SealCheck,
} from '@phosphor-icons/react'
import { signOut } from '@components/Contexts/AuthContext'
import { useVBSession } from '@components/Contexts/VBSessionContext'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip'
import { cn } from '@/lib/utils'

interface NavGroup {
  label: string
  items: {
    href: string
    icon: React.ReactNode
    label: string
    badge?: string
  }[]
}

export default function AdminSidebar() {
  const session = useVBSession() as any
  const pathname = usePathname() || ''
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('admin-menu-collapsed')
      if (saved !== null) {
        setIsCollapsed(saved === 'true')
      }
    }
  }, [])

  const toggleCollapse = () => {
    const next = !isCollapsed
    setIsCollapsed(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem('admin-menu-collapsed', String(next))
    }
  }

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

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin' || pathname === '/admin/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const navGroups: NavGroup[] = [
    {
      label: 'OVERVIEW',
      items: [
        {
          href: '/admin/analytics',
          icon: <ChartBar size={18} weight={isActive('/admin/analytics') ? 'fill' : 'bold'} />,
          label: 'Analytics',
        },
      ],
    },
    {
      label: 'PLATFORM MANAGEMENT',
      items: [
        {
          href: '/admin/organizations',
          icon: <Buildings size={18} weight={isActive('/admin/organizations') ? 'fill' : 'bold'} />,
          label: 'Organizations',
        },
        {
          href: '/admin/users',
          icon: <Users size={18} weight={isActive('/admin/users') ? 'fill' : 'bold'} />,
          label: 'User Directory',
        },
        {
          href: '/admin/public-education',
          icon: <SealCheck size={18} weight={isActive('/admin/public-education') ? 'fill' : 'bold'} />,
          label: 'Public Education',
        },
      ],
    },
    {
      label: 'DEVELOPER & API',
      items: [
        {
          href: '/admin/developers',
          icon: <Key size={18} weight={isActive('/admin/developers') ? 'fill' : 'bold'} />,
          label: 'Developer Keys',
        },
      ],
    },
    {
      label: 'MY ACCOUNT',
      items: [
        {
          // The account page (outside /admin) holds change password and 2FA.
          href: '/account',
          icon: <ShieldCheck size={18} weight="bold" />,
          label: 'Password & 2FA',
        },
      ],
    },
  ]

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        aria-label="Superadmin Sidebar Navigation"
        className={cn(
          "sticky top-0 h-screen flex flex-col bg-background text-foreground border-e border-border transition-all duration-300 z-overlay select-none shrink-0 shadow-sm",
          isCollapsed ? "w-[72px]" : "w-64"
        )}
      >
        {/* Top Header & Brand */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-border shrink-0 bg-background">
          <Link href="/admin" className="flex items-center gap-3 overflow-hidden group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-primary to-amber-500 flex items-center justify-center shadow-md shadow-primary/20 shrink-0">
              <ShieldCheck size={20} weight="fill" className="text-white" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-sm tracking-tight text-foreground truncate">
                    ValidBridge
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 px-1.5 py-0.5 rounded-full shrink-0">
                    SUPERADMIN
                  </span>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground truncate">Platform Console</span>
              </div>
            )}
          </Link>

          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <SidebarSimple size={18} weight="bold" />
          </button>
        </div>

        {/* Navigation Group Items */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin scrollbar-thumb-slate-200">
          {navGroups.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-1">
              {!isCollapsed && (
                <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-foreground">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => {
                const active = isActive(item.href)
                const content = (
                  <Link
                    href={item.href}
                    className={cn(
                      "relative flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-sm transition-all duration-150 group",
                      active
                        ? "bg-primary/10 text-foreground font-semibold"
                        : "text-foreground hover:bg-muted font-medium"
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute start-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
                      />
                    )}
                    <span className={cn("shrink-0 transition-transform group-hover:scale-105", active ? "text-primary" : "text-foreground")}>
                      {item.icon}
                    </span>
                    {!isCollapsed && (
                      <span className="truncate flex-1">{item.label}</span>
                    )}
                  </Link>
                )

                if (isCollapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{content}</TooltipTrigger>
                      <TooltipContent side="right" className="bg-slate-900 text-white border-slate-800 text-xs px-2.5 py-1 shadow-md">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  )
                }

                return <React.Fragment key={item.href}>{content}</React.Fragment>
              })}
            </div>
          ))}
        </div>

        {/* Footer User & Sign Out Profile Box */}
        <div className="p-3 border-t border-border shrink-0 bg-background">
          <div
            className={cn(
              "flex items-center gap-3 p-2 rounded-2xl bg-muted/50 border border-border transition-colors",
              isCollapsed && "justify-center px-1"
            )}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Avatar"
                className="w-8 h-8 rounded-full object-cover border border-slate-200 shrink-0"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center text-primary shrink-0">
                <User size={16} weight="fill" />
              </div>
            )}

            {!isCollapsed && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-foreground truncate">
                  {user?.username || 'Superadmin'}
                </span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {user?.email || 'admin@validbridge.dev'}
                </span>
              </div>
            )}

            <button
              onClick={logOutUI}
              className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0"
              title="Sign Out"
            >
              <SignOut size={16} weight="bold" />
            </button>
          </div>
        </div>
      </aside>
    </TooltipProvider>
  )
}
