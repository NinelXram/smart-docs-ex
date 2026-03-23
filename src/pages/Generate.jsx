import { useState, useEffect } from 'react'
import { generateDocx, generateXlsx, saveFile } from '../lib/templateEngine.js'
import { getTemplateBinary } from '../lib/storage.js'

export default function Generate({ template, onBack, onToast }) {
  const [values, setValues] = useState({})
  const [generating, setGenerating] = useState(false)
  const [binary, setBinary] = useState(null)
  const [binaryError, setBinaryError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTemplateBinary(template.id)
      .then(buf => {
        setBinary(buf)
        setLoading(false)
      })
      .catch(() => {
        onToast({ message: 'Template file not found — please re-upload', type: 'error' })
        setBinaryError(true)
        setLoading(false)
      })
  }, [template.id])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const fieldValues = Object.fromEntries(
        template.fields.map(f => [f, values[f] ?? ''])
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
      onToast({ message: `Generation failed: ${err.message}`, type: 'error' })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-white truncate flex-1">{template.name}</span>
      </div>

      <div className="flex-1 overflow-auto p-4 flex flex-col gap-4">
        {template.fields.map(name => (
          <div key={name} className="flex flex-col gap-1">
            <label htmlFor={`field-${name}`} className="text-xs text-gray-400 font-medium">
              {name}
            </label>
            <input
              id={`field-${name}`}
              value={values[name] ?? ''}
              onChange={e => handleChange(name, e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              placeholder={`Enter ${name}…`}
            />
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={handleGenerate}
          disabled={loading || binaryError || generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
    </div>
  )
}
