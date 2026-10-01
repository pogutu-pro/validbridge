'use client';
import DashLeftMenu from '@components/Dashboard/Menus/DashLeftMenu';
import DashMobileMenu from '@components/Dashboard/Menus/DashMobileMenu';
import DashTopbar from '@components/Dashboard/Menus/DashTopbar';
import { SECTION_TABS_SLOT_ID } from '@components/Dashboard/Menus/SecondarySidebar';
import OnboardingTracker from '@components/Dashboard/Onboarding/OnboardingTracker';
import WelcomeModal from '@components/Dashboard/Onboarding/WelcomeModal';
import DemoBanner from '@components/Objects/Demo/DemoBanner';
import AiCreditsNotice from '@components/AI/AiCreditsNotice';
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { SessionGate } from '@components/Contexts/VBSessionContext'
import { CommandPaletteProvider } from '@components/Dashboard/CommandPalette/CommandPaletteContext'
import CommandPalette from '@components/Dashboard/CommandPalette/CommandPalette'
import { UpgradeModalProvider } from '@components/Dashboard/Shared/PlanRestricted/UpgradeModalContext'
import AICopilotProvider, { useAICopilot } from '@components/Contexts/AI/AICopilotContext'
import GenieCopilotHost from '@components/Copilot/GenieCopilotHost'
import { useOrg } from '@components/Contexts/OrgContext'
import React from 'react'
import { useMediaQuery } from 'usehooks-ts';
import { cn } from '@/lib/utils'

// Reserves the drawer's width on large screens so it pushes dashboard
// content aside instead of overlapping it. Below `lg`, DashLeftMenu is
// already replaced by DashMobileMenu and the drawer falls back to its
// dimmed full-width overlay, so no push is applied there.
function DashContentColumn({ children }: { children: React.ReactNode }) {
    const { isOpen } = useAICopilot()

    return (
        <div
            className={cn(
                'flex flex-col w-full min-w-0 relative isolate pb-24 lg:pb-0 transition-[margin] duration-200 ease-out',
                isOpen && 'lg:me-[400px]'
            )}
        >
            {children}
        </div>
    )
}

function ClientAdminLayout({
    children,
}: {
    children: React.ReactNode
    // Accepted (the server layout passes it) but unused here.
    params?: any
}) {
    const isMobile = useMediaQuery('(max-width: 1024px)')
    const org = useOrg() as any
    const orgslug: string | undefined = org?.slug

    return (
        <SessionGate>
            <AdminAuthorization authorizationMode="page">
                <CommandPaletteProvider>
                    <UpgradeModalProvider>
                        {/* The dashboard drawer is Genie only (free help and
                            navigation). The course tutor lives on the student side. */}
                        <AICopilotProvider assistantAvailable defaultMode="assistant">
                        {isMobile && <DashMobileMenu />}
                        {/* Built-in page translation (Chrome/Edge/Firefox) swaps text
                            nodes out from under React. On the editor — where nodes are
                            constantly inserted and moved — that desyncs the two trees
                            and the next render dies on "insertBefore ... not a child of
                            this node", taking the whole page with it. The dashboard is
                            already translated by i18n, so opting it out costs nothing.
                            Public course pages stay translatable. */}
                        <div translate="no" className="notranslate flex flex-col lg:flex-row">
                            {!isMobile && <DashLeftMenu />}
                            <DashContentColumn>
                                <DashTopbar />
                                {/* Section sub-navigation renders here as top tabs. */}
                                <div id={SECTION_TABS_SLOT_ID} className="sticky top-0 z-20" />
                                {/* Renders nothing outside the demo organization. */}
                                <DemoBanner />
                                {/* Renders nothing while the school has AI credits. */}
                                <AiCreditsNotice variant="dashboard" />
                                {children}
                                <OnboardingTracker />
                            </DashContentColumn>
                            <WelcomeModal />
                            <CommandPalette />
                        </div>
                        <GenieCopilotHost orgslug={orgslug} />
                        </AICopilotProvider>
                    </UpgradeModalProvider>
                </CommandPaletteProvider>
            </AdminAuthorization>
        </SessionGate>
    )
}

export default ClientAdminLayout
