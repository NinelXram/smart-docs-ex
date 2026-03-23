import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { renderDocx } from '../lib/renderers/docx.js'
import { renderXlsx } from '../lib/renderers/xlsx.js'
import { insertDocx, insertXlsx } from '../lib/fieldEditor.js'
import { suggestFieldName, suggestFieldPattern } from '../lib/gemini.js'
import { saveTemplate } from '../lib/storage.js'
import { parseXlsxSheets } from '../lib/renderers/xlsxSheetParser.js'

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

function parseCellAddr(addr) {
  const bang = addr.indexOf('!')
  if (bang === -1) return null
  const sheet = addr.slice(0, bang)
  const ref = addr.slice(bang + 1)
  const m = ref.match(/^([A-Z]+)(\d+)$/)
  if (!m) return null
  return { sheet, col: m[1], row: m[2] }
}

function getXlsxContext(td) {
  const table = td.closest('table')
  if (!table) return ''
  const addr = td.dataset.cellAddress
  if (!addr) return ''
  const target = parseCellAddr(addr)
  if (!target) return ''

  const allCells = Array.from(table.querySelectorAll('td[data-cell-address]'))
  const cellMap = new Map(allCells.map(c => [c.dataset.cellAddress, c]))
  const parts = []

  // Column header: row 1 of same column
  if (target.row !== '1') {
    const text = cellMap.get(`${target.sheet}!${target.col}1`)?.textContent.trim()
    if (text) parts.push(`column header: "${text}"`)
  }

  // Row label: column A of same row
  if (target.col !== 'A') {
    const text = cellMap.get(`${target.sheet}!A${target.row}`)?.textContent.trim()
    if (text) parts.push(`row label: "${text}"`)
  }

  // Adjacent cells in same row (excluding target)
  const rowSiblings = allCells
    .filter(c => {
      if (c === td) return false
      const p = parseCellAddr(c.dataset.cellAddress)
      return p && p.sheet === target.sheet && p.row === target.row
    })
    .map(c => c.textContent.trim())
    .filter(Boolean)
    .slice(0, 3)
  if (rowSiblings.length) parts.push(`row siblings: [${rowSiblings.join(', ')}]`)

  return parts.join('; ')
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
  // popover shape: { state: 'loading'|'ready', label: string, fieldName: string, errorMsg: string, position: {top, left} }
  const pendingRef = useRef(null)
  // pending shape (DOCX): { selectedText, paragraphIndex }
  // pending shape (XLSX): { cellAddress, fullCellText }

  const [currentSheet, setCurrentSheet] = useState(null)
  const tabSwitchRef = useRef(false)

  const sheets = useMemo(
    () => (format === 'xlsx' ? parseXlsxSheets(html) : []),
    [html, format]
  )

  // Apply active sheet (or full html for DOCX) to DOM after html, fields, or tab change.
  // tabSwitchRef distinguishes explicit tab switches (scroll → 0) from re-renders (preserve scroll).
  useEffect(() => {
    if (!viewerRef.current) return

    const isXlsx = format === 'xlsx' && sheets.length > 0
    const active = isXlsx
      ? (sheets.find(s => s.name === currentSheet) ?? sheets[0])
      : null

    // Sync currentSheet on first mount (null) or if active sheet changed
    if (isXlsx && active.name !== currentSheet) {
      setCurrentSheet(active.name)
      // Note: setCurrentSheet schedules a re-render but active.html is already correct here
    }

    // Capture and reset tabSwitchRef atomically before any early return path
    const isTabSwitch = tabSwitchRef.current
    tabSwitchRef.current = false
    const scrollTop = isTabSwitch ? 0 : viewerRef.current.scrollTop

    viewerRef.current.innerHTML = isXlsx ? active.html : html
    applyChipOverlay(viewerRef.current, fields)
    viewerRef.current.scrollTop = scrollTop
  }, [html, fields, currentSheet, format, sheets])

  const openSuggestion = useCallback(async (selectedText, surroundingContext, pendingData, position) => {
    pendingRef.current = pendingData
    setPopover({ state: 'loading', label: '', fieldName: '', errorMsg: '', position })
    try {
      if (format === 'xlsx') {
        const { fullCellText } = pendingData
        const result = await suggestFieldPattern(apiKey, fullCellText, selectedText, fields, surroundingContext)
        setPopover(prev => prev ? { ...prev, state: 'ready', label: result.label, fieldName: result.fieldName } : null)
      } else {
        const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields)
        setPopover(prev => prev ? { ...prev, state: 'ready', label: '', fieldName: suggested ?? '' } : null)
      }
    } catch {
      setPopover(prev => prev
        ? { ...prev, state: 'ready', label: '', fieldName: '', errorMsg: 'AI suggestion failed — enter values manually' }
        : null)
    }
  }, [apiKey, fields, format])

  const handleMouseUp = useCallback(async () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) return
    const selectedText = sel.toString().trim()
    if (selectedText.replace(/\s/g, '').length < 3) return

    if (format === 'docx') {
      // anchorNode/focusNode may be text nodes (no .closest); use parentElement first
      const anchorPara = sel.anchorNode?.parentElement?.closest('p') ?? null
      const focusPara = sel.focusNode?.parentElement?.closest('p') ?? null

      if (!anchorPara || anchorPara !== focusPara) {
        setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: 'Select text within a single paragraph', position: { top: 80, left: 50 } })
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
    } else if (format === 'xlsx') {
      const anchorCell = sel.anchorNode?.parentElement?.closest('td[data-cell-address]') ?? null
      const focusCell = sel.focusNode?.parentElement?.closest('td[data-cell-address]') ?? null
      if (!anchorCell || anchorCell !== focusCell) return

      const cellAddress = anchorCell.dataset.cellAddress
      const fullCellText = anchorCell.textContent.trim()
      const surroundingContext = getXlsxContext(anchorCell)
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      await openSuggestion(selectedText, surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
    }
  }, [format, openSuggestion])

  const handleClick = useCallback(async e => {
    if (format !== 'xlsx') return
    const td = e.target.closest('td[data-cell-address]')
    if (!td) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return

    const cellAddress = td.dataset.cellAddress
    const fullCellText = td.textContent.trim()

    if (/^\{\{.+\}\}$/.test(fullCellText)) {
      setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: 'This cell is already a field', position: { top: 80, left: 50 } })
      return
    }

    const surroundingContext = getXlsxContext(td)
    const rect = td.getBoundingClientRect()
    await openSuggestion('', surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion])

  const handleTabClick = useCallback((name) => {
    tabSwitchRef.current = true  // mark as tab switch so effect resets scroll
    setCurrentSheet(name)
  }, [])

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
        const pattern = (popover.label ?? '') + `{{${fieldName}}}`
        result = insertXlsx(binary, cellAddress, fieldName, pattern)
        // Note: renderXlsx is synchronous — no await needed below
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

      {format === 'xlsx' && (
        <div className="px-3 py-2 text-xs text-gray-400 bg-gray-800/40 border-b border-gray-700 shrink-0">
          <span className="font-medium text-gray-300">Click</span> a cell — AI will identify the label and value.
          <span className="font-medium text-gray-300"> Select text</span> to hint which part is the value.
        </div>
      )}

      {/* Sheet tab bar — only for xlsx workbooks with more than one sheet */}
      {format === 'xlsx' && sheets.length > 1 && (
        <div role="tablist" aria-label="Worksheet tabs" className="flex overflow-x-auto whitespace-nowrap border-b border-gray-700 shrink-0 bg-gray-900">
          {sheets.map(sheet => (
            <button
              role="tab"
              aria-selected={sheet.name === currentSheet}
              key={sheet.name}
              onClick={() => handleTabClick(sheet.name)}
              className={`px-4 py-2 text-xs border-t-2 transition-colors ${
                sheet.name === currentSheet
                  ? 'border-blue-500 text-white bg-gray-800'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Document viewer */}
      <div className="relative flex-1 overflow-hidden">
        <div
          data-testid="doc-viewer"
          ref={viewerRef}
          className={`h-full overflow-y-auto p-3 text-sm text-gray-200 leading-relaxed${format === 'xlsx' ? ' [&_table]:border-collapse [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-gray-600 [&_td]:px-2 [&_td]:py-1.5 [&_td[data-cell-address]]:cursor-pointer [&_td[data-cell-address]:hover]:bg-blue-900/25 [&_td[data-cell-address]:hover]:transition-colors' : ''}`}
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
                {format === 'xlsx' && (
                  <>
                    <label className="text-xs text-gray-400 block mb-1">
                      Label (preserved)
                    </label>
                    <input
                      value={popover.label ?? ''}
                      onChange={e => setPopover(prev => ({ ...prev, label: e.target.value, errorMsg: '' }))}
                      onKeyDown={e => { if (e.key === 'Escape') setPopover(null) }}
                      placeholder="e.g. Name: "
                      className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500 mb-2"
                    />
                  </>
                )}
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
                {format === 'xlsx' && (popover.label || popover.fieldName) && (
                  <p className="text-xs text-gray-500 mb-2 font-mono">
                    {popover.label ?? ''}<span className="text-blue-400">{`{{${popover.fieldName || '…'}}}`}</span>
                  </p>
                )}
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
