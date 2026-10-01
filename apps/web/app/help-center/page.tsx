import React from 'react'
import HelpCenter from '@components/Help/HelpCenter'
import { getSiteHelpContext } from './context'

export default async function HelpSiteHome() {
  const ctx = await getSiteHelpContext()
  return <HelpCenter ctx={ctx} />
}
