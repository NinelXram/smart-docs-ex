# Field Customization & Status Control — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

Allow users to persistently customize template fields: rename how a field is displayed (display alias), edit its description, and toggle it enabled/disabled. Changes are saved back to the template metadata. Disabled fields are replaced with an empty string at generation time.

## Data Model

Three optional keys added to template metadata (`.meta.json` in OPFS):

```js
{
  // existing
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

## Navigation & Routing

`App.jsx` adds a parallel state `editingTemplate` (null or a template object). When non-null, `<EditTemplate>` is rendered instead of the current wizard step. This avoids renumbering existing steps 0–4.

```js
const [editingTemplate, setEditingTemplate] = useState(null)
```

`Library.jsx` adds a pencil `✎` button per template card, alongside the existing delete `×` button. It calls `onEdit(tpl)` which sets `editingTemplate` in App.

`EditTemplate` props:
- `template` — full template object
- `onBack()` — clears `editingTemplate`, returns to Library
- `onSave(updatedTemplate)` — App persists via `saveTemplate()` and updates in-memory list
- `onToast`

## EditTemplate Component (`src/pages/EditTemplate.jsx`)

**Header:**
```
[ ← Back ]   Edit: {template.name}   [ Save ]
```
Save is disabled until at least one change is made.

**Field list** (one card per field, scrollable):
```
┌──────────────────────────────────────────┐
│ [toggle]                                 │
│ Display name: [ clientName           ]   │
│ Description:  [ Client full name     ]   │
│ Token: {{clientName}}  (read-only)       │
└──────────────────────────────────────────┘
```

- **Toggle** — checkbox or pill switch. Disabled fields dim the entire card.
- **Display name** — any non-empty string (free-form label, not a token). Defaults to original field name.
- **Description** — same 10-word cap as Review step. Optional.
- **Token** — read-only, shows `{{originalName}}` for context.

## Generate Step Changes (`src/pages/Generate.jsx`)

1. **Field label** — renders `template.fieldAliases?.[name] ?? name` instead of raw `name`.
2. **Disabled fields** — rendered in the list but visually dimmed (strikethrough label); value forced to `''` at generation time:

```js
const fieldValues = Object.fromEntries(
  template.fields.map(f => [
    f,
    (template.fieldEnabled?.[f] ?? true) ? (values[f] ?? '') : ''
  ])
)
```

3. **AI Analyze** — `analyzeSource` is called only with enabled fields:

```js
const enabledFields = template.fields.filter(f => template.fieldEnabled?.[f] ?? true)
const matched = await analyzeSource(apiKey, file, enabledFields, lang, ...)
```

## Storage

No schema migration needed — new keys are optional and default gracefully. `saveTemplate()` in `storage.js` is unchanged; it writes whatever metadata object is passed.

## Out of Scope

- Reordering fields
- Deleting fields (existing delete-template covers removal at template level)
- Renaming the underlying `{{token}}` in the binary
