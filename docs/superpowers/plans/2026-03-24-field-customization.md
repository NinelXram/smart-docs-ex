# Field Customization & Status Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Edit Template" view (accessible from Library) that lets users rename fields (display alias), edit descriptions, and toggle fields enabled/disabled; disabled fields are replaced with `''` at generation time.

**Architecture:** A new `EditTemplate.jsx` page renders when `App.jsx`'s `editingTemplate` state is non-null, suppressing the normal wizard. `EditTemplate` calls `saveTemplateMeta()` directly on save; `onSave()` is a no-argument callback that signals App to clear the page. A new `saveTemplateMeta()` in `storage.js` writes only the metadata file without touching the binary. `Generate.jsx` reads `fieldAliases` and `fieldEnabled` from the template at render/generate time.

**Tech Stack:** React 18, Vitest + React Testing Library, Tailwind CSS, Chrome Extension OPFS storage (Origin Private File System).

**Spec:** `docs/superpowers/specs/2026-03-24-field-customization-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/lib/storage.js` | Add `saveTemplateMeta()` — metadata-only write |
| Modify | `src/locales/en.json` | Add `editTemplate` namespace + `library.ariaEdit` |
| Modify | `src/locales/vi.json` | Same additions in Vietnamese |
| Create | `src/pages/EditTemplate.jsx` | New field-edit page component |
| Modify | `src/pages/Library.jsx` | Add pencil button + `onEdit` prop |
| Modify | `src/pages/Generate.jsx` | Use aliases/enabled flags for labels, placeholders, generation, AI analyze |
| Modify | `src/App.jsx` | Add `editingTemplate` state + conditional render after null-step guard |
| Modify | `src/test/lib/storage.test.js` | Tests for `saveTemplateMeta` |
| Create | `src/test/pages/EditTemplate.test.jsx` | Tests for EditTemplate component |
| Modify | `src/test/pages/Library.test.jsx` | Tests for pencil button + `onEdit` |
| Modify | `src/test/pages/Generate.test.jsx` | Tests for alias labels, disabled fields, analyze filter |

---

## Task 1: `saveTemplateMeta` in storage

**Files:**
- Modify: `src/lib/storage.js`
- Modify: `src/test/lib/storage.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/test/lib/storage.test.js` after the existing `deleteTemplate` describe block.

Also update the import at the top to add `saveTemplateMeta`:

```js
import {
  saveApiKey, getApiKey, checkOpfsAvailable,
  saveTemplate, saveTemplateMeta,
  getTemplates, getTemplateBinary, deleteTemplate,
  migrateFromChromeStorage, getLang, saveLang,
} from '../../lib/storage.js'
```

Then add the new describe block:

