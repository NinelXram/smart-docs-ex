import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('../lib/storage.js', () => ({
  getApiKey: vi.fn(),
  checkOpfsAvailable: vi.fn(),
  getLang: vi.fn().mockResolvedValue('vi'),
  saveLang: vi.fn().mockResolvedValue(undefined),
}))
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

beforeEach(() => {
  vi.clearAllMocks()
  storage.checkOpfsAvailable.mockResolvedValue(undefined)
})

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
    const buttons = screen.getAllByRole('button')
    const libraryBtn = buttons.find(b => /library|thư viện/i.test(b.textContent))
    fireEvent.click(libraryBtn)
    expect(screen.getByTestId('library')).toBeInTheDocument()
  })

  it('renders normally when checkOpfsAvailable resolves', async () => {
    storage.getApiKey.mockResolvedValue('my-key')
    storage.checkOpfsAvailable.mockResolvedValue(undefined)
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('upload')).toBeInTheDocument())
    expect(screen.queryByTestId('opfs-error')).not.toBeInTheDocument()
  })

  it('shows full-screen OPFS error when checkOpfsAvailable rejects', async () => {
    storage.getApiKey.mockResolvedValue('my-key')
    storage.checkOpfsAvailable.mockRejectedValue(new Error('OPFS not supported'))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('opfs-error')).toBeInTheDocument())
  })
})

describe('language', () => {
  it('loads saved language from storage on mount', async () => {
    storage.getLang.mockResolvedValue('en')
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(storage.getLang).toHaveBeenCalled())
  })

  it('renders EN toggle button when lang is vi and step > 0', async () => {
    storage.getLang.mockResolvedValue('vi')
    storage.getApiKey.mockResolvedValue('my-key')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'EN' })).toBeInTheDocument())
  })
})
