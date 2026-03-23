// src/test/Review.xlsx.test.jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('../lib/gemini.js', () => ({
  suggestFieldName: vi.fn(),
  suggestFieldPattern: vi.fn(),
}))
vi.mock('../lib/storage.js', () => ({ saveTemplate: vi.fn() }))

import Review from '../pages/Review.jsx'
import { suggestFieldPattern } from '../lib/gemini.js'

function makeBinary(data) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

function baseProps(overrides = {}) {
  return {
    html: '<table><tr><td data-cell-address="Sheet1!A1">Name: Bao Huynh</td></tr></table>',
    binary: makeBinary([['Name: Bao Huynh']]),
    format: 'xlsx',
    fileName: 'test.xlsx',
    fields: [],
    apiKey: 'test-key',
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Multi-sheet helpers
const MULTI_SHEET_HTML =
  '<h3>Sheet1</h3><table><tr><td data-cell-address="Sheet1!A1">Revenue</td></tr></table>' +
  '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">Expenses</td></tr></table>'

function makeBinaryMulti() {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Revenue']]), 'Sheet1')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Expenses']]), 'Sheet2')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

function multiSheetProps(overrides = {}) {
  return {
    html: MULTI_SHEET_HTML,
    binary: makeBinaryMulti(),
    format: 'xlsx',
    fileName: 'multi.xlsx',
    fields: [],
    apiKey: 'test-key',
    onSave: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
}

describe('Review XLSX — sheet tabs', () => {
  it('renders a tab for each sheet when workbook has multiple sheets', () => {
    render(<Review {...multiSheetProps()} />)
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeInTheDocument()
  })

  it('shows first sheet content on initial render', () => {
    render(<Review {...multiSheetProps()} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    expect(viewer.innerHTML).toContain('Revenue')
    expect(viewer.innerHTML).not.toContain('Expenses')
  })

  it('switches to second sheet content when its tab is clicked', async () => {
    render(<Review {...multiSheetProps()} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
      expect(viewer.innerHTML).not.toContain('Revenue')
    })
  })

  it('does not render a tab bar for a single-sheet workbook', () => {
    render(<Review {...baseProps()} />)
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  })

  it('displays sheet name with special characters correctly in tab', () => {
    const html =
      '<h3>Q&amp;A</h3><table><tr><td data-cell-address="Q&amp;A!A1">val</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">other</td></tr></table>'
    render(<Review {...multiSheetProps({ html })} />)
    expect(screen.getByRole('tab', { name: 'Q&A' })).toBeInTheDocument()
  })

  it('applies chip overlay to active sheet content after tab switch', async () => {
    const html =
      '<h3>Sheet1</h3><table><tr><td data-cell-address="Sheet1!A1">{{name}}</td></tr></table>' +
      '<h3>Sheet2</h3><table><tr><td data-cell-address="Sheet2!A1">Expenses</td></tr></table>'
    render(<Review {...multiSheetProps({ html, fields: ['name'] })} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Sheet1' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.querySelector('span')).not.toBeNull()
      expect(viewer.textContent).toContain('{{name}}')
    })
  })

  // Note: scroll-reset-to-0 on tab switch is implemented via tabSwitchRef.
  // jsdom does not track scrollTop, so this is a runtime behavior — not tested here.

  it('preserves active tab after field insertion', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: '', value: 'Expenses', fieldName: 'expenses' })
    render(<Review {...multiSheetProps()} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Sheet2' }))
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).toContain('Expenses')
    })

    fireEvent.click(screen.getByText('Expenses'))
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    expect(viewer.innerHTML).toContain('Expenses')
    expect(viewer.innerHTML).not.toContain('Revenue')
  })

  it('viewer is not blank on initial render', async () => {
    render(<Review {...multiSheetProps()} />)
    await waitFor(() => {
      const viewer = document.querySelector('[data-testid="doc-viewer"]')
      expect(viewer.innerHTML).not.toBe('')
    })
  })
})

describe('Review XLSX — cell click flow', () => {
  it('opens popover with Gemini-suggested label and fieldName on cell click', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    render(<Review {...baseProps()} />)

    const cell = screen.getByText('Name: Bao Huynh')
    fireEvent.click(cell)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    // Wait for popover to transition from loading to ready (inputs appear)
    await waitFor(() => expect(screen.getAllByRole('textbox').length).toBeGreaterThan(1))
    const inputs = screen.getAllByRole('textbox')
    const labelInput = inputs.find(i => i.placeholder === 'e.g. Name: ')
    const fieldInput = inputs.find(i => i.id === 'field-name-input')
    expect(labelInput).toBeDefined()
    expect(labelInput.value).toBe('Name: ')
    expect(fieldInput).toBeDefined()
    expect(fieldInput.value).toBe('name')
  })

  it('opens popover with empty inputs when Gemini call fails', async () => {
    suggestFieldPattern.mockRejectedValueOnce(new Error('timeout'))
    render(<Review {...baseProps()} />)

    fireEvent.click(screen.getByText('Name: Bao Huynh'))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.some(i => i.value === '')).toBe(true)
  })

  it('adds fieldName to fields list after accepting', async () => {
    suggestFieldPattern.mockResolvedValueOnce({ label: 'Name: ', value: 'Bao Huynh', fieldName: 'name' })
    render(<Review {...baseProps()} />)

    fireEvent.click(screen.getByText('Name: Bao Huynh'))
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/1 field/)).toBeInTheDocument()
  })
})
