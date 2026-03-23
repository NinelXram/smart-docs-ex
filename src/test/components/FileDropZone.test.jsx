import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FileDropZone from '../../components/FileDropZone.jsx'
import { LanguageProvider } from '../../lib/i18n.jsx'

describe('FileDropZone', () => {
  it('renders a drop zone with accepted formats', () => {
    render(<FileDropZone onFile={vi.fn()} accept=".pdf,.docx,.xlsx" />)
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
    expect(screen.getByText(/pdf.*docx.*xlsx/i)).toBeInTheDocument()
  })

  it('calls onFile when a file is dropped', () => {
    const onFile = vi.fn()
    render(<FileDropZone onFile={onFile} accept=".pdf,.docx,.xlsx" />)
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('dropzone'), {
      dataTransfer: { files: [file] },
    })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('calls onFile when a file is selected via input', () => {
    const onFile = vi.fn()
    render(<FileDropZone onFile={onFile} accept=".pdf,.docx,.xlsx" />)
    const file = new File(['content'], 'test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('ignores drop if no files', () => {
    const onFile = vi.fn()
    render(<FileDropZone onFile={onFile} accept=".pdf" />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [] } })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('renders Vietnamese dropzone text when lang is vi', () => {
    render(<LanguageProvider lang="vi" setLang={() => {}}><FileDropZone onFile={() => {}} accept=".docx" /></LanguageProvider>)
    expect(screen.getByText('Kéo thả tệp hoặc nhấp để duyệt')).toBeInTheDocument()
  })
})
