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
