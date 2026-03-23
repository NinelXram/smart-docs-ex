import { render, screen } from '@testing-library/react'
import ProgressBar from '../../components/ProgressBar.jsx'
import { LanguageProvider } from '../../lib/i18n.jsx'

describe('ProgressBar', () => {
  it('renders all 4 step labels', () => {
    render(<ProgressBar step={1} />)
    expect(screen.getByText('Upload')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('Generate')).toBeInTheDocument()
  })

  it('marks current step with data-active', () => {
    render(<ProgressBar step={2} />)
    expect(screen.getByTestId('step-2')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('step-1')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('step-3')).toHaveAttribute('data-active', 'false')
  })

  it('marks completed steps with data-done', () => {
    render(<ProgressBar step={3} />)
    expect(screen.getByTestId('step-1')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('step-2')).toHaveAttribute('data-done', 'true')
    expect(screen.getByTestId('step-3')).toHaveAttribute('data-done', 'false')
    expect(screen.getByTestId('step-4')).toHaveAttribute('data-done', 'false')
  })

  it('renders Vietnamese step labels when lang is vi', () => {
    render(<LanguageProvider lang="vi" setLang={() => {}}><ProgressBar step={1} /></LanguageProvider>)
    expect(screen.getByTestId('step-1').textContent).toContain('Tải lên')
  })
})
