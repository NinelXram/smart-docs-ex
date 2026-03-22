import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../lib/storage.js', () => ({ getApiKey: vi.fn() }))
vi.mock('../pages/Onboarding.jsx', () => ({
  default: ({ onSuccess }) => (
    <div data-testid="onboarding">
      <button onClick={() => onSuccess('new-key')}>go</button>
    </div>
  ),
}))
vi.mock('../pages/Upload.jsx', () => ({ default: () => <div data-testid="upload" /> }))
vi.mock('../pages/Review.jsx', () => ({ default: () => <div data-testid="review" /> }))
vi.mock('../pages/Library.jsx', () => ({ default: () => <div data-testid="library" /> }))
vi.mock('../pages/Generate.jsx', () => ({ default: () => <div data-testid="generate" /> }))
vi.mock('../components/ProgressBar.jsx', () => ({
  default: ({ step }) => <div data-testid={`progress-${step}`} />,
}))
vi.mock('../components/Toast.jsx', () => ({ default: () => null }))

import App from '../App.jsx'
import * as storage from '../lib/storage.js'

beforeEach(() => vi.clearAllMocks())

describe('App', () => {
  it('shows loading initially', () => {
    storage.getApiKey.mockResolvedValue(null)
    render(<App />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('shows onboarding when no API key stored', async () => {
    storage.getApiKey.mockResolvedValue(null)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())
  })

  it('shows upload (step 1) when API key exists', async () => {
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('upload')).toBeInTheDocument())
  })

  it('shows progress bar when step > 0', async () => {
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('progress-1')).toBeInTheDocument())
  })

  it('navigates from onboarding to upload after onSuccess', async () => {
    storage.getApiKey.mockResolvedValue(null)
    render(<App />)
    await waitFor(() => screen.getByTestId('onboarding'))
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(screen.getByTestId('upload')).toBeInTheDocument())
  })

  it('library shortcut in header navigates to step 3', async () => {
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => screen.getByTestId('upload'))
    fireEvent.click(screen.getByRole('button', { name: /library/i }))
    expect(screen.getByTestId('library')).toBeInTheDocument()
  })
})
