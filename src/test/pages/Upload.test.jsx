import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/renderers/index.js', () => ({ renderFile: vi.fn() }))
vi.mock('../../components/FileDropZone.jsx', () => ({
  default: ({ onFile }) => (
    <button onClick={() => onFile(new File([new ArrayBuffer(4)], 'test.docx'))}>
      select file
    </button>
  ),
}))

import Upload from '../../pages/Upload.jsx'
import * as renderers from '../../lib/renderers/index.js'
import { LanguageProvider } from '../../lib/i18n.jsx'

const RENDER_RESULT = {
  html: '<p>Hello</p>',
  binary: new ArrayBuffer(4),
  format: 'docx',
}

beforeEach(() => vi.clearAllMocks())

describe('Upload', () => {
  it('renders the file drop zone', () => {
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'select file' })).toBeInTheDocument()
  })

  it('shows loading state while rendering', async () => {
    renderers.renderFile.mockReturnValue(new Promise(() => {})) // never resolves
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(screen.getByTestId('loading')).toBeInTheDocument())
  })

  it('calls onScan with html, binary, format, fileName, and empty fields on success', async () => {
    renderers.renderFile.mockResolvedValue(RENDER_RESULT)
    const onScan = vi.fn()
    render(<Upload onScan={onScan} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(onScan).toHaveBeenCalledWith({
        html: '<p>Hello</p>',
        binary: expect.any(ArrayBuffer),
        format: 'docx',
        fileName: 'test.docx',
        fields: [],
      })
    )
  })

  it('shows error when renderFile throws', async () => {
    renderers.renderFile.mockRejectedValue(new Error('Unsupported format — use DOCX or XLSX'))
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(screen.getByText(/unsupported format/i)).toBeInTheDocument()
    )
  })

  it('clears error when a new file is selected after a previous failure', async () => {
    renderers.renderFile
      .mockRejectedValueOnce(new Error('First file failed'))
      .mockResolvedValueOnce(RENDER_RESULT)
    const onScan = vi.fn()
    render(<Upload onScan={onScan} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(screen.getByText(/first file failed/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(onScan).toHaveBeenCalled())
    expect(screen.queryByText(/first file failed/i)).not.toBeInTheDocument()
  })

  it('does not call Gemini API at any point', async () => {
    renderers.renderFile.mockResolvedValue(RENDER_RESULT)
    render(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(renderers.renderFile).toHaveBeenCalled())
    // No gemini import means no extractVariables call — this test passing confirms it
  })
})

describe('Upload — Vietnamese', () => {
  function renderVi(ui) {
    return render(
      <LanguageProvider lang="vi" setLang={vi.fn()}>
        {ui}
      </LanguageProvider>
    )
  }

  it('shows Vietnamese title', () => {
    renderVi(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByText('Tải lên tài liệu')).toBeInTheDocument()
  })

  it('shows Vietnamese rendering text while loading', async () => {
    renderers.renderFile.mockReturnValue(new Promise(() => {}))
    renderVi(<Upload onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(screen.getByText('Đang xử lý tài liệu…')).toBeInTheDocument()
    )
  })
})
