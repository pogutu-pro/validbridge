'use client'

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import { loadDateLocale } from './format';

// English-only build. Other locales are intentionally not registered, and the
// instance is pinned to English so no detection or switching can change it.
const resources = {
  en: { common: en },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    supportedLngs: ['en'],
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // react already safes from xss
    },
    react: {
      useSuspense: false,
    }
  });

export const initialLocaleReady = Promise.resolve();

/**
 * Language switching is disabled in this build — the app is English-only.
 * Kept as an API so existing callers remain valid.
 */
export async function changeLanguage(_lng?: string) {
  await loadDateLocale('en')
  return i18n.changeLanguage('en')
}

export default i18n;
