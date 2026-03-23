import { useState, useRef, useEffect, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { renderDocx } from '../lib/renderers/docx.js'
import { renderXlsx } from '../lib/renderers/xlsx.js'
import { insertDocx, insertXlsx } from '../lib/fieldEditor.js'
import { suggestFieldName } from '../lib/gemini.js'
import { saveTemplate } from '../lib/storage.js'

const CHIP_COLORS = [
  'bg-blue-600', 'bg-green-600', 'bg-purple-600',
  'bg-orange-500', 'bg-pink-600', 'bg-teal-600',
]


function applyChipOverlay(container, fields) {
  if (!fields.length) return
  const pattern = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes = []
  let node
  while ((node = walker.nextNode())) {
    pattern.lastIndex = 0
    if (pattern.test(node.textContent)) textNodes.push(node)
  }
  for (const textNode of textNodes) {
    const parent = textNode.parentNode
    const frag = document.createDocumentFragment()
    let text = textNode.textContent
    let lastIndex = 0
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
      }
      const fieldName = match[1]
      const colorIdx = fields.indexOf(fieldName)
      const chip = document.createElement('span')
      chip.className = `inline-block px-1.5 py-0.5 rounded text-xs font-mono text-white ${CHIP_COLORS[colorIdx % CHIP_COLORS.length] || 'bg-gray-600'}`
      chip.textContent = `{{${fieldName}}}`
      frag.appendChild(chip)
      lastIndex = match.index + match[0].length
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)))
    parent.replaceChild(frag, textNode)
  }
}

function getXlsxContext(td) {
  const table = td.closest('table')
  if (!table) return ''
  const allCells = Array.from(table.querySelectorAll('td'))
  const idx = allCells.indexOf(td)
  const radius = 2
  const contextCells = allCells
    .slice(Math.max(0, idx - radius), idx)
    .concat(allCells.slice(idx + 1, idx + 1 + radius))
  return contextCells.map(c => c.textContent.trim()).filter(Boolean).join(' ')
}

