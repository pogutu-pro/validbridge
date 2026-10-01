'use client'
import React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import validbridgeIcon from 'public/validbridge_bigicon_1.png'
import OrgSquareLogo from '@components/Objects/Org/OrgSquareLogo'
import { getUriWithOrg } from '@services/config/config'

interface AuthMobileHeaderProps {
  org: any
}

/**
 * Mobile auth header: the logo sits centred above the form on the page
 * background (no banner), like a native app's sign-in screen.
 */
export default function AuthMobileHeader({ org }: AuthMobileHeaderProps) {
  const name = org?.name || 'ValidBridge'

  return (
    <div className="flex flex-col items-center px-6 pt-14 pb-2">
      <Link prefetch href={getUriWithOrg(org?.slug, '/')} aria-label={name}>
        <div className="w-14 h-14 rounded-2xl ring-1 ring-inset ring-black/5 bg-white shadow-sm flex items-center justify-center overflow-hidden">
          <OrgSquareLogo
            org={org}
            wideInsetClassName="p-2"
            fallback={
              <Image
                quality={100}
                width={56}
                height={56}
                src={validbridgeIcon}
                alt="ValidBridge"
                className="object-contain"
              />
            }
          />
        </div>
      </Link>
    </div>
  )
}
