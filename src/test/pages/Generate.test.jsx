import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/templateEngine.js', () => ({
  generateDocx: vi.fn(),
  generateXlsx: vi.fn(),
  saveFile: vi.fn(),
}))

vi.mock('../../lib/storage.js', () => ({
  getTemplateBinary: vi.fn(),
  getApiKey: vi.fn(),
}))

vi.mock('../../lib/gemini.js', () => ({
  analyzeSource: vi.fn(),
}))

import Generate from '../../pages/Generate.jsx'
import * as engine from '../../lib/templateEngine.js'
import * as storage from '../../lib/storage.js'
import * as gemini from '../../lib/gemini.js'

const FAKE_BUFFER = new ArrayBuffer(4)

const TEMPLATE_DOCX = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'EffectiveDate'],
  createdAt: 1774148866000,
}

const TEMPLATE_XLSX = {
  id: 'id-2',
  name: 'Budget',
  sourceFormat: 'xlsx',
  fields: ['Quarter', 'Amount'],
  createdAt: 1774148866000,
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.getTemplateBinary.mockResolvedValue(FAKE_BUFFER)
  storage.getApiKey.mockResolvedValue('fake-api-key')
})

describe('Generate', () => {
  it('renders one input per field name', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('ClientName')).toBeInTheDocument())
    expect(screen.getByLabelText('EffectiveDate')).toBeInTheDocument()
  })

  it('does not render a format selector', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('shows loading state initially before binary loads', () => {
    // Make getTemplateBinary never resolve during this test
    storage.getTemplateBinary.mockReturnValue(new Promise(() => {}))
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    const btn = screen.getByRole('button', { name: /download/i })
    expect(btn).toBeDisabled()
  })

  it('enables Generate button after binary loads successfully', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /download/i })
      expect(btn).not.toBeDisabled()
    })
  })

  it('shows toast and disables Generate button when getTemplateBinary rejects', async () => {
    storage.getTemplateBinary.mockRejectedValue(new Error('not found'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith({
        message: 'Template file not found — please re-upload',
        type: 'error',
      })
    )
    const btn = screen.getByRole('button', { name: /download/i })
    expect(btn).toBeDisabled()
  })

  it('calls generateDocx with binary from OPFS and values for DOCX template', async () => {
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    engine.saveFile.mockResolvedValue(undefined)
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme Corp' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateDocx).toHaveBeenCalledWith(
        FAKE_BUFFER,
        { ClientName: 'Acme Corp', EffectiveDate: '' }
      )
      expect(engine.saveFile).toHaveBeenCalledWith(
        expect.any(Blob),
        'Sales Contract.docx',
        'docx'
      )
    })
  })

  it('calls generateXlsx and saveFile for XLSX template', async () => {
    engine.generateXlsx.mockResolvedValue(new Blob(['xlsx']))
    engine.saveFile.mockResolvedValue(undefined)
    render(<Generate template={TEMPLATE_XLSX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() => {
      expect(engine.generateXlsx).toHaveBeenCalledWith(
        FAKE_BUFFER,
        { Quarter: '', Amount: '' }
      )
      expect(engine.saveFile).toHaveBeenCalledWith(
        expect.any(Blob),
        'Budget.xlsx',
        'xlsx'
      )
    })
  })

  it('calls onBack when back button clicked', async () => {
    const onBack = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={onBack} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('calls onToast with error when generation fails', async () => {
    engine.generateDocx.mockRejectedValue(new Error('Output generation failed'))
    const onToast = vi.fn()
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  describe('Analyze button', () => {
    it('fills matched fields when analyzeSource resolves', async () => {
      gemini.analyzeSource.mockResolvedValue({ ClientName: 'Jane' })
      render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
      await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

      const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
      const analyzeInput = screen.getByTestId('analyze-file-input')
      fireEvent.change(analyzeInput, { target: { files: [file] } })

      await waitFor(() => {
        expect(screen.getByLabelText('ClientName')).toHaveValue('Jane')
      })
    })

    it('shows analyzeError toast when analyzeSource throws', async () => {
      gemini.analyzeSource.mockRejectedValue(new Error('API down'))
      const onToast = vi.fn()
      render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
      await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

      const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
      const analyzeInput = screen.getByTestId('analyze-file-input')
      fireEvent.change(analyzeInput, { target: { files: [file] } })

      await waitFor(() =>
        expect(onToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', message: expect.stringContaining('API down') })
        )
      )
    })

    it('shows analyzeError toast and does not call analyzeSource when API key is null', async () => {
      storage.getApiKey.mockResolvedValue(null)
      const onToast = vi.fn()
      render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
      await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

      const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
      const analyzeInput = screen.getByTestId('analyze-file-input')
      fireEvent.change(analyzeInput, { target: { files: [file] } })

      await waitFor(() =>
        expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      )
      expect(gemini.analyzeSource).not.toHaveBeenCalled()
    })

    it('shows analyzeError toast when analyzeSource throws for oversized file', async () => {
      gemini.analyzeSource.mockRejectedValue(new Error('File too large (max 4 MB)'))
      const onToast = vi.fn()
      render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={onToast} />)
      await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

      const file = new File(['content'], 'big.png', { type: 'image/png' })
      const analyzeInput = screen.getByTestId('analyze-file-input')
      fireEvent.change(analyzeInput, { target: { files: [file] } })

      await waitFor(() =>
        expect(onToast).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error', message: expect.stringContaining('File too large') })
        )
      )
    })

    it('fills fields when file is dropped onto the Analyze button', async () => {
      gemini.analyzeSource.mockResolvedValue({ ClientName: 'Dropped' })
      render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
      await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

      const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
      const analyzeBtn = screen.getByRole('button', { name: /analyze/i })
      fireEvent.drop(analyzeBtn, {
        dataTransfer: { files: [file] },
      })

      await waitFor(() => {
        expect(screen.getByLabelText('ClientName')).toHaveValue('Dropped')
      })
    })
  })
})
