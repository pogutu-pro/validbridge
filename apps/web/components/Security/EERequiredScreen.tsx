import React from 'react'

/**
 * Full-page message for a surface that only exists in Enterprise Edition.
 *
 * Kept separate from EELicenseError, which is an inline banner for a failing
 * licence check and names environment variables and pod logs — operator
 * debugging detail that does not belong on a page any anonymous visitor to an
 * OSS deployment can load.
 */
export default function EERequiredScreen() {
  return (
    <div className="flex justify-center items-center min-h-screen bg-[#F8F7F2] px-6">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-[#262626] mb-2">
          Enterprise Edition license required
        </h1>
        <p className="text-[#737373]/80 text-sm leading-relaxed">
          The superadmin dashboard is part of ValidBridge Enterprise Edition and
          is not available on this deployment.
        </p>
      </div>
    </div>
  )
}
