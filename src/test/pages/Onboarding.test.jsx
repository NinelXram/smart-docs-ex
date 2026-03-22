import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../../lib/gemini.js', () => ({ testConnection: vi.fn() }))
vi.mock('../../lib/storage.js', () => ({ saveApiKey: vi.fn() }))

import Onboarding from '../../pages/Onboarding.jsx'
import * as gemini from '../../lib/gemini.js'
import * as storage from '../../lib/storage.js'

beforeEach(() => vi.clearAllMocks())

describe('Onboarding', () => {
  it('renders API key input and submit button', () => {
    render(<Onboarding onSuccess={vi.fn()} />)
    expect(screen.getByPlaceholderText(/api key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument()
  })

  it('calls testConnection with entered key on submit', async () => {
    gemini.testConnection.mockResolvedValue(true)
    storage.saveApiKey.mockResolvedValue()
    render(<Onboarding onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: 'my-key' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(gemini.testConnection).toHaveBeenCalledWith('my-key'))
  })

  it('saves key and calls onSuccess after successful connection', async () => {
    gemini.testConnection.mockResolvedValue(true)
    storage.saveApiKey.mockResolvedValue()
    const onSuccess = vi.fn()
    render(<Onboarding onSuccess={onSuccess} />)
    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: 'my-key' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('my-key'))
    expect(storage.saveApiKey).toHaveBeenCalledWith('my-key')
  })

  it('shows error message when testConnection throws', async () => {
    gemini.testConnection.mockRejectedValue(new Error('Invalid API key'))
    render(<Onboarding onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: 'bad-key' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(screen.getByText(/invalid api key/i)).toBeInTheDocument())
  })

  it('disables button while connecting', async () => {
    gemini.testConnection.mockReturnValue(new Promise(() => {})) // never resolves
    render(<Onboarding onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/api key/i), { target: { value: 'key' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled()
  })
})
