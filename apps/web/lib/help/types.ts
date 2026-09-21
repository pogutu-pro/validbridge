import type { ReactNode } from 'react'

/**
 * A help subsection's content is a function of the org slug so internal
 * navigation can be built with `getUriWithOrg(orgslug, '/path')`.
 */
export type HelpContentFn = (_orgslug: string) => ReactNode

export type HelpSubsection = {
  id: string
  title: string
  content: HelpContentFn
}

/** Icon key mapped to a Phosphor icon by the Help Center renderer. */
export type HelpIcon =
  | 'rocket'
  | 'graduation'
  | 'chalkboard'
  | 'buildings'
  | 'lifebuoy'

export type HelpSection = {
  id: string
  title: string
  icon: HelpIcon
  tagline: string
  subsections: HelpSubsection[]
}