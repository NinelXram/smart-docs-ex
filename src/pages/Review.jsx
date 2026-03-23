import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { renderDocx } from '../lib/renderers/docx.js'
import { renderXlsx } from '../lib/renderers/xlsx.js'
import { insertDocx, insertXlsx } from '../lib/fieldEditor.js'
import { suggestFieldName, suggestFieldPattern } from '../lib/gemini.js'
import { saveTemplate } from '../lib/storage.js'
import { parseXlsxSheets } from '../lib/renderers/xlsxSheetParser.js'
import { useLanguage } from '../lib/i18n.jsx'

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

// Convert column letter(s) to 0-based index: A=0, B=1, ..., Z=25, AA=26, ...
function colLetterToIndex(col) {
  let index = 0
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 64)
  }
  return index - 1
}

// Convert 0-based index to column letter(s)
function indexToColLetter(index) {
  let col = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    col = String.fromCharCode(65 + rem) + col
    n = Math.floor((n - 1) / 26)
  }
  return col
}

const XLSX_CONTEXT_MAX_WORDS = 400
const XLSX_CONTEXT_RADIUS = 3  // rows and columns in each direction

function getXlsxContext(td) {
  const table = td.closest('table')
  if (!table) return ''
  const addr = td.dataset.cellAddress
  if (!addr) return ''
  const target = parseCellAddr(addr)
  if (!target) return ''

  const allCells = Array.from(table.querySelectorAll('td[data-cell-address]'))
  const cellMap = new Map(allCells.map(c => [c.dataset.cellAddress, c]))

  const targetRowNum = parseInt(target.row, 10)
  const targetColIdx = colLetterToIndex(target.col)

  const rowStart = Math.max(1, targetRowNum - XLSX_CONTEXT_RADIUS)
  const rowEnd = targetRowNum + XLSX_CONTEXT_RADIUS
  const colStart = Math.max(0, targetColIdx - XLSX_CONTEXT_RADIUS)
  const colEnd = targetColIdx + XLSX_CONTEXT_RADIUS

  const lines = []
  let wordCount = 0

  for (let r = rowStart; r <= rowEnd; r++) {
    const cells = []
    for (let c = colStart; c <= colEnd; c++) {
      const colLetter = indexToColLetter(c)
      const cellAddr = `${target.sheet}!${colLetter}${r}`
      const cell = cellMap.get(cellAddr)
      cells.push(cell ? cell.textContent.trim() : '')
    }
    const rowText = cells.join(' | ').replace(/(\| )+\|/g, '|').trim()
    if (!rowText.replace(/\|/g, '').trim()) continue  // skip empty rows
    const rowWords = rowText.split(/\s+/).filter(Boolean).length
    if (wordCount + rowWords > XLSX_CONTEXT_MAX_WORDS) break
    lines.push(rowText)
    wordCount += rowWords
  }

  return lines.join('\n')
}

