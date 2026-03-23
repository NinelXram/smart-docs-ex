import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/storage.js', () => ({
  getTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
}))

import Library from '../../pages/Library.jsx'
import * as storage from '../../lib/storage.js'

const TEMPLATES = [
  {
    id: 'id-1',
    name: 'Sales Contract',
    sourceFormat: 'docx',
    fields: ['ClientName', 'Date'],
    createdAt: 1000000000000,
  },
  {
    id: 'id-2',
    name: 'NDA',
    sourceFormat: 'pdf',
    fields: ['Party'],
    createdAt: 1100000000000,
  },
]

beforeEach(() => vi.clearAllMocks())

describe('Library', () => {
  it('lists templates loaded from storage', async () => {
    storage.getTemplates.mockResolvedValue(TEMPLATES)
    render(<Library onSelect={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('Sales Contract')).toBeInTheDocument()
      expect(screen.getByText('NDA')).toBeInTheDocument()
    })
  })

  it('shows format badge and variable count', async () => {
    storage.getTemplates.mockResolvedValue(TEMPLATES)
    render(<Library onSelect={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByText('DOCX')).toBeInTheDocument()
      expect(screen.getByText('2 variables')).toBeInTheDocument()
    })
  })

  it('shows empty state when no templates', async () => {
    storage.getTemplates.mockResolvedValue([])
    render(<Library onSelect={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/no templates/i)).toBeInTheDocument()
    )
  })

  it('calls onSelect when template is clicked', async () => {
    storage.getTemplates.mockResolvedValue(TEMPLATES)
    const onSelect = vi.fn()
    render(<Library onSelect={onSelect} onToast={vi.fn()} />)
    await waitFor(() => screen.getByText('Sales Contract'))
    fireEvent.click(screen.getByText('Sales Contract'))
    expect(onSelect).toHaveBeenCalledWith(TEMPLATES[0])
  })

  it('deletes template and removes from list', async () => {
    storage.getTemplates.mockResolvedValue(TEMPLATES)
    storage.deleteTemplate.mockResolvedValue()
    render(<Library onSelect={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => screen.getByText('Sales Contract'))
    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0])
    await waitFor(() =>
      expect(screen.queryByText('Sales Contract')).not.toBeInTheDocument()
    )
    expect(storage.deleteTemplate).toHaveBeenCalledWith('id-1')
  })

  it('shows error toast when getTemplates fails', async () => {
    storage.getTemplates.mockRejectedValue(new Error('Storage error'))
    const onToast = vi.fn()
    render(<Library onSelect={vi.fn()} onToast={onToast} />)
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })

  it('shows error toast when delete fails', async () => {
    storage.getTemplates.mockResolvedValue(TEMPLATES)
    storage.deleteTemplate.mockRejectedValue(new Error('Delete failed'))
    const onToast = vi.fn()
    render(<Library onSelect={vi.fn()} onToast={onToast} />)
    await waitFor(() => screen.getByText('Sales Contract'))
    fireEvent.click(screen.getAllByRole('button', { name: /delete/i })[0])
    await waitFor(() =>
      expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    )
  })
})
