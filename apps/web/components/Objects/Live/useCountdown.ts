'use client'

import { useEffect, useState } from 'react'
import { secondsLeft } from './liveMath'

/** Seconds left until a server deadline, ticking every 250ms; null without one. */
export function useCountdown(deadlineIso: string | null | undefined, offsetMs = 0): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadlineIso) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [deadlineIso])
  return secondsLeft(deadlineIso, offsetMs, now)
}