export default function Review({ html: initialHtml, binary: initialBinary, format, fileName, fields: initialFields, apiKey, onSave, onBack }) {
  const { t, lang } = useLanguage()
  const viewerRef = useRef(null)
  const [html, setHtml] = useState(initialHtml)
  const [binary, setBinary] = useState(initialBinary)
  const [fields, setFields] = useState(initialFields)
  const [fieldDescriptions, setFieldDescriptions] = useState({})
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [popover, setPopover] = useState(null)
  // popover shape: { state: 'loading'|'ready', label: string, fieldName: string, description: string, errorMsg: string, position: {top, left} }
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
    setPopover({ state: 'loading', label: '', fieldName: '', description: '', errorMsg: '', position })
    try {
      if (format === 'xlsx') {
        const { fullCellText } = pendingData
        const result = await suggestFieldPattern(apiKey, fullCellText, selectedText, fields, surroundingContext, lang)
        setPopover(prev => prev ? { ...prev, state: 'ready', label: result.label, fieldName: result.fieldName, description: result.description ?? '' } : null)
      } else {
        const suggested = await suggestFieldName(apiKey, selectedText, surroundingContext, fields, lang)
        setPopover(prev => prev ? { ...prev, state: 'ready', label: '', fieldName: suggested?.fieldName ?? '', description: suggested?.description ?? '' } : null)
      }
    } catch {
      setPopover(prev => prev
        ? { ...prev, state: 'ready', label: '', fieldName: '', description: '', errorMsg: t('review.errorAiFailed') }
        : null)
    }
  }, [apiKey, fields, format, lang, t])

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
        setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: t('review.errorSingleParagraph'), position: { top: 80, left: 50 } })
        return
      }

      const allParas = Array.from(viewerRef.current.querySelectorAll('p'))
      const paragraphIndex = allParas.indexOf(anchorPara)

      // Build context from surrounding complete paragraphs, capped at 400 words
      const DOCX_CONTEXT_MAX_WORDS = 400
      const targetParaText = anchorPara.textContent.trim()
      let wordCount = targetParaText.split(/\s+/).filter(Boolean).length
      const beforeParas = []
      const afterParas = []
      for (
        let bi = paragraphIndex - 1, ai = paragraphIndex + 1;
        wordCount < DOCX_CONTEXT_MAX_WORDS && (bi >= 0 || ai < allParas.length);
        bi--, ai++
      ) {
        if (bi >= 0) {
          const text = allParas[bi].textContent.trim()
          if (text) {
            const w = text.split(/\s+/).filter(Boolean).length
            if (wordCount + w <= DOCX_CONTEXT_MAX_WORDS) { beforeParas.unshift(text); wordCount += w }
          }
        }
        if (ai < allParas.length && wordCount < DOCX_CONTEXT_MAX_WORDS) {
          const text = allParas[ai].textContent.trim()
          if (text) {
            const w = text.split(/\s+/).filter(Boolean).length
            if (wordCount + w <= DOCX_CONTEXT_MAX_WORDS) { afterParas.push(text); wordCount += w }
          }
        }
      }
      const surroundingContext = [...beforeParas, targetParaText, ...afterParas].join(' ')

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
  }, [format, openSuggestion, t])

  const handleClick = useCallback(async e => {
    if (format !== 'xlsx') return
    const td = e.target.closest('td[data-cell-address]')
    if (!td) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return

    const cellAddress = td.dataset.cellAddress
    const fullCellText = td.textContent.trim()

    if (/^\{\{.+\}\}$/.test(fullCellText)) {
      setPopover({ state: 'ready', label: '', fieldName: '', errorMsg: t('review.errorAlreadyField'), position: { top: 80, left: 50 } })
      return
    }

    const surroundingContext = getXlsxContext(td)
    const rect = td.getBoundingClientRect()
    await openSuggestion('', surroundingContext, { cellAddress, fullCellText }, { top: rect.bottom + 8, left: rect.left })
  }, [format, openSuggestion, t])

  const handleTabClick = useCallback((name) => {
    tabSwitchRef.current = true  // mark as tab switch so effect resets scroll
    setCurrentSheet(name)
  }, [])

  const handleAccept = async () => {
    const fieldName = popover.fieldName.trim()
    if (!fieldName) {
      setPopover(prev => ({ ...prev, errorMsg: t('review.errorFieldRequired') }))
      return
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: t('review.errorFieldFormat') }))
      return
    }
    if (fields.includes(fieldName)) {
      setPopover(prev => ({ ...prev, errorMsg: t('review.errorFieldDuplicate') }))
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
        setPopover(prev => ({ ...prev, errorMsg: t('review.errorInsertFailed') }))
        return
      }

      const newBinary = result.binary
      setBinary(newBinary)
      setFields(prev => [...prev, fieldName])
      if (popover.description?.trim()) {
        setFieldDescriptions(prev => ({ ...prev, [fieldName]: popover.description.trim() }))
      }

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
      setSaveError(t('review.errorNoName'))
      return
    }
    if (fields.length === 0) {
      setSaveError(t('review.errorNoFields'))
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
        fieldDescriptions,
        createdAt: Date.now(),
      })
      onSave()
    } catch (err) {
      setSaveError(`${t('review.errorSaveFailed')} ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="p-3 border-b border-gray-200 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 rounded border border-gray-300"
        >
          {t('review.back')}
        </button>
        <span className="text-xs text-gray-500">{fields.length} {t(fields.length === 1 ? 'review.fields' : 'review.fields_plural')}</span>
        <input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          placeholder={t('review.templatePlaceholder')}
          className="flex-1 bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded"
        >
          {saving ? t('review.saving') : t('review.save')}
        </button>
      </div>

      {saveError && (
        <p className="text-xs text-red-400 text-center px-3 py-1">{saveError}</p>
      )}

      {format === 'xlsx' && (
        <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-200 shrink-0">
          {t('review.xlsxHint')}
        </div>
      )}

      {/* Sheet tab bar — only for xlsx workbooks with more than one sheet */}
      {format === 'xlsx' && sheets.length > 1 && (
        <div role="tablist" aria-label={t('review.ariaTablist')} className="flex overflow-x-auto whitespace-nowrap border-b border-gray-200 shrink-0 bg-gray-50">
          {sheets.map(sheet => (
            <button
              role="tab"
              aria-selected={sheet.name === currentSheet}
              key={sheet.name}
              onClick={() => handleTabClick(sheet.name)}
              className={`px-4 py-2 text-xs border-t-2 transition-colors ${
                sheet.name === currentSheet
                  ? 'border-blue-500 text-gray-900 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
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
          className={`h-full overflow-y-auto p-3 text-sm text-gray-800 leading-relaxed${format === 'xlsx' ? ' [&_table]:border-collapse [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1.5 [&_td[data-cell-address]]:cursor-pointer [&_td[data-cell-address]:hover]:bg-blue-50 [&_td[data-cell-address]:hover]:transition-colors' : ''}`}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        />

        {/* Spinner overlay during field insertion */}
        {processing && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Suggestion popover */}
        {popover && (
          <div
            role="dialog"
            aria-label={t('review.ariaPopover')}
            className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-64"
            style={{ top: popover.position.top, left: Math.min(popover.position.left, 120) }}
          >
            {popover.state === 'loading' ? (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                {t('review.analyzing')}
              </div>
            ) : (
              <>
                {format === 'xlsx' && (
                  <>
                    <label className="text-xs text-gray-500 block mb-1">
                      {t('review.labelPreserved')}
                    </label>
                    <input
                      value={popover.label ?? ''}
                      onChange={e => setPopover(prev => ({ ...prev, label: e.target.value, errorMsg: '' }))}
                      onKeyDown={e => { if (e.key === 'Escape') setPopover(null) }}
                      placeholder="e.g. Name: "
                      className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-blue-500 mb-2"
                    />
                  </>
                )}
                <label htmlFor="field-name-input" className="text-xs text-gray-500 block mb-1">
                  {t('review.fieldName')}
                </label>
                <input
                  id="field-name-input"
                  autoFocus
                  value={popover.fieldName}
                  onChange={e => setPopover(prev => ({ ...prev, fieldName: e.target.value, errorMsg: '' }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleAccept(); if (e.key === 'Escape') setPopover(null) }}
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-blue-500 mb-2"
                />
                <label htmlFor="field-description-input" className="text-xs text-gray-500 block mb-1">
                  {t('review.description')} <span className="text-gray-400">{t('review.descriptionHint')}</span>
                </label>
                <input
                  id="field-description-input"
                  value={popover.description ?? ''}
                  onChange={e => {
                    const words = e.target.value.trim().split(/\s+/).filter(Boolean)
                    if (words.length <= 10 || e.target.value.length < (popover.description ?? '').length) {
                      setPopover(prev => ({ ...prev, description: e.target.value }))
                    }
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAccept(); if (e.key === 'Escape') setPopover(null) }}
                  placeholder={t('review.descriptionPlaceholder')}
                  className="w-full bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 focus:outline-none focus:border-blue-500 mb-2"
                />
                {format === 'xlsx' && (popover.label || popover.fieldName) && (
                  <p className="text-xs text-gray-400 mb-2 font-mono">
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
                    {t('review.accept')}
                  </button>
                  <button
                    onClick={() => setPopover(null)}
                    className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1"
                  >
                    {t('review.dismiss')}
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
