'use client'
import React, { useEffect, use } from 'react';
import { motion } from 'motion/react'
import { getUriWithOrg } from '@services/config/config'
import { KeyRound, ScanEye, ShieldCheck, SquareUserRound, UserPlus, Users, Shield } from 'lucide-react'
import { Breadcrumbs } from '@components/Objects/Breadcrumbs/Breadcrumbs'
import OrgUsers from '@components/Dashboard/Pages/Users/OrgUsers/OrgUsers'
import OrgAccess from '@components/Dashboard/Pages/Users/OrgAccess/OrgAccess'
import OrgUsersAdd from '@components/Dashboard/Pages/Users/OrgUsersAdd/OrgUsersAdd'
import OrgUserGroups from '@components/Dashboard/Pages/Users/OrgUserGroups/OrgUserGroups'
import OrgRoles from '@components/Dashboard/Pages/Users/OrgRoles/OrgRoles'
import OrgAuditLogs from '@components/Dashboard/Pages/Org/OrgAuditLogs/OrgAuditLogs'
import OrgTwoFactorPolicy from '@components/Dashboard/Pages/Users/Security/OrgTwoFactorPolicy'
import OrgSignInMethods from '@components/Dashboard/Pages/Users/Security/OrgSignInMethods'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DashTabBar, DashTabItem } from '@components/Dashboard/Shared/DashTabBar/DashTabBar'

export type SettingsParams = {
  subpage: string
  orgslug: string
}

function UsersSettingsPage(props: { params: Promise<SettingsParams> }) {
  const { t } = useTranslation()
  const params = use(props.params);
  const [H1Label, setH1Label] = React.useState('')
  const [H2Label, setH2Label] = React.useState('')

  function handleLabels() {
    if (params.subpage == 'users') {
      setH1Label(t('dashboard.users.settings.pages.users.title'))
      setH2Label(t('dashboard.users.settings.pages.users.subtitle'))
    }
    if (params.subpage == 'signups') {
      setH1Label(t('dashboard.users.settings.pages.signups.title'))
      setH2Label(t('dashboard.users.settings.pages.signups.subtitle'))
    }
    if (params.subpage == 'add') {
      setH1Label(t('dashboard.users.settings.pages.add.title'))
      setH2Label(t('dashboard.users.settings.pages.add.subtitle'))
    }
    if (params.subpage == 'usergroups') {
      setH1Label(t('dashboard.users.settings.pages.usergroups.title'))
      setH2Label(t('dashboard.users.settings.pages.usergroups.subtitle'))
    }
    if (params.subpage == 'roles') {
      setH1Label(t('dashboard.users.settings.pages.roles.title'))
      setH2Label(t('dashboard.users.settings.pages.roles.subtitle'))
    }
    if (params.subpage == 'audit-logs') {
      setH1Label(t('dashboard.users.settings.pages.audit_logs.title'))
      setH2Label(t('dashboard.users.settings.pages.audit_logs.subtitle'))
    }
    if (params.subpage == 'two-factor') {
      setH1Label(t('dashboard.users.settings.pages.two_factor.title', { defaultValue: 'Two-factor' }))
      setH2Label(t('dashboard.users.settings.pages.two_factor.subtitle', {
        defaultValue: 'Require two-factor authentication for members of this organization',
      }))
    }
    if (params.subpage == 'sign-in') {
      setH1Label(t('dashboard.users.settings.pages.sign_in.title', { defaultValue: 'Sign-in' }))
      setH2Label(t('dashboard.users.settings.pages.sign_in.subtitle', {
        defaultValue: 'Choose how members are allowed to sign in to this organization',
      }))
    }
  }

  useEffect(() => {
    handleLabels()
  }, [params.subpage, params, t])

  const tabs: DashTabItem[] = [
    {
      key: 'users',
      label: t('dashboard.users.settings.tabs.users'),
      icon: <Users size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/users`,
      active: params.subpage === 'users',
    },
    {
      key: 'usergroups',
      label: t('dashboard.users.settings.tabs.usergroups'),
      icon: <SquareUserRound size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/usergroups`,
      active: params.subpage === 'usergroups',
      requiresPlan: 'standard',
    },
    {
      key: 'roles',
      label: t('dashboard.users.settings.tabs.roles'),
      icon: <Shield size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/roles`,
      active: params.subpage === 'roles',
      requiresPlan: 'pro',
    },
    {
      key: 'signups',
      label: t('dashboard.users.settings.tabs.signups'),
      icon: <ScanEye size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/signups`,
      active: params.subpage === 'signups',
    },
    {
      key: 'add',
      label: t('dashboard.users.settings.tabs.add'),
      icon: <UserPlus size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/add`,
      active: params.subpage === 'add',
    },
    {
      key: 'sign-in',
      label: t('dashboard.users.settings.tabs.sign_in', { defaultValue: 'Sign-in' }),
      icon: <KeyRound size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/sign-in`,
      active: params.subpage === 'sign-in',
    },
    {
      key: 'two-factor',
      label: t('dashboard.users.settings.tabs.two_factor', { defaultValue: 'Two-factor' }),
      icon: <ShieldCheck size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/two-factor`,
      active: params.subpage === 'two-factor',
    },
    {
      key: 'audit-logs',
      label: t('dashboard.users.settings.tabs.audit_logs'),
      icon: <ShieldAlert size={16} />,
      href: getUriWithOrg(params.orgslug, '') + `/dash/users/settings/audit-logs`,
      active: params.subpage === 'audit-logs',
      requiresPlan: 'enterprise',
    },
  ]

  return (
    <div className="h-screen w-full bg-[#F9FAFB] grid grid-rows-[auto_1fr] grid-cols-1 overflow-hidden">
      <div className="px-6 sm:px-10 pt-5 pb-0 bg-white border-b border-gray-200/80 z-10 flex-shrink-0 relative">
        <div className="pb-3">
          <Breadcrumbs items={[
            { label: t('common.users'), href: '/dash/users/settings/users', icon: <Users size={14} /> }
          ]} />
        </div>
        <div className="mb-4">
          <div className="w-full flex flex-col space-y-1 min-w-0">
            <h1 className="font-bold text-2xl sm:text-3xl tracking-tight text-gray-900 truncate">
              {H1Label}
            </h1>
            {H2Label && (
              <p className="text-sm text-gray-500 font-normal truncate">
                {H2Label}
              </p>
            )}
          </div>
        </div>
        <DashTabBar tabs={tabs} />
      </div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1, type: 'spring', stiffness: 80 }}
        className="min-w-0 overflow-y-auto overflow-x-hidden p-6 sm:p-8"
      >
        {params.subpage == 'users' ? <OrgUsers /> : ''}
        {params.subpage == 'signups' ? <OrgAccess /> : ''}
        {params.subpage == 'add' ? <OrgUsersAdd /> : ''}
        {params.subpage == 'usergroups' ? <OrgUserGroups /> : ''}
        {params.subpage == 'roles' ? <OrgRoles /> : ''}
        {params.subpage == 'audit-logs' ? <OrgAuditLogs /> : ''}
        {params.subpage == 'sign-in' ? <OrgSignInMethods /> : ''}
        {params.subpage == 'two-factor' ? <OrgTwoFactorPolicy /> : ''}
      </motion.div>
    </div>
  )
}

export default UsersSettingsPage
