import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/storage.js', () => ({ saveTemplate: vi.fn() }))
vi.mock('uuid', () => ({ v4: () => 'test-uuid' }))
vi.mock('../../components/VariableChip.jsx', () => ({
  default: ({ name, onRename, onRemove }) => (
    <span data-testid={`chip-${name}`}>
      {name}
      <button onClick={() => onRename('Renamed')} aria-label={`rename ${name}`}>r</button>
      <button onClick={onRemove} aria-label={`remove ${name}`}>×</button>
    </span>
  ),
}))

import Review from '../../pages/Review.jsx'
import * as storage from '../../lib/storage.js'

// RAW contains real document values (not [VALUE] tokens) — Gemini markers match against this
const RAW = 'This agreement is made with Acme Corp hereinafter, effective as of 2026-01-01 between parties.'
const VARS = [
  { name: 'ClientName', marker: 'made with [VALUE] hereinafter' },
  { name: 'EffectiveDate', marker: 'effective as of [VALUE] between' },
]

beforeEach(() => vi.clearAllMocks())

describe('Review', () => {
  it('renders a chip for each variable', () => {
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByTestId('chip-ClientName')).toBeInTheDocument()
    expect(screen.getByTestId('chip-EffectiveDate')).toBeInTheDocument()
  })

  it('removes a chip when onRemove is called', () => {
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'remove ClientName' }))
    expect(screen.queryByTestId('chip-ClientName')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-EffectiveDate')).toBeInTheDocument()
  })

  it('renames a chip when onRename is called', () => {
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'rename ClientName' }))
    expect(screen.queryByTestId('chip-ClientName')).not.toBeInTheDocument()
    expect(screen.getByTestId('chip-Renamed')).toBeInTheDocument()
  })

  it('renders template name input', () => {
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByPlaceholderText(/template name/i)).toBeInTheDocument()
  })

  it('saves template and calls onSave', async () => {
    storage.saveTemplate.mockResolvedValue()
    const onSave = vi.fn()
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={onSave} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/template name/i), { target: { value: 'My Contract' } })
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))
    await waitFor(() => {
      expect(storage.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({
        id: 'test-uuid',
        name: 'My Contract',
        sourceFormat: 'docx',
        rawContent: RAW,
        variables: VARS,
      }))
      expect(onSave).toHaveBeenCalled()
    })
  })

  it('shows error toast when saving without a name', async () => {
    const onToast = vi.fn()
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={vi.fn()} onToast={onToast} />)
    fireEvent.click(screen.getByRole('button', { name: /save template/i }))
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
  })

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn()
    render(<Review rawContent={RAW} format="docx" initialVariables={VARS} onSave={vi.fn()} onBack={onBack} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('adds a variable from text selection', () => {
    window.getSelection = vi.fn(() => ({
      isCollapsed: false,
      toString: () => 'John Smith',
    }))
    // rawContent has real value "John Smith" (not [VALUE])
    render(<Review rawContent="This contract involves John Smith as the client." format="docx" initialVariables={[]} onSave={vi.fn()} onBack={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /add from selection/i }))
    fireEvent.change(screen.getByTestId('add-label-input'), { target: { value: 'ClientName' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByTestId('chip-ClientName')).toBeInTheDocument()
  })
})
