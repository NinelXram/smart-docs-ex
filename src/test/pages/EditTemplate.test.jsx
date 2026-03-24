import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { LanguageProvider } from '../../lib/i18n.jsx'

vi.mock('../../lib/storage.js', () => ({
  saveTemplateMeta: vi.fn(),
}))

import EditTemplate from '../../pages/EditTemplate.jsx'
import * as storage from '../../lib/storage.js'

function renderWithLang(ui) {
  return render(
    <LanguageProvider lang="en" setLang={vi.fn()}>
      {ui}
    </LanguageProvider>
  )
}

const TEMPLATE = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'Date'],
  fieldDescriptions: { ClientName: 'Full client name' },
  fieldAliases: {},
  fieldEnabled: {},
  createdAt: 1000000000000,
}

beforeEach(() => vi.clearAllMocks())

describe('EditTemplate', () => {
  it('renders a card for each field', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByDisplayValue('ClientName')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Date')).toBeInTheDocument()
  })

  it('shows original token as read-only label', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByText('{{ClientName}}')).toBeInTheDocument()
    expect(screen.getByText('{{Date}}')).toBeInTheDocument()
  })

  it('Save button is disabled initially', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after changing a display name', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('Save button re-disables when change is reverted', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByDisplayValue('Client Name'), { target: { value: 'ClientName' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after toggling a field off', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('shows inline error and does not call saveTemplateMeta when display name is empty', async () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/display name cannot be empty/i)).toBeInTheDocument()
    )
    expect(storage.saveTemplateMeta).not.toHaveBeenCalled()
  })

  it('calls saveTemplateMeta and onSave with correct updatedMeta on success', async () => {
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    const onSave = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={onSave} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-1',
        fieldAliases: { ClientName: 'Client Name' },
        fields: ['ClientName', 'Date'],
        createdAt: 1000000000000,
      })
    ))
    expect(onSave).toHaveBeenCalled()
  })

  it('alias reverted to token name is omitted from fieldAliases', async () => {
    const tplWithAlias = { ...TEMPLATE, fieldAliases: { ClientName: 'Old Alias' } }
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    renderWithLang(<EditTemplate template={tplWithAlias} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Old Alias'), { target: { value: 'ClientName' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({ fieldAliases: {} })
    ))
  })

  it('shows toast and does not call onSave when saveTemplateMeta throws', async () => {
    storage.saveTemplateMeta.mockRejectedValue(new Error('write error'))
    const onSave = vi.fn()
    const onToast = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={onSave} onToast={onToast} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={onBack} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('field checkbox is unchecked when fieldEnabled is false', () => {
    const tpl = { ...TEMPLATE, fieldEnabled: { ClientName: false } }
    renderWithLang(<EditTemplate template={tpl} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  })

  it('saves fieldEnabled as false for toggled-off field', async () => {
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({ fieldEnabled: { ClientName: false } })
    ))
  })
})
