import type { Direction } from './direction'

export interface Language {
  code: string
  translationKey: string
  nativeName: string
  /** Text direction of the language. Behaviour lives in lib/direction.ts. */
  dir: Direction
}

// English-only build. Additional locales are intentionally not offered in the
// UI; the i18n instance is pinned to English (see lib/i18n.ts).
export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'en', translationKey: 'common.english', nativeName: 'English', dir: 'ltr' },
]

export const getLanguageByCode = (code: string): Language | undefined => {
  return AVAILABLE_LANGUAGES.find(lang => lang.code === code)
}

export const getCurrentLanguageNativeName = (currentLang: string): string => {
  const language = getLanguageByCode(currentLang)
  return language?.nativeName || 'English'
}
