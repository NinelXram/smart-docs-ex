import { useState } from 'react'
import { testConnection } from '../lib/gemini.js'
import { saveApiKey } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function Onboarding({ onSuccess }) {
  const { t } = useLanguage()
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async e => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await testConnection(key.trim())
      await saveApiKey(key.trim())
      onSuccess(key.trim())
    } catch (err) {
      setError(err.message ?? 'An unexpected error occurred.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen p-6 gap-6">
      <div className="text-center">
        <h1 className="text-lg font-bold text-white">{t('onboarding.title')}</h1>
        <p className="text-xs text-gray-400 mt-1">{t('onboarding.subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
        <input
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder={t('onboarding.placeholder')}
          className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading || !key.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded transition-colors"
        >
          {loading ? t('onboarding.submitting') : t('onboarding.submit')}
        </button>
      </form>
      <p className="text-xs text-gray-500 text-center">
        {t('onboarding.getKey')}{' '}
        <span className="text-blue-400">aistudio.google.com</span>
      </p>
    </div>
  )
}
