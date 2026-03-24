import { useState, useMemo } from 'react'
import { saveTemplateMeta } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function EditTemplate({ template, onBack, onSave, onToast }) {
  const { t } = useLanguage()

  const [aliases, setAliases] = useState(() =>
    Object.fromEntries(template.fields.map(f => [f, template.fieldAliases?.[f] ?? f]))
  )
  const [descriptions, setDescriptions] = useState(() =>
    Object.fromEntries(template.fields.map(f => [f, template.fieldDescriptions?.[f] ?? '']))
  )
  const [enabled, setEnabled] = useState(() =>
    Object.fromEntries(template.fields.map(f => [f, template.fieldEnabled?.[f] ?? true]))
  )
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const isDirty = useMemo(() => {
    return template.fields.some(f => {
      const initAlias = template.fieldAliases?.[f] ?? f
      const initDesc = template.fieldDescriptions?.[f] ?? ''
      const initEnabled = template.fieldEnabled?.[f] ?? true
      return aliases[f] !== initAlias || descriptions[f] !== initDesc || enabled[f] !== initEnabled
    })
  }, [aliases, descriptions, enabled, template])

  const handleSave = async () => {
    const newErrors = {}
    for (const f of template.fields) {
      if (!aliases[f].trim()) newErrors[f] = t('editTemplate.errorNameEmpty')
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSaving(true)
    try {
      const updatedMeta = {
        ...template,
        fieldAliases: Object.fromEntries(
          template.fields
            .filter(f => aliases[f].trim() !== f)
            .map(f => [f, aliases[f].trim()])
        ),
        fieldDescriptions: Object.fromEntries(
          template.fields
            .filter(f => descriptions[f].trim())
            .map(f => [f, descriptions[f].trim()])
        ),
        fieldEnabled: Object.fromEntries(
          template.fields
            .filter(f => !enabled[f])
            .map(f => [f, false])
        ),
      }
      await saveTemplateMeta(updatedMeta)
      onToast({ message: t('editTemplate.saved'), type: 'success' })
      onSave()
    } catch (err) {
      onToast({ message: `${t('editTemplate.errorSaveFailed')} ${err.message}`, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded border border-gray-300"
        >
          {t('editTemplate.back')}
        </button>
        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
          {t('editTemplate.title')}: {template.name}
        </span>
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded"
        >
          {saving ? t('editTemplate.saving') : t('editTemplate.save')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
        {template.fields.map(f => {
          const isEnabled = enabled[f]
          return (
            <div
              key={f}
              className={`border border-gray-200 rounded-lg p-3 flex flex-col gap-2 transition-opacity ${isEnabled ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  aria-label={`${t('editTemplate.toggle')} ${f}`}
                  onChange={e => {
                    setEnabled(prev => ({ ...prev, [f]: e.target.checked }))
                    setErrors(prev => ({ ...prev, [f]: undefined }))
                  }}
                  className="w-4 h-4 accent-blue-600"
                />
                <span className="text-xs font-mono text-gray-400">{`{{${f}}}`}</span>
              </div>

              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-gray-500">{t('editTemplate.displayName')}</label>
                <input
                  value={aliases[f]}
                  maxLength={40}
                  onChange={e => {
                    setAliases(prev => ({ ...prev, [f]: e.target.value }))
                    setErrors(prev => ({ ...prev, [f]: undefined }))
                  }}
                  className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-blue-500"
                />
                {errors[f] && <p className="text-xs text-red-400">{errors[f]}</p>}
              </div>

              {/* Description reuses review.descriptionPlaceholder (intentional cross-namespace reuse) */}
              <div className="flex flex-col gap-0.5">
                <label className="text-xs text-gray-500">{t('editTemplate.description')}</label>
                <input
                  value={descriptions[f]}
                  onChange={e => {
                    const words = e.target.value.trim().split(/\s+/).filter(Boolean)
                    if (words.length <= 10 || e.target.value.length < descriptions[f].length) {
                      setDescriptions(prev => ({ ...prev, [f]: e.target.value }))
                    }
                  }}
                  placeholder={t('review.descriptionPlaceholder')}
                  className="bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
