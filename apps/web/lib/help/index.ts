import type { HelpSection } from './types'
import { gettingStarted } from './getting-started'
import { learning } from './learning'
import { teaching } from './teaching'
import { administering } from './administering'
import { troubleshooting } from './troubleshooting'

/** The full Help Center, in reading order. */
export const HELP_SECTIONS: HelpSection[] = [
  gettingStarted,
  learning,
  teaching,
  administering,
  troubleshooting,
]

export type { HelpSection, HelpSubsection, HelpIcon } from './types'