import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/renderers/docx.js', () => ({
  renderDocx: vi.fn().mockResolvedValue({ html: '<p>Updated</p>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../lib/renderers/xlsx.js', () => ({
  renderXlsx: vi.fn().mockReturnValue({ html: '<table></table>', binary: new ArrayBuffer(4) }),
}))
vi.mock('../../lib/fieldEditor.js', () => ({
  insertDocx: vi.fn(),
  insertXlsx: vi.fn(),
}))
vi.mock('../../lib/gemini.js', () => ({
  suggestFieldName: vi.fn().mockResolvedValue('ClientName'),
}))
vi.mock('../../lib/storage.js', () => ({
  saveTemplate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }))

import Review from '../../pages/Review.jsx'
import * as fieldEditor from '../../lib/fieldEditor.js'
import * as gemini from '../../lib/gemini.js'
import * as storage from '../../lib/storage.js'

const DOCX_PROPS = {
  html: '<p>Agreement with Acme Corp hereinafter.</p>',
  binary: new ArrayBuffer(8),
  format: 'docx',
  fileName: 'contract.docx',
  fields: [],
  apiKey: 'test-key',
  onSave: vi.fn(),
  onBack: vi.fn(),
}

const XLSX_PROPS = {
  html: '<table><tr><td data-cell-address="Sheet1!B3">$75,000</td></tr></table>',
  binary: new ArrayBuffer(8),
  format: 'xlsx',
  fileName: 'budget.xlsx',
  fields: [],
  apiKey: 'test-key',
  onSave: vi.fn(),
  onBack: vi.fn(),
}

// Helper to simulate a DOCX text selection
function mockSelection(anchorNode, focusNode, text) {
  const mockSel = {
    isCollapsed: false,
    toString: () => text,
    anchorNode,
    focusNode,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ bottom: 100, left: 50, top: 90 }),
    }),
    removeAllRanges: vi.fn(),
  }
  Object.defineProperty(window, 'getSelection', { value: () => mockSel, configurable: true })
}

beforeEach(() => vi.clearAllMocks())

describe('Review — DOCX', () => {
  it('renders the document html in the viewer div', () => {
    render(<Review {...DOCX_PROPS} />)
    // The viewer sets innerHTML — check text is visible
    expect(screen.getByText(/Agreement with Acme Corp/i)).toBeInTheDocument()
  })

  it('shows popover when valid text is selected (≥ 3 non-whitespace chars)', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => {
      fireEvent.mouseUp(viewer)
    })

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('does not show popover when selection has fewer than 3 non-whitespace chars', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'AB')
    await act(async () => { fireEvent.mouseUp(viewer) })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows cross-paragraph error when anchor and focus are in different paragraphs', async () => {
    const html = '<p id="p1">Paragraph one.</p><p id="p2">Paragraph two.</p>'
    render(<Review {...DOCX_PROPS} html={html} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const p1 = viewer.querySelector('#p1')
    const p2 = viewer.querySelector('#p2')

    mockSelection(p1.firstChild, p2.firstChild, 'Paragraph one')
    await act(async () => { fireEvent.mouseUp(viewer) })

    await waitFor(() =>
      expect(screen.getByText(/single paragraph/i)).toBeInTheDocument()
    )
  })

  it('populates the field name input with AI suggestion', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /field name/i })).toHaveValue('ClientName')
    )
  })

  it('calls insertDocx and re-renders on Accept', async () => {
    const newBinary = new ArrayBuffer(16)
    fieldEditor.insertDocx.mockReturnValue({ binary: newBinary })
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() => expect(fieldEditor.insertDocx).toHaveBeenCalled())
    // Popover should close after accept
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows duplicate field name error when field already exists', async () => {
    render(<Review {...DOCX_PROPS} fields={['ClientName']} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    // Suggestion is 'ClientName' which already exists
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))

    await waitFor(() =>
      expect(screen.getByText(/already used/i)).toBeInTheDocument()
    )
  })

  it('dismisses popover on Dismiss click', async () => {
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks Save Template when zero fields defined', async () => {
    render(<Review {...DOCX_PROPS} fields={[]} />)
    fireEvent.change(screen.getByPlaceholderText(/template name/i), {
      target: { value: 'My Template' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))
    await waitFor(() =>
      expect(screen.getByText(/at least one field/i)).toBeInTheDocument()
    )
    expect(storage.saveTemplate).not.toHaveBeenCalled()
  })

  it('saves template with base64-encoded binary and fields array', async () => {
    const newBinary = new ArrayBuffer(4)
    fieldEditor.insertDocx.mockReturnValue({ binary: newBinary })
    render(<Review {...DOCX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const para = viewer.querySelector('p')

    // First add a field
    mockSelection(para.firstChild, para.firstChild, 'Acme Corp')
    await act(async () => { fireEvent.mouseUp(viewer) })
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(fieldEditor.insertDocx).toHaveBeenCalled())

    // Now save
    fireEvent.change(screen.getByPlaceholderText(/template name/i), {
      target: { value: 'Sales Contract' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))

    await waitFor(() =>
      expect(storage.saveTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-uuid',
          name: 'Sales Contract',
          sourceFormat: 'docx',
          binary: expect.any(String), // base64 string
          fields: ['ClientName'],
        })
      )
    )
    expect(DOCX_PROPS.onSave).toHaveBeenCalled()
  })
})

describe('Review — XLSX', () => {
  it('shows popover when a table cell is clicked', async () => {
    render(<Review {...XLSX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')
    expect(cell).toBeInTheDocument()

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })

  it('shows "already a field" error when cell contains {{...}}', async () => {
    const html = '<table><tr><td data-cell-address="Sheet1!A1">{{Existing}}</td></tr></table>'
    render(<Review {...XLSX_PROPS} html={html} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() =>
      expect(screen.getByText(/already a field/i)).toBeInTheDocument()
    )
  })

  it('calls insertXlsx on Accept', async () => {
    const newBinary = new ArrayBuffer(16)
    fieldEditor.insertXlsx.mockReturnValue({ binary: newBinary })
    render(<Review {...XLSX_PROPS} />)
    const viewer = document.querySelector('[data-testid="doc-viewer"]')
    const cell = viewer.querySelector('td[data-cell-address]')

    await act(async () => { fireEvent.click(cell) })
    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByRole('button', { name: /accept/i }))
    await waitFor(() => expect(fieldEditor.insertXlsx).toHaveBeenCalled())
  })
})
