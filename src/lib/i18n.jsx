import { createContext, useContext } from 'react'
import vi from '../locales/vi.json'
import en from '../locales/en.json'

const locales = { vi, en }

/** Standalone lookup — usable outside a React tree (e.g. App.jsx). */
export function makeT(lang) {
  return function t(key) {
    const parts = key.split('.')
    return (
      parts.reduce((obj, k) => obj?.[k], locales[lang]) ??
      parts.reduce((obj, k) => obj?.[k], locales['en']) ??
      key
    )
  }
}

// Default value provides English fallback for components rendered in tests
// without a LanguageProvider wrapper.
export const LanguageContext = createContext({
  lang: 'en',
  setLang: () => {},
  t: makeT('en'),
})

export function LanguageProvider({ lang, setLang, children }) {
  const t = makeT(lang)
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
