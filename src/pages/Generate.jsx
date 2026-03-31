import { useState, useEffect, useRef } from 'react'
import { generateDocx, generateXlsx, saveFile } from '../lib/templateEngine.js'
import { getTemplateBinary, getApiKey } from '../lib/storage.js'
import { analyzeSource } from '../lib/gemini.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function Generate({ template, onBack, onToast }) {
  const { t, lang } = useLanguage()
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [binary, setBinary] = useState(null)
  const [binaryError, setBinaryError] = useState(false)
  const [loading, setLoading] = useState(true)
  const fileInputRef = useRef(null)

  useEffect(() => {
    getTemplateBinary(template.id)
      .then(buf => {
        setBinary(buf)
        setLoading(false)
      })
      .catch(() => {
        onToast({ message: t('generate.errorNotFound'), type: 'error' })
        setBinaryError(true)
        setLoading(false)
      })
  }, [template.id])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleClear = () => {
    if (window.confirm(t('generate.clearFormConfirm'))) {
      setValues({})
    }
  }

  const handleAnalyze = async (file) => {
    if (analyzing) return
    const apiKey = await getApiKey()
    if (!apiKey) {
      onToast({ message: t('generate.analyzeError'), type: 'error' })
      return
    }
    setAnalyzing(true)
    try {
      const enabledFields = template.fields.filter(f => template.fieldEnabled?.[f] ?? true)
      const matched = await analyzeSource(apiKey, file, enabledFields, lang, template.fieldDescriptions ?? {}, template.fieldSampleData ?? {}, values)
      setValues(prev => {
        const next = { ...prev }
        for (const [key, val] of Object.entries(matched)) {
          if (enabledFields.includes(key) && !prev[key]) next[key] = val
        }
        return next
      })
    } catch (err) {
      onToast({ message: `${t('generate.analyzeError')} ${err.message}`, type: 'error' })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [
          f,
          (template.fieldEnabled?.[f] ?? true) ? (values[f] ?? '') : ''
        ])
      )

      let blob
      if (template.sourceFormat === 'docx') {
        blob = await generateDocx(binary, fieldValues)
        await saveFile(blob, `${template.name}.docx`, template.sourceFormat)
      } else {
        blob = await generateXlsx(binary, fieldValues)
        await saveFile(blob, `${template.name}.xlsx`, template.sourceFormat)
      }
    } catch (err) {
      onToast({ message: `${t('generate.errorFailed')} ${err.message}`, type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="relative flex flex-col h-full">
      {analyzing && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm gap-3">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-purple-300">{t('generate.analyzing')}</p>
        </div>
      )}
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          {t('generate.back')}
        </button>
        <span className="text-sm font-medium text-white truncate flex-1">{template.name}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.docx,.txt"
          data-testid="analyze-file-input"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleAnalyze(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const file = e.dataTransfer.files?.[0]
            if (file) handleAnalyze(file)
          }}
          disabled={loading || binaryError || analyzing}
          className="text-xs text-purple-400 hover:text-white px-2 py-1 rounded border border-purple-700 disabled:opacity-50 transition-colors"
        >
          {analyzing ? t('generate.analyzing') : t('generate.analyze')}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {template.fields.map(name => {
          const alias = template.fieldAliases?.[name] ?? name
          const isEnabled = template.fieldEnabled?.[name] ?? true
          const description = template.fieldDescriptions?.[name]
          const sampleData = template.fieldSampleData?.[name]
          return (
            <div key={name} className={`flex flex-col gap-1 ${isEnabled ? '' : 'opacity-50'}`}>
              <label
                htmlFor={`field-${name}`}
                className={`text-xs text-gray-400 font-medium ${isEnabled ? '' : 'line-through'}`}
              >
                {alias}
              </label>
              {description && (
                <p className="text-xs text-gray-500 -mt-0.5">{description}</p>
              )}
              {sampleData && (
                <p className="text-xs text-gray-600 -mt-0.5 font-mono">{t('generate.sampleData')}: <em className="not-italic text-gray-500">{sampleData}</em></p>
              )}
              <input
                id={`field-${name}`}
                value={values[name] ?? ''}
                disabled={!isEnabled}
                onChange={e => handleChange(name, e.target.value)}
                className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder={`${t('generate.fieldPlaceholder')} ${alias}…`}
              />
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={handleClear}
          disabled={loading || binaryError || generating}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600 disabled:opacity-50 transition-colors"
        >
          {t('generate.clearForm')}
        </button>
        <button
          onClick={handleGenerate}
          disabled={loading || binaryError || generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? t('generate.generating') : t('generate.download')}
        </button>
      </div>
    </div>
  )
}
