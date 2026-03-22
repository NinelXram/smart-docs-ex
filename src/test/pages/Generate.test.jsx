import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/templateEngine.js', () => ({
  generateDocx: vi.fn(),
  generateXlsx: vi.fn(),
  downloadBlob: vi.fn(),
}))

import Generate from '../../pages/Generate.jsx'
import * as engine from '../../lib/templateEngine.js'

// binary is a base64-encoded ArrayBuffer
function makeBase64() {
  return btoa(String.fromCharCode(0, 1, 2, 3))
}

const TEMPLATE_DOCX = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  binary: makeBase64(),
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1774148866000,
}

const TEMPLATE_XLSX = {
  id: 'id-2',
  name: 'Budget',
  sourceFormat: 'xlsx',
  binary: makeBase64(),
  fields: ['Quarter', 'Amount'],
  createdAt: 1774148866000,
}

beforeEach(() => vi.clearAllMocks())

describe('Generate', () => {
  it('renders one input per field name', () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByLabelText('ClientName')).toBeInTheDocument()
    expect(screen.getByLabelText('EffectiveDate')).toBeInTheDocument()
  })

  it('does not render a format selector', () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('calls generateDocx with decoded binary and values for DOCX template', async () => {
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateDocx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { ClientName: 'Acme Corp', EffectiveDate: '' }
      )
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Sales Contract.docx')
    })
  })

  it('calls generateXlsx for XLSX template', async () => {
    engine.generateXlsx.mockResolvedValue(new Blob(['xlsx']))
    render(<Generate template={TEMPLATE_XLSX} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateXlsx).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        { Quarter: '', Amount: '' }
      )
      expect(engine.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'Budget.xlsx')
    })
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={onBack} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('calls onToast with error when generation fails', async () => {
    engine.generateDocx.mockRejectedValue(new Error('Output generation failed'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })
})
