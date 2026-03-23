import { useRef, useState } from 'react'
import { useLanguage } from '../lib/i18n.jsx'

export default function FileDropZone({ onFile, accept }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const { t } = useLanguage()

  const handleDrop = e => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer?.files?.[0]
    if (file) onFile(file)
  }

  const handleChange = e => {
    const file = e.target.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      data-testid="dropzone"
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${
        dragOver ? 'border-blue-400 bg-blue-900/20' : 'border-gray-600 hover:border-gray-400'
      }`}
    >
      <span className="text-2xl">📄</span>
      <span className="text-sm text-gray-300">{t('upload.dropzoneLabel')}</span>
      <span className="text-xs text-gray-500">{t('upload.dropzoneAccepted')}</span>
      <input
        data-testid="file-input"
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}
