import { useState, useEffect } from 'react'
import { getTemplates, deleteTemplate } from '../lib/storage.js'

const FORMAT_BADGE = {
  pdf: 'bg-red-700',
  docx: 'bg-blue-700',
  xlsx: 'bg-green-700',
  xls: 'bg-green-700',
}

export default function Library({ onSelect, onToast }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTemplates()
      .then(list => {
        setTemplates(list)
        setLoading(false)
      })
      .catch(err => {
        setLoading(false)
        onToast({ message: `Failed to load templates: ${err.message}`, type: 'error' })
      })
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      onToast({ message: `Delete failed: ${err.message}`, type: 'error' })
    }
  }

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading…</div>
  }

  if (templates.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-xs">
        No templates saved yet. Upload a document to create one.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {templates.map(tpl => (
        <div
          key={tpl.id}
          onClick={() => onSelect(tpl)}
          className="flex items-center gap-2 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 cursor-pointer transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm text-white font-medium truncate">{tpl.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {(tpl.fields ?? []).length} variable{(tpl.fields ?? []).length !== 1 ? 's' : ''}
            </div>
          </div>
          <span
            className={`text-xs text-white px-1.5 py-0.5 rounded shrink-0 ${FORMAT_BADGE[tpl.sourceFormat] ?? 'bg-gray-600'}`}
          >
            {(tpl.sourceFormat ?? '').toUpperCase()}
          </span>
          <button
            onClick={e => handleDelete(e, tpl.id)}
            aria-label="delete template"
            className="text-gray-500 hover:text-red-400 shrink-0 text-sm"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
