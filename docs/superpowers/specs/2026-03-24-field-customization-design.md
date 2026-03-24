# Field Customization & Status Control — Design Spec

**Date:** 2026-03-24
**Status:** Draft

## Overview

Allow users to persistently customize template fields: rename how a field is displayed (display alias), edit its description, and toggle it enabled/disabled. Changes are saved back to the template metadata. Disabled fields are replaced with an empty string at generation time.

## Data Model

Three optional keys added to template metadata (`.meta.json` in OPFS):

```js
{
  // existing — all retained unchanged
  id, name, sourceFormat, fields, fieldDescriptions, createdAt,

  // new
  fieldAliases:  { [originalName]: string },   // display name override
  fieldEnabled:  { [originalName]: boolean },  // false = disabled; absent = true
}
```

- `fieldAliases` — maps original token name → UI display name. Falls back to original name if absent.
- `fieldEnabled` — maps original token name → boolean. Absent means enabled.
- `fieldDescriptions` — already exists; becomes editable via the new EditTemplate view.
- The `{{token}}` embedded in the document binary is **never mutated**. Rename is display-only (alias).

## Storage Layer

A new `saveTemplateMeta(meta)` function is added alongside `saveTemplate()` in `storage.js`. It writes only the `.meta.json` file and updates the index, **without touching the `.bin` binary file**:

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

`EditTemplate` calls `saveTemplateMeta(updatedMeta)` where `updatedMeta` is a **full copy of the existing metadata object** (all keys — `id`, `name`, `sourceFormat`, `fields`, `fieldDescriptions`, `createdAt` — retained) with `fieldAliases` and `fieldEnabled` merged in. No binary key is present. The existing `saveTemplate()` (which writes both binary and meta) remains unchanged for the Review save flow.

## Navigation & Routing

`App.jsx` adds a parallel state `editingTemplate` (null or a template metadata object). A **top-level conditional** at the beginning of the render checks `editingTemplate` first, and if set, renders only `<EditTemplate>` — suppressing both the ProgressBar and the wizard step render entirely:

```jsx
if (editingTemplate) {
  return <EditTemplate
    template={editingTemplate}
    onBack={() => setEditingTemplate(null)}
    onSave={handleEditSave}
    onToast={onToast}
  />
}
// ...rest of wizard render (ProgressBar + steps)
```

`Library.jsx` adds a pencil `✎` button per template card, alongside the existing delete `×` button. It calls `onEdit(tpl)` which sets `editingTemplate` in App.

Because `editingTemplate` replaces the entire page render, returning to Library unmounts and remounts the `Library` component, which re-fetches templates from OPFS via its existing `useEffect`. The Library list is always fresh after an edit — no prop-lifting required.

`EditTemplate` props:
- `template` — full template metadata object (no binary key)
- `onBack()` — clears `editingTemplate`, returns to Library
- `onSave(updatedMeta)` — App calls `saveTemplateMeta(updatedMeta)` then clears `editingTemplate` and shows a success toast
- `onToast`

## EditTemplate Component (`src/pages/EditTemplate.jsx`)

**Header:**
```
[ ← Back ]   Edit: {template.name}   [ Save ]
```

- Save button is disabled until the user makes at least one change. Dirty state is determined by comparing current field config against the initial values loaded from `template` at mount time. Reverting all fields back to their original values re-disables Save.
- Pressing Back with unsaved changes silently discards them (no confirmation dialog — consistent with the Back behavior in the existing Review and Generate steps).

**Field list** (one card per field, scrollable):
```
┌──────────────────────────────────────────┐
│ [✓ toggle]   {{originalName}}  (dimmed if disabled)
│ Display name: [ clientName           ]   │
│ Description:  [ Client full name     ]   │
└──────────────────────────────────────────┘
```

- **Toggle** — checkbox or pill switch. Disabling a field dims the entire card.
- **Display name** — free-form, non-empty string. Max length enforced via `maxLength="40"` HTML attribute (silent truncation, no separate error message). Leading/trailing whitespace trimmed before save. Validated on save: must be non-empty after trim (shows `editTemplate.errorNameEmpty` error inline).
- **Description** — same 10-word cap as Review step. Optional.
- **Original token** — shown as `{{originalName}}` in dimmed text for context; read-only.

## Generate Step Changes (`src/pages/Generate.jsx`)

The following are **required code changes** to the existing `Generate.jsx` (current behavior described, then desired behavior):

1. **Field label** — *current:* raw `name`. *New:* `template.fieldAliases?.[name] ?? name`.
2. **Field placeholder** — *current:* `"${t('generate.fieldPlaceholder')} ${name}…"`. *New:* uses the alias: `"${t('generate.fieldPlaceholder')} ${alias}…"`.
3. **Disabled fields** — rendered in the list but the card is visually dimmed, the label has a strikethrough, and the `<input>` is `disabled`. Value is forced to `''` at generation time:

```js
const fieldValues = Object.fromEntries(
  template.fields.map(f => [
    f,
    (template.fieldEnabled?.[f] ?? true) ? (values[f] ?? '') : ''
  ])
)
```

4. **AI Analyze** — *current:* `analyzeSource` receives `template.fields` (all fields). *New:* called only with enabled fields; disabled fields are also excluded from the post-merge `values` update:

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

## i18n Keys

New keys added to both `vi.json` and `en.json`:

Under `editTemplate` namespace:
```json
"editTemplate": {
  "back": "Back",
  "save": "Save",
  "saving": "Saving…",
  "saved": "Template updated",
  "title": "Edit",
  "toggle": "Enable field",
  "displayName": "Display name",
  "description": "Description",
  "token": "Token",
  "errorNameEmpty": "Display name cannot be empty"
}
```

Under existing `library` namespace (new key only):
```json
"library": {
  "ariaEdit": "Edit template"
}
```

## Out of Scope

- Reordering fields
- Deleting individual fields (existing delete-template covers removal at template level)
- Renaming the underlying `{{token}}` in the binary
- Confirmation dialog on Back with unsaved changes
