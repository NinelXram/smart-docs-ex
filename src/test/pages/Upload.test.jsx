import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/parsers/index.js', () => ({ parseFile: vi.fn() }))
vi.mock('../../lib/gemini.js', () => ({ extractVariables: vi.fn() }))
vi.mock('../../components/FileDropZone.jsx', () => ({
  default: ({ onFile }) => (
    <button onClick={() => onFile(new File(['x'], 'test.pdf'))}>select file</button>
  ),
}))

import Upload from '../../pages/Upload.jsx'
import * as parsers from '../../lib/parsers/index.js'
import * as gemini from '../../lib/gemini.js'

const VARS = [{ name: 'ClientName', marker: 'made with [VALUE] hereinafter' }]

beforeEach(() => vi.clearAllMocks())

describe('Upload', () => {
  it('renders the file drop zone', () => {
    render(<Upload apiKey="key" onScan={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'select file' })).toBeInTheDocument()
  })

  it('shows loading state while scanning', async () => {
    parsers.parseFile.mockResolvedValue({ text: 'doc text', format: 'pdf' })
    gemini.extractVariables.mockReturnValue(new Promise(() => {})) // never resolves
    render(<Upload apiKey="key" onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() => expect(screen.getByTestId('scanning')).toBeInTheDocument())
  })

  it('calls onScan with text, format, and variables on success', async () => {
    parsers.parseFile.mockResolvedValue({ text: 'doc text', format: 'pdf' })
    gemini.extractVariables.mockResolvedValue(VARS)
    const onScan = vi.fn()
    render(<Upload apiKey="key" onScan={onScan} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(onScan).toHaveBeenCalledWith({
        text: 'doc text',
        format: 'pdf',
        variables: VARS,
        fileName: 'test.pdf',
      })
    )
  })

  it('shows error when parseFile throws', async () => {
    parsers.parseFile.mockRejectedValue(new Error('Unsupported file format: .txt'))
    render(<Upload apiKey="key" onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(screen.getByText(/unsupported file format/i)).toBeInTheDocument()
    )
  })

  it('shows error when extractVariables throws', async () => {
    parsers.parseFile.mockResolvedValue({ text: 'doc text', format: 'pdf' })
    gemini.extractVariables.mockRejectedValue(new Error('Document too large'))
    render(<Upload apiKey="key" onScan={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'select file' }))
    await waitFor(() =>
      expect(screen.getByText(/document too large/i)).toBeInTheDocument()
    )
  })
})