export default function Review({ html: initialHtml, binary: initialBinary, format, fileName, fields: initialFields, apiKey, onSave, onBack }) {
  const viewerRef = useRef(null)
  const [html, setHtml] = useState(initialHtml)
  const [binary, setBinary] = useState(initialBinary)
  const [fields, setFields] = useState(initialFields)
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [popover, setPopover] = useState(null)
  // popover shape: { state: 'loading'|'ready', fieldName: string, errorMsg: string, position: {top, left} }
  const pendingRef = useRef(null)
  // pending shape (DOCX): { selectedText, paragraphIndex }
  // pending shape (XLSX): { cellAddress, selectedText }

  // Apply html to DOM and run chip overlay after every html/fields update
  useEffect(() => {
    if (!viewerRef.current) return
    const scrollTop = viewerRef.current.scrollTop
    viewerRef.current.innerHTML = html
    applyChipOverlay(viewerRef.current, fields)
    viewerRef.current.scrollTop = scrollTop
  }, [html, fields])

  const openSuggestion = useCallback(async (selectedText, surroundingContext, pendingData, position) => {
    pendingRef.current = pendingData
    setPopover({ state: 'loading', fieldName: '', errorMsg: '', position })
    try {
      const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
      setPopover(prev => prev ? { ...prev, state: 'ready', fieldName: suggested ?? '' } : null)
    } catch {
      setPopover(prev => prev
        ? { ...prev, state: 'ready', fieldName: '', errorMsg: 'AI suggestion failed — enter a name manually' }
        : null)
    }
  }, [apiKey, fields])

  const handleMouseUp = useCallback(async () => {
    if (format !== 'docx') return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const selectedText = sel.toString().trim()
    if (selectedText.replace(/\s/g, '').length < 3) return

    // anchorNode/focusNode may be text nodes (no .closest); use parentElement first
    const anchorPara = sel.anchorNode?.parentElement?.closest('p') ?? null
    const focusPara = sel.focusNode?.parentElement?.closest('p') ?? null

    if (!anchorPara || anchorPara !== focusPara) {
      setPopover({ state: 'ready', fieldName: '', errorMsg: 'Select text within a single paragraph', position: { top: 80, left: 50 } })
      return
    }

    const allParas = Array.from(viewerRef.current.querySelectorAll('p'))
    const paragraphIndex = allParas.indexOf(anchorPara)

    const docText = viewerRef.current.textContent
    const selIdx = docText.indexOf(selectedText)
    const before = selIdx > 0 ? docText.slice(Math.max(0, selIdx - 100), selIdx) : ''
    const after = docText.slice(selIdx + selectedText.length, selIdx + selectedText.length + 100)
    const surroundingContext = before + selectedText + after

    const rect = sel.getRangeAt(0).getBoundingClientRect()
    await openSuggestion(selectedText, surroundingContext, { selectedText, paragraphIndex }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])

  const handleClick = useCallback(async e => {
    if (format !== 'xlsx') return
    const td = e.target.closest('td[data-cell-address]')
    if (!td) return
    const cellAddress = td.dataset.cellAddress
    const selectedText = td.textContent.trim()

    if (/^\{\{.+\}\}$/.test(selectedText)) {
      setPopover({ state: 'ready', fieldName: '', errorMsg: 'This cell is already a field', position: { top: 80, left: 50 } })
      return
    }

    const surroundingContext = getXlsxContext(td)
    const rect = td.getBoundingClientRect()
    await openSuggestion(selectedText, surroundingContext, { cellAddress, selectedText }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])

  const handleAccept = async () => {
    const fieldName = popover.fieldName.trim()
    if (!fieldName) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name is required' }))
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name must start with a letter and contain only letters, digits, and underscores' }))
      return
    }
    if (fields.includes(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: 'Field name already used — choose another' }))
      return
    }

    setProcessing(true)
    try {
      let result
      if (format === 'docx') {
        const { selectedText, paragraphIndex } = pendingRef.current
        result = insertDocx(binary, selectedText, paragraphIndex, fieldName)
      } else {
        const { cellAddress } = pendingRef.current
        result = insertXlsx(binary, cellAddress, fieldName)
      }

      if (result.error) {
        setPopover(prev => ({ ...prev, errorMsg: 'Could not locate selection in document — try selecting again' }))
        return
      }

      const newBinary = result.binary
      setBinary(newBinary)
      setFields(prev => [...prev, fieldName])

      const { html: newHtml } = format === 'docx'
        ? await renderDocx(newBinary)
        : renderXlsx(newBinary)
      setHtml(newHtml)
      setPopover(null)
      pendingRef.current = null
    } finally {
      setProcessing(false)
    }
  }

  const handleSave = async () => {
    setSaveError(null)
    if (!templateName.trim()) {
      setSaveError('Enter a template name')
      return
    }
    if (fields.length === 0) {
      setSaveError('Define at least one field before saving')
      return
    }
    setSaving(true)
    try {
      await saveTemplate({
        id: uuidv4(),
        name: templateName.trim(),
        sourceFormat: format,
        binary,
        fields,
        createdAt: Date.now(),
      })
      onSave()
    } catch (err) {
      setSaveError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          ← Back
        </button>
        <span className="text-xs text-gray-500">{fields.length} field{fields.length !== 1 ? 's' : ''}</span>
        <input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          placeholder="Template name…"
          className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded"
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </div>

      {saveError && (
        <p className="text-xs text-red-400 text-center px-3 py-1">{saveError}</p>
      )}

      {/* Document viewer */}
      <div className="relative flex-1 overflow-hidden">
        <div
          data-testid="doc-viewer"
          ref={viewerRef}
          className="h-full overflow-y-auto p-3 text-sm text-gray-200 leading-relaxed"
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        />

        {/* Spinner overlay during field insertion */}
        {processing && (
          <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Suggestion popover */}
        {popover && (
          <div
            role="dialog"
            aria-label="Field name suggestion"
            className="absolute z-20 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 w-64"
            style={{ top: popover.position.top, left: Math.min(popover.position.left, 120) }}
          >
            {popover.state === 'loading' ? (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                Analyzing…
              </div>
            ) : (
              <>
                <label htmlFor="field-name-input" className="text-xs text-gray-400 block mb-1">
                  Field name
                </label>
                <input
                  id="field-name-input"
                  autoFocus
                  value={popover.fieldName}
                  onChange={e => setPopover(prev => ({ ...prev, fieldName: e.target.value, errorMsg: '' }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleAccept(); if (e.key === 'Escape') setPopover(null) }}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 mb-2"
                />
                {popover.errorMsg && (
                  <p className="text-xs text-red-400 mb-2">{popover.errorMsg}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleAccept}
                    className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setPopover(null)}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