```js
describe('saveTemplateMeta', () => {
  it('updates metadata without touching the binary', async () => {
    // Arrange: full template saved with binary
    await saveTemplate({ ...META, binary: makeBuffer([1, 2, 3]) })

    // Act: caller passes full metadata snapshot with new keys merged in
    // (saveTemplateMeta trusts the caller to pass all required keys)
    await saveTemplateMeta({ ...META, fieldAliases: { ClientName: 'Client' } })

    // Assert: metadata updated
    const list = await getTemplates()
    expect(list[0].fieldAliases).toEqual({ ClientName: 'Client' })

    // Assert: binary still intact
    const bin = await getTemplateBinary(META.id)
    expect(new Uint8Array(bin)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('does not duplicate the template in the index', async () => {
    await saveTemplate({ ...META, binary: makeBuffer() })
    await saveTemplateMeta({ ...META, fieldEnabled: { ClientName: false } })
    expect(await getTemplates()).toHaveLength(1)
  })

  it('writes all metadata keys the caller passes', async () => {
    // Note: preserving keys is the caller's responsibility (spread template before passing).
    // This test verifies the function writes exactly what it receives.
    await saveTemplate({ ...META, binary: makeBuffer(), fieldDescriptions: { ClientName: 'A client' } })
    await saveTemplateMeta({
      ...META,
      fieldDescriptions: { ClientName: 'A client' },
      fieldAliases: { ClientName: 'Client Name' },
    })
    const list = await getTemplates()
    expect(list[0].fieldDescriptions).toEqual({ ClientName: 'A client' })
    expect(list[0].fieldAliases).toEqual({ ClientName: 'Client Name' })
    expect(list[0].name).toBe(META.name)
  })

  it('adds id to index when called for a new id (not previously saved)', async () => {
    // saveTemplateMeta can be called even if no binary exists yet (edge case)
    await saveTemplateMeta({ ...META, id: 'brand-new' })
    const list = await getTemplates()
    expect(list.some(t => t.id === 'brand-new')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: 4 failures — `saveTemplateMeta is not a function`

- [ ] **Step 3: Implement `saveTemplateMeta` in `src/lib/storage.js`**

Add after the `saveTemplate` export (around line 81):

```js
export async function saveTemplateMeta(meta) {
  const dir = await getTemplatesDir()
  await writeJson(dir, `${meta.id}.meta.json`, meta)
  const ids = await readIndex(dir)
  if (!ids.includes(meta.id)) {
    ids.push(meta.id)
    await writeIndex(dir, ids)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/lib/storage.test.js
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.js src/test/lib/storage.test.js
git commit -m "feat: add saveTemplateMeta for metadata-only template updates"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `src/locales/en.json`
- Modify: `src/locales/vi.json`

No tests needed — i18n keys are verified implicitly by component tests. **This task must be completed before Task 3 tests are written**, because `EditTemplate` tests rely on the resolved key text (e.g. "← Back", "Save") matching button name queries.

- [ ] **Step 1: Add keys to `src/locales/en.json`**

Add `ariaEdit` to the `library` object:
```json
"ariaDelete": "delete template",
"ariaEdit": "Edit template"
```

Add new `editTemplate` namespace (before the closing `}` of the file):
```json
"editTemplate": {
  "back": "← Back",
  "save": "Save",
  "saving": "Saving…",
  "saved": "Template updated",
  "title": "Edit",
  "toggle": "Enable field",
  "displayName": "Display name",
  "description": "Description",
  "token": "Token",
  "errorNameEmpty": "Display name cannot be empty",
  "errorSaveFailed": "Save failed:"
}
```

- [ ] **Step 2: Add keys to `src/locales/vi.json`**

Add `ariaEdit` to the `library` object:
```json
"ariaDelete": "xóa mẫu",
"ariaEdit": "Chỉnh sửa mẫu"
```

Add new `editTemplate` namespace:
```json
"editTemplate": {
  "back": "← Quay lại",
  "save": "Lưu",
  "saving": "Đang lưu…",
  "saved": "Đã cập nhật mẫu",
  "title": "Chỉnh sửa",
  "toggle": "Bật trường",
  "displayName": "Tên hiển thị",
  "description": "Mô tả",
  "token": "Token",
  "errorNameEmpty": "Tên hiển thị không được để trống",
  "errorSaveFailed": "Lưu thất bại:"
}
```

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json src/locales/vi.json
git commit -m "feat: add editTemplate and library.ariaEdit i18n keys"
```

---

## Task 3: `EditTemplate` component

**Files:**
- Create: `src/pages/EditTemplate.jsx`
- Create: `src/test/pages/EditTemplate.test.jsx`

### How `EditTemplate` works
- Receives `template` (metadata object, no binary), `onBack`, `onSave`, `onToast`
- Local state mirrors `template.fieldAliases`, `template.fieldEnabled`, `template.fieldDescriptions`
- Dirty = any value differs from the initial template values at mount time
- On save: validates all display names non-empty after trim → calls `saveTemplateMeta(updatedMeta)` directly → on success shows toast and calls `onSave()` (no args)
- `onSave()` takes no arguments — App clears `editingTemplate` when called
- Description reuses `t('review.descriptionPlaceholder')` from the existing locale key (intentional cross-namespace reuse to avoid duplication)

- [ ] **Step 1: Write the failing tests**

Create `src/test/pages/EditTemplate.test.jsx`:

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { LanguageProvider } from '../../lib/i18n.jsx'

vi.mock('../../lib/storage.js', () => ({
  saveTemplateMeta: vi.fn(),
}))

import EditTemplate from '../../pages/EditTemplate.jsx'
import * as storage from '../../lib/storage.js'

// Wrap renders in LanguageProvider so i18n keys resolve to their English text
function renderWithLang(ui) {
  return render(
    <LanguageProvider lang="en" setLang={vi.fn()}>
      {ui}
    </LanguageProvider>
  )
}

const TEMPLATE = {
  id: 'id-1',
  name: 'Sales Contract',
  sourceFormat: 'docx',
  fields: ['ClientName', 'Date'],
  fieldDescriptions: { ClientName: 'Full client name' },
  fieldAliases: {},
  fieldEnabled: {},
  createdAt: 1000000000000,
}

beforeEach(() => vi.clearAllMocks())

describe('EditTemplate', () => {
  it('renders a card for each field', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByDisplayValue('ClientName')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Date')).toBeInTheDocument()
  })

  it('shows original token as read-only label', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByText('{{ClientName}}')).toBeInTheDocument()
    expect(screen.getByText('{{Date}}')).toBeInTheDocument()
  })

  it('Save button is disabled initially', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after changing a display name', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('Save button re-disables when change is reverted', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.change(screen.getByDisplayValue('Client Name'), { target: { value: 'ClientName' } })
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button enables after toggling a field off', () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('shows inline error and does not call saveTemplateMeta when display name is empty', async () => {
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/display name cannot be empty/i)).toBeInTheDocument()
    )
    expect(storage.saveTemplateMeta).not.toHaveBeenCalled()
  })

  it('calls saveTemplateMeta and onSave with correct updatedMeta on success', async () => {
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    const onSave = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={onSave} onToast={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'id-1',
        fieldAliases: { ClientName: 'Client Name' },
        fields: ['ClientName', 'Date'],
        createdAt: 1000000000000,
      })
    ))
    expect(onSave).toHaveBeenCalled()
  })

  it('alias reverted to token name is omitted from fieldAliases', async () => {
    // Arrange: template has a pre-existing alias
    const tplWithAlias = { ...TEMPLATE, fieldAliases: { ClientName: 'Old Alias' } }
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    renderWithLang(<EditTemplate template={tplWithAlias} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    // User clears the alias back to the original token name
    fireEvent.change(screen.getByDisplayValue('Old Alias'), { target: { value: 'ClientName' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({ fieldAliases: {} })
    ))
  })

  it('shows toast and does not call onSave when saveTemplateMeta throws', async () => {
    storage.saveTemplateMeta.mockRejectedValue(new Error('write error'))
    const onSave = vi.fn()
    const onToast = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={onSave} onToast={onToast} />)
    fireEvent.change(screen.getByDisplayValue('ClientName'), { target: { value: 'Client Name' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn()
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={onBack} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalled()
  })

  it('field checkbox is unchecked when fieldEnabled is false', () => {
    const tpl = { ...TEMPLATE, fieldEnabled: { ClientName: false } }
    renderWithLang(<EditTemplate template={tpl} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  })

  it('saves fieldEnabled as false for toggled-off field', async () => {
    storage.saveTemplateMeta.mockResolvedValue(undefined)
    renderWithLang(<EditTemplate template={TEMPLATE} onBack={vi.fn()} onSave={vi.fn()} onToast={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // toggle ClientName off
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(storage.saveTemplateMeta).toHaveBeenCalledWith(
      expect.objectContaining({ fieldEnabled: { ClientName: false } })
    ))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/pages/EditTemplate.test.jsx
```

Expected: failures — `EditTemplate` module not found

- [ ] **Step 3: Implement `src/pages/EditTemplate.jsx`**

```jsx
import { useState, useMemo } from 'react'
import { saveTemplateMeta } from '../lib/storage.js'
import { useLanguage } from '../lib/i18n.jsx'

export default function EditTemplate({ template, onBack, onSave, onToast }) {
  const { t } = useLanguage()

  // Local editable state — mirrors template metadata
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

  // Dirty check: compare current state against template values at mount time
  const isDirty = useMemo(() => {
    return template.fields.some(f => {
      const initAlias = template.fieldAliases?.[f] ?? f
      const initDesc = template.fieldDescriptions?.[f] ?? ''
      const initEnabled = template.fieldEnabled?.[f] ?? true
      return aliases[f] !== initAlias || descriptions[f] !== initDesc || enabled[f] !== initEnabled
    })
  }, [aliases, descriptions, enabled, template])

  const handleSave = async () => {
    // Validate: all display names must be non-empty after trim
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
      // Build updatedMeta: spread all existing template keys, then merge new customization keys.
      // Aliases equal to the original token name are omitted (no alias stored = falls back to token).
      // Descriptions that are empty are omitted. Disabled fields stored as false; enabled omitted.
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
      {/* Header */}
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

      {/* Field list */}
      <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
        {template.fields.map(f => {
          const isEnabled = enabled[f]
          return (
            <div
              key={f}
              className={`border border-gray-200 rounded-lg p-3 flex flex-col gap-2 transition-opacity ${isEnabled ? '' : 'opacity-50'}`}
            >
              {/* Toggle + token row */}
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

              {/* Display name */}
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

              {/* Description — reuses review.descriptionPlaceholder (intentional cross-namespace reuse) */}
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/pages/EditTemplate.test.jsx
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/pages/EditTemplate.jsx src/test/pages/EditTemplate.test.jsx
git commit -m "feat: add EditTemplate page for persistent field customization"
```

---

## Task 4: Update `Library` — pencil button

**Files:**
- Modify: `src/pages/Library.jsx`
- Modify: `src/test/pages/Library.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/test/pages/Library.test.jsx` inside the `describe('Library', ...)` block, after the last existing `it(...)`:

```js
it('renders an edit button per template', async () => {
  storage.getTemplates.mockResolvedValue(TEMPLATES)
  render(<Library onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onToast={vi.fn()} />)
  await waitFor(() => screen.getByText('Sales Contract'))
  expect(screen.getAllByRole('button', { name: /edit template/i })).toHaveLength(2)
})

it('calls onEdit with the template when pencil button is clicked', async () => {
  storage.getTemplates.mockResolvedValue(TEMPLATES)
  const onEdit = vi.fn()
  render(<Library onSelect={vi.fn()} onEdit={onEdit} onNew={vi.fn()} onToast={vi.fn()} />)
  await waitFor(() => screen.getByText('Sales Contract'))
  fireEvent.click(screen.getAllByRole('button', { name: /edit template/i })[0])
  expect(onEdit).toHaveBeenCalledWith(TEMPLATES[0])
})

it('pencil click does not trigger onSelect', async () => {
  storage.getTemplates.mockResolvedValue(TEMPLATES)
  const onSelect = vi.fn()
  render(<Library onSelect={onSelect} onEdit={vi.fn()} onNew={vi.fn()} onToast={vi.fn()} />)
  await waitFor(() => screen.getByText('Sales Contract'))
  fireEvent.click(screen.getAllByRole('button', { name: /edit template/i })[0])
  expect(onSelect).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/pages/Library.test.jsx
```

Expected: 3 new failures

- [ ] **Step 3: Update `src/pages/Library.jsx`**

Change the function signature to add `onEdit` with a safe default:

```js
export default function Library({ onSelect, onEdit = () => {}, onNew, onToast }) {
```

Add pencil button inside the template card, between the format badge and the delete `×` button:

```jsx
<button
  onClick={e => { e.stopPropagation(); onEdit(tpl) }}
  aria-label={t('library.ariaEdit')}
  className="text-gray-500 hover:text-blue-500 shrink-0 text-sm"
>
  ✎
</button>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/pages/Library.test.jsx
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/pages/Library.jsx src/test/pages/Library.test.jsx
git commit -m "feat: add edit button to Library template cards"
```

---

## Task 5: Update `Generate` — aliases, disabled fields, analyze filter

**Files:**
- Modify: `src/pages/Generate.jsx`
- Modify: `src/test/pages/Generate.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add after the closing `})` of the last existing `describe` block in `src/test/pages/Generate.test.jsx`:

```js
describe('Generate — fieldAliases', () => {
  const TEMPLATE_WITH_ALIAS = {
    ...TEMPLATE_DOCX,
    fieldAliases: { ClientName: 'Client Full Name' },
  }

  it('shows alias as field label when fieldAliases is set', async () => {
    render(<Generate template={TEMPLATE_WITH_ALIAS} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Client Full Name')).toBeInTheDocument())
    expect(screen.queryByLabelText('ClientName')).not.toBeInTheDocument()
  })

  it('falls back to original name when no alias', async () => {
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('ClientName')).toBeInTheDocument())
  })
})

