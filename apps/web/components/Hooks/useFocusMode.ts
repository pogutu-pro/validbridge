'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Tracks the "focus mode" toggle used on activity pages. Focus mode hides the
 * application chrome so a learner can concentrate on the activity itself. State
 * lives in localStorage and is synced across tabs/windows via events.
 */
export function useFocusMode() {
  const pathname = usePathname()
  const [isFocusMode, setIsFocusMode] = useState(false)
  const isActivityPage = !!pathname?.includes('/activity/')

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (isActivityPage) {
      setIsFocusMode(localStorage.getItem('globalFocusMode') === 'true')
    } else {
      setIsFocusMode(false)
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'globalFocusMode' && isActivityPage) {
        setIsFocusMode(e.newValue === 'true')
      }
    }
    const handleFocusModeChange = (e: CustomEvent) => {
      if (isActivityPage) {
        setIsFocusMode(e.detail.isFocusMode)
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('focusModeChange', handleFocusModeChange as EventListener)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('focusModeChange', handleFocusModeChange as EventListener)
    }
  }, [isActivityPage])

  return isFocusMode
}
