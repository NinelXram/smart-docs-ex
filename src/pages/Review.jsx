import { useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import VariableChip from '../components/VariableChip.jsx'
import { saveTemplate } from '../lib/storage.js'

const CHIP_COLORS = [
  'bg-blue-600', 'bg-green-600', 'bg-purple-600',
  'bg-orange-500', 'bg-pink-600', 'bg-teal-600',
]

function segmentContent(rawContent, variables) {
  // Markers contain [VALUE] as a literal token; rawContent has the real value in its place.
  // Convert each marker to a regex by escaping special chars then replacing \[VALUE\] with .+?
  const positions = variables
    .map(v => {
      const escaped = v.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = escaped.replace('\\[VALUE\\]', '.+?')
      const match = new RegExp(pattern).exec(rawContent)
      return match ? { start: match.index, end: match.index + match[0].length, variable: v } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)

  const segments = []
  let pos = 0
  for (const { start, end, variable } of positions) {
    if (start > pos) segments.push({ type: 'text', content: rawContent.slice(pos, start) })
    segments.push({ type: 'variable', variable })
    pos = end
  }
  if (pos < rawContent.length) segments.push({ type: 'text', content: rawContent.slice(pos) })
  return segments
}

export default function Review({ rawContent, format, initialVariables, onSave, onBack, onToast }) {
  const [variables, setVariables] = useState(initialVariables)
  const [templateName, setTemplateName] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingAdd, setPendingAdd] = useState(null) // { selectedText, marker }
  const [addLabel, setAddLabel] = useState('')

  const handleRename = (oldName, newName) => {
    setVariables(prev => prev.map(v => v.name === oldName ? { ...v, name: newName } : v))
  }

  const handleRemove = name => {
    setVariables(prev => prev.filter(v => v.name !== name))
  }

  const handleAddFromSelection = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      onToast({ message: 'Select text in the preview first', type: 'error' })
      return
    }
    const selectedText = sel.toString().trim()
    if (!selectedText) return
    const idx = rawContent.indexOf(selectedText)
    if (idx < 0) {
      onToast({ message: 'Selection not found in document text', type: 'error' })
      return
    }
    const before = rawContent.slice(0, idx)
    const after = rawContent.slice(idx + selectedText.length)
    const wordsBefore = before.trim().split(/\s+/).filter(Boolean).slice(-5).join(' ')
    const wordsAfter = after.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ')
    const parts = []
    if (wordsBefore) parts.push(wordsBefore)
    parts.push('[VALUE]')
    if (wordsAfter) parts.push(wordsAfter)
    setPendingAdd({ selectedText, marker: parts.join(' ') })
    setAddLabel('')
  }

  const handleConfirmAdd = () => {
    if (!addLabel.trim() || !pendingAdd) return
    setVariables(prev => [...prev, { name: addLabel.trim(), marker: pendingAdd.marker }])
    setPendingAdd(null)
    setAddLabel('')
  }

  const handleSave = async () => {
    if (!templateName.trim()) {
      onToast({ message: 'Please enter a template name', type: 'error' })
      return
    }
    setSaving(true)
    try {
      await saveTemplate({
        id: uuidv4(),
        name: templateName.trim(),
        sourceFormat: format,
        rawContent,
        variables,
        createdAt: Date.now(),
      })
      onSave()
    } catch (err) {
      onToast({ message: `Save failed: ${err.message}`, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const segments = segmentContent(rawContent, variables)

  return (
    <div className="flex flex-col h-full">
      {/* Header controls */}
      <div className="p-3 border-b border-gray-700 flex gap-2 items-center shrink-0">
        <button
          onClick={onBack}
          className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded border border-gray-600"
        >
          ← Back
        </button>
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

      {/* Document preview */}
      <div className="flex-1 overflow-auto p-3 text-xs leading-relaxed text-gray-300 whitespace-pre-wrap font-mono border-b border-gray-700">
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <span key={i}>{seg.content}</span>
          ) : (
            <VariableChip
              key={seg.variable.name + i}
              name={seg.variable.name}
              color={CHIP_COLORS[variables.indexOf(seg.variable) % CHIP_COLORS.length]}
              onRename={newName => handleRename(seg.variable.name, newName)}
              onRemove={() => handleRemove(seg.variable.name)}
            />
          )
        )}
      </div>

      {/* Variable list + add controls */}
      <div className="p-3 flex flex-col gap-2 shrink-0">
        {pendingAdd ? (
          <div className="flex gap-2 items-center">
            <input
              data-testid="add-label-input"
              autoFocus
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              placeholder="Variable label (e.g. ClientName)"
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmAdd(); if (e.key === 'Escape') setPendingAdd(null) }}
            />
            <button onClick={handleConfirmAdd} className="text-xs bg-blue-600 px-2 py-1 rounded text-white">Add</button>
            <button onClick={() => setPendingAdd(null)} className="text-xs text-gray-400">Cancel</button>
          </div>
        ) : (
          <button
            onClick={handleAddFromSelection}
            className="text-xs text-gray-400 hover:text-white self-start"
          >
            + Add from selection
          </button>
        )}
      </div>
    </div>
  )
}
