import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import Toast from '../../components/Toast.jsx'

describe('Toast', () => {
  it('renders the message', () => {
    render(<Toast message="Something went wrong" type="error" onDismiss={vi.fn()} />)
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Done" type="info" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it('applies error styling for type error', () => {
    render(<Toast message="Oops" type="error" onDismiss={vi.fn()} />)
    expect(screen.getByTestId('toast')).toHaveClass('bg-red-700')
  })

  it('applies warning styling for type warning', () => {
    render(<Toast message="Watch out" type="warning" onDismiss={vi.fn()} />)
    expect(screen.getByTestId('toast')).toHaveClass('bg-yellow-700')
  })
})
