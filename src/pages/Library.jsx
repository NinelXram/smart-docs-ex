import { useState, useEffect } from 'react'
import { getTemplates, deleteTemplate } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.jsx'

const FORMAT_BADGE = {
  pdf: 'bg-red-700',
  docx: 'bg-blue-700',
  xlsx: 'bg-green-700',
  xls: 'bg-green-700',
}

export default function Library({ onSelect, onEdit = () => {}, onNew, onToast }) {
  const { t } = useLanguage()
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
        onToast({ message: `${t('library.errorLoad')} ${err.message}`, type: 'error' })
      })
  }, [])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (err) {
      onToast({ message: `${t('library.errorDelete')} ${err.message}`, type: 'error' })
    }
  }

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">{t('library.loading')}</div>
  }

  if (templates.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-xs flex flex-col items-center gap-3">
        <span>{t('library.empty')}</span>
        <button
          onClick={onNew}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {t('library.new')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      <div className="flex justify-end mb-1">
        <button
          onClick={onNew}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
        >
          {t('library.new')}
        </button>
      </div>
      {templates.map(tpl => {
        const count = (tpl.fields ?? []).length
        return (
          <div
            key={tpl.id}
            onClick={() => onSelect(tpl)}
            className="flex items-center gap-2 p-3 rounded-lg bg-white hover:bg-gray-100 cursor-pointer transition-colors border border-gray-200"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-900 font-medium truncate">{tpl.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {count} {t(count === 1 ? 'library.variable' : 'library.variables')}
              </div>
            </div>
            <span
              className={`text-xs text-white px-1.5 py-0.5 rounded shrink-0 ${FORMAT_BADGE[tpl.sourceFormat] ?? 'bg-gray-600'}`}
            >
              {(tpl.sourceFormat ?? '').toUpperCase()}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onEdit(tpl) }}
              aria-label={t('library.ariaEdit')}
              className="text-gray-500 hover:text-blue-500 shrink-0 text-sm"
            >
              ✎
            </button>
            <button
              onClick={e => handleDelete(e, tpl.id)}
              aria-label={t('library.ariaDelete')}
              className="text-gray-500 hover:text-red-400 shrink-0 text-sm"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
