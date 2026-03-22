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
    variables: [{ name: 'ClientName', marker: 'x [VALUE] y' }, { name: 'Date', marker: 'a [VALUE] b' }],
    createdAt: 1000000000000,
  },
  {
    id: 'id-2',
    name: 'NDA',
    sourceFormat: 'pdf',
    variables: [{ name: 'Party', marker: 'c [VALUE] d' }],
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
})