describe('Generate — fieldEnabled', () => {
  const TEMPLATE_WITH_DISABLED = {
    ...TEMPLATE_DOCX,
    fieldEnabled: { ClientName: false },
  }

  it('disabled field input is disabled', async () => {
    render(<Generate template={TEMPLATE_WITH_DISABLED} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    expect(screen.getByLabelText('ClientName')).toBeDisabled()
    expect(screen.getByLabelText('EffectiveDate')).not.toBeDisabled()
  })

  it('forces disabled field value to "" in generateDocx call', async () => {
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    engine.saveFile.mockResolvedValue(undefined)
    render(<Generate template={TEMPLATE_WITH_DISABLED} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(engine.generateDocx).toHaveBeenCalledWith(
        FAKE_BUFFER,
        { ClientName: '', EffectiveDate: '' }
      )
    )
  })

  it('all fields enabled when fieldEnabled is absent (no regression)', async () => {
    // TEMPLATE_DOCX has no fieldEnabled key — all fields should be passed normally
    engine.generateDocx.mockResolvedValue(new Blob(['docx']))
    engine.saveFile.mockResolvedValue(undefined)
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('ClientName'), { target: { value: 'Acme' } })
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    await waitFor(() =>
      expect(engine.generateDocx).toHaveBeenCalledWith(
        FAKE_BUFFER,
        { ClientName: 'Acme', EffectiveDate: '' }
      )
    )
  })

  it('analyzeSource is called only with enabled fields', async () => {
    gemini.analyzeSource.mockResolvedValue({ EffectiveDate: '2026-01-01' })
    render(<Generate template={TEMPLATE_WITH_DISABLED} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('analyze-file-input'), { target: { files: [file] } })

    await waitFor(() =>
      expect(gemini.analyzeSource).toHaveBeenCalledWith(
        'fake-api-key',
        file,
        ['EffectiveDate'],
        expect.any(String),
        expect.anything()
      )
    )
  })

  it('analyzeSource receives all fields when fieldEnabled is absent', async () => {
    gemini.analyzeSource.mockResolvedValue({})
    render(<Generate template={TEMPLATE_DOCX} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('analyze-file-input'), { target: { files: [file] } })

    await waitFor(() =>
      expect(gemini.analyzeSource).toHaveBeenCalledWith(
        'fake-api-key',
        file,
        ['ClientName', 'EffectiveDate'],
        expect.any(String),
        expect.anything()
      )
    )
  })

  it('disabled field is not populated after analyze', async () => {
    gemini.analyzeSource.mockResolvedValue({ ClientName: 'Injected', EffectiveDate: '2026-01-01' })
    render(<Generate template={TEMPLATE_WITH_DISABLED} onBack={vi.fn()} onToast={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled())

    const file = new File(['content'], 'cv.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('analyze-file-input'), { target: { files: [file] } })

    await waitFor(() => expect(screen.getByLabelText('EffectiveDate')).toHaveValue('2026-01-01'))
    expect(screen.getByLabelText('ClientName')).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

Expected: new test failures

- [ ] **Step 3: Update `src/pages/Generate.jsx`**

In `handleAnalyze`, replace the `analyzeSource` call and the entire `setValues` update block:

```js
const enabledFields = template.fields.filter(f => template.fieldEnabled?.[f] ?? true)
const matched = await analyzeSource(apiKey, file, enabledFields, lang, template.fieldDescriptions ?? {})
setValues(prev => {
  const next = { ...prev }
  for (const [key, val] of Object.entries(matched)) {
    if (enabledFields.includes(key) && !prev[key]) next[key] = val
  }
  return next
})
```

In `handleGenerate`, replace the `fieldValues` computation:

```js
const fieldValues = Object.fromEntries(
  template.fields.map(f => [
    f,
    (template.fieldEnabled?.[f] ?? true) ? (values[f] ?? '') : ''
  ])
)
```

In the field render `template.fields.map(name => {...})`, replace the `return (...)` block entirely:

```jsx
const alias = template.fieldAliases?.[name] ?? name
const isEnabled = template.fieldEnabled?.[name] ?? true
const description = template.fieldDescriptions?.[name]
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
```

Note: remove the `const description = template.fieldDescriptions?.[name]` line that was already in the original `map` body — it is now included in the replacement block above.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/test/pages/Generate.test.jsx
```

Expected: all passing

- [ ] **Step 5: Commit**

```bash
git add src/pages/Generate.jsx src/test/pages/Generate.test.jsx
git commit -m "feat: use field aliases, disabled flags, and filtered analyze in Generate"
```

---

## Task 6: Wire `App.jsx`

**Files:**
- Modify: `src/App.jsx`

No dedicated unit test for App routing — verified by the full test run in Step 4.

- [ ] **Step 1: Add import and state**

Add to imports at top of `src/App.jsx` (no `saveTemplateMeta` import needed — saving is done in `EditTemplate`):

```js
import EditTemplate from './pages/EditTemplate.jsx'
```

Add state after `const [opfsError, setOpfsError] = useState(false)`:

```js
const [editingTemplate, setEditingTemplate] = useState(null)
```

- [ ] **Step 2: Add `editingTemplate` conditional after the `step === null` guard**

In `App.jsx`, after the `if (step === null) { return (...) }` block and before `return (`:

```jsx
if (editingTemplate) {
  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <div className="flex flex-col h-screen bg-white text-gray-900 text-sm">
        {toast && (
          <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
        )}
        <EditTemplate
          template={editingTemplate}
          onBack={() => setEditingTemplate(null)}
          onSave={() => setEditingTemplate(null)}
          onToast={setToast}
        />
      </div>
    </LanguageProvider>
  )
}
```

- [ ] **Step 3: Pass `onEdit` to `Library` in the step 3 render**

Change the `Library` render block:

```jsx
{step === 3 && (
  <Library
    onSelect={tpl => {
      setSelectedTemplate(tpl)
      setStep(4)
    }}
    onEdit={tpl => setEditingTemplate(tpl)}
    onNew={() => setStep(1)}
    onToast={setToast}
  />
)}
```

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: all passing, no regressions

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: wire EditTemplate into App with editingTemplate state"
```

---

## Final Verification

- [ ] **Run full test suite one last time**

```bash
npx vitest run
```

Expected: all passing, no regressions

- [ ] **Manual smoke test in Chrome**
  1. `npm run build`, load `dist/` as unpacked extension
  2. Upload a DOCX with multiple fields, save as a template
  3. In Library, click `✎` on the template → EditTemplate page appears (no ProgressBar)
  4. Rename a field display name, toggle one field off, click Save → toast "Template updated"
  5. Navigate back to Library → click the same template → Generate page
  6. Renamed field shows alias label; disabled field input is dimmed and `disabled`
  7. Click Download → verify disabled field is blank in the output document
  8. Re-open EditTemplate, revert alias to token name, save → alias removed
