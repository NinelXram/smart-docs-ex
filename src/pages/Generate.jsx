import { useState } from 'react'
import {
  injectVariables,
  generatePdf,
  generateDocx,
  generateXlsx,
  downloadBlob,
} from '../lib/templateEngine.js'

const FORMAT_LABELS = { pdf: 'PDF', docx: 'DOCX', xlsx: 'XLSX' }

export default function Generate({ template, onBack, onToast }) {
  const [values, setValues] = useState({})
  const [outputFormat, setOutputFormat] = useState(template.sourceFormat)
  const [generating, setGenerating] = useState(false)
  const [warnings, setWarnings] = useState([])

  const handleChange = (name, value) => {
    setValues(prev => ({ ...prev, [name]: value }))
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setWarnings([])
    try {
      const { content, warnings: w } = injectVariables(
        template.rawContent,
        template.variables,
        values
      )
      if (w.length) setWarnings(w)

      let blob
      if (outputFormat === 'pdf') blob = await generatePdf(content)
      else if (outputFormat === 'docx') blob = await generateDocx(content)
      else blob = await generateXlsx(content)

      downloadBlob(blob, `${template.name}.${outputFormat}`)
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
        {template.variables.map(v => (
          <div key={v.name} className="flex flex-col gap-1">
            <label htmlFor={`field-${v.name}`} className="text-xs text-gray-400 font-medium">
              {v.name}
            </label>
            <input
              id={`field-${v.name}`}
              value={values[v.name] ?? ''}
              onChange={e => handleChange(v.name, e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
              placeholder={`Enter ${v.name}…`}
            />
          </div>
        ))}

        {warnings.length > 0 && (
          <div className="text-xs text-yellow-400 flex flex-col gap-1 bg-yellow-900/20 rounded p-3">
            {warnings.map((w, i) => <span key={i}>⚠ {w}</span>)}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-700 flex gap-2 items-center shrink-0">
        <select
          value={outputFormat}
          onChange={e => setOutputFormat(e.target.value)}
          className="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none"
        >
          {Object.entries(FORMAT_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-1.5 rounded transition-colors"
        >
          {generating ? 'Generating…' : '⬇ Download'}
        </button>
      </div>
    </div>
  )
}
