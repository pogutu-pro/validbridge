'use client'
import React from 'react'

/**
 * Fades and rises its children once as they scroll into view.
 *
 * The content is visible in the server-rendered HTML and stays visible unless
 * scripts are running. It is only hidden, after the page has hydrated, for
 * blocks that are still below the fold, and revealed as they scroll in. The
 * earlier version rendered every block with `opacity: 0` and relied on
 * JavaScript to reveal it, so on a slow connection, an in-app browser, or any
 * device where scripts failed, everything under the hero video stayed blank.
 *
 * Nothing is hidden for visitors who prefer reduced motion or whose browser
 * has no IntersectionObserver.
 */
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = React.useState(false)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    // Already on screen: leave it visible, no animation, no flash.
    if (el.getBoundingClientRect().top < window.innerHeight) return

    setHidden(true)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setHidden(false)
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -80px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? 'translateY(20px)' : 'none',
        transition: `opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}s`,
      }}
    >
      {children}
    </div>
  )
}
