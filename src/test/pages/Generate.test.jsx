import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/templateEngine.js', () => ({
  injectVariables: vi.fn(),
  generatePdf: vi.fn(),
  generateDocx: vi.fn(),
  generateXlsx: vi.fn(),
  downloadBlob: vi.fn(),
}))

import Generate from '../../pages/Generate.jsx'
import * as engine from '../../lib/templateEngine.js'

const TEMPLATE = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  rawContent: 'Agreement with [VALUE] hereinafter',
  variables: [
    { name: 'ClientName', marker: 'Agreement with [VALUE] hereinafter' },
  ],
  createdAt: 1000000000000,
}

beforeEach(() => vi.clearAllMocks())

describe('Generate', () => {
  it('renders one input per variable', () => {
    render(<Generate template={TEMPLATE} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByLabelText('ClientName')).toBeInTheDocument()
  })

  it('renders format selector with source format preselected', () => {
    render(<Generate template={TEMPLATE} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByDisplayValue('DOCX')).toBeInTheDocument()
  })

  it('generates and downloads DOCX file', async () => {
    engine.injectVariables.mockReturnValue({ content: 'filled content', warnings: [] })
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    render(<Generate template={TEMPLATE} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.injectVariables).toHaveBeenCalledWith(
        TEMPLATE.rawContent,
        TEMPLATE.variables,
        { ClientName: 'Acme Corp' }
      )
      expect(engine.generateDocx).toHaveBeenCalledWith('filled content')
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Sales Contract.docx')
    })
  })

  it('generates PDF when PDF format selected', async () => {
    engine.injectVariables.mockReturnValue({ content: 'filled', warnings: [] })
    engine.generatePdf.mockResolvedValue(new Blob(['pdf']))
    render(<Generate template={TEMPLATE} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pdf' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generatePdf).toHaveBeenCalled()
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Sales Contract.pdf')
    })
  })

  it('displays warnings from injectVariables', async () => {
    engine.injectVariables.mockReturnValue({
      content: 'filled',
      warnings: ['Variable "ClientName" marker not found in document — skipped'],
    })
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    render(<Generate template={TEMPLATE} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(screen.getByText(/marker not found/i)).toBeInTheDocument()
    )
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<Generate template={TEMPLATE} onBack={onBack} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })
})
