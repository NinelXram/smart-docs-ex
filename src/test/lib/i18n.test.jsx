import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { makeT, LanguageProvider, useLanguage } from '../../lib/i18n.jsx'

describe('makeT', () => {
  it('returns the value for the active locale', () => {
    const t = makeT('en')
    expect(t('app.title')).toBe('Chicken Fill Form')
  })

  it('returns the Vietnamese value when lang is vi', () => {
    const t = makeT('vi')
    expect(t('app.title')).toBe('Trợ lý Mẫu Tài liệu')
  })

  it('falls back to en when key is missing in vi', () => {
    const t = makeT('vi')
    expect(typeof t('app.loading')).toBe('string')
    expect(t('app.loading')).not.toBe('app.loading')
  })

  it('falls back to the key string when missing in both locales', () => {
    const t = makeT('vi')
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('resolves nested dot notation', () => {
    const t = makeT('en')
    expect(t('review.accept')).toBe('Accept')
  })
})

describe('LanguageProvider + useLanguage', () => {
  function Consumer() {
    const { lang, t } = useLanguage()
    return <div data-testid="out">{lang}:{t('app.library')}</div>
  }

  it('exposes lang and t to consumers', () => {
    render(
      <LanguageProvider lang="en" setLang={() => { }}>
        <Consumer />
      </LanguageProvider>
    )
    expect(screen.getByTestId('out').textContent).toBe('en:Library')
  })

  it('renders Vietnamese strings when lang is vi', () => {
    render(
      <LanguageProvider lang="vi" setLang={() => { }}>
        <Consumer />
      </LanguageProvider>
    )
    expect(screen.getByTestId('out').textContent).toBe('vi:Thư viện')
  })
})
