import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import VariableChip from '../../components/VariableChip.jsx'

describe('VariableChip', () => {
  it('renders the variable name', () => {
    render(<VariableChip name="ClientName" onRename={vi.fn()} onRemove={vi.fn()} color="bg-blue-600" />)
    expect(screen.getByText('ClientName')).toBeInTheDocument()
  })

  it('calls onRemove when × is clicked', () => {
    const onRemove = vi.fn()
    render(<VariableChip name="ClientName" onRename={vi.fn()} onRemove={onRemove} color="bg-blue-600" />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemove).toHaveBeenCalled()
  })

  it('shows input when name is clicked', () => {
    render(<VariableChip name="ClientName" onRename={vi.fn()} onRemove={vi.fn()} color="bg-blue-600" />)
    fireEvent.click(screen.getByRole('button', { name: 'ClientName' }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('calls onRename with new value on blur', () => {
    const onRename = vi.fn()
    render(<VariableChip name="ClientName" onRename={onRename} onRemove={vi.fn()} color="bg-blue-600" />)
    fireEvent.click(screen.getByRole('button', { name: 'ClientName' }))
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'BuyerName' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('BuyerName')
  })

  it('cancels rename on Escape', () => {
    const onRename = vi.fn()
    render(<VariableChip name="ClientName" onRename={onRename} onRemove={vi.fn()} color="bg-blue-600" />)
    fireEvent.click(screen.getByRole('button', { name: 'ClientName' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'ClientName' })).toBeInTheDocument()
    expect(onRename).not.toHaveBeenCalled()
  })
})
