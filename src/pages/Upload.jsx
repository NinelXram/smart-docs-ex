import { useState } from 'react'
import FileDropZone from '../components/FileDropZone.jsx'
import { parseFile } from '../lib/parsers/index.js'
import { extractVariables } from '../lib/gemini.js'

export default function Upload({ apiKey, onScan, onToast }) {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)

  const handleFile = async file => {
    setError(null)
    setScanning(true)
    try {
      const { text, format } = await parseFile(file)
      const variables = await extractVariables(apiKey, text)
      onScan?.({ text, format, variables, fileName: file.name })
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-gray-300">Upload Document</h2>
      {scanning ? (
        <div data-testid="scanning" className="flex flex-col items-center gap-3 py-10 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs">Scanning with Gemini…</span>
        </div>
      ) : (
        <>
          <FileDropZone onFile={handleFile} accept=".pdf,.docx,.xlsx,.xls" />
          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}
        </>
      )}
    </div>
  )
}
