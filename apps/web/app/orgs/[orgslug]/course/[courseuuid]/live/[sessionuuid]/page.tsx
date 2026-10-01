import type { Metadata } from 'next'
import LiveBridge from '@components/Objects/Live/LiveBridge'

export const metadata: Metadata = {
  title: 'LiveBridge',
  robots: { index: false, follow: false },
}

// URLs carry uuids without their type prefix, like /course/{uuid}/activity/{uuid}.
const withPrefix = (value: string, prefix: string) => (value.startsWith(prefix) ? value : `${prefix}${value}`)

export default async function LiveClassroomPage(props: {
  params: Promise<{ orgslug: string; courseuuid: string; sessionuuid: string }>
}) {
  const { orgslug, courseuuid, sessionuuid } = await props.params
  return (
    <LiveBridge
      orgslug={orgslug}
      courseUuid={courseuuid.replace(/^course_/, '')}
      sessionUuid={withPrefix(decodeURIComponent(sessionuuid), 'livesession_')}
    />
  )
}
