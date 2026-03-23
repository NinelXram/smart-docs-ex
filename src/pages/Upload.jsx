import { useState } from 'react'
import FileDropZone from '../components/FileDropZone.jsx'
import { renderFile } from '../lib/renderers/index.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function Upload({ onScan, onToast }) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async file => {
    setError(null)
    setLoading(true)
    try {
      const { html, binary, format } = await renderFile(file)
      onScan?.({ html, binary, format, fileName: file.name, fields: [] })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-300">{t('upload.title')}</h2>
      {loading ? (
        <div data-testid="loading" className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">{t('upload.rendering')}</span>
        </div>
      ) : (
        <>
          <FileDropZone onFile={handleFile} accept=".docx,.xlsx" />
          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}
        </>
      )}
    </div>
  )
}
