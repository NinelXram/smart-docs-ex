import { useState } from 'react'

export default function VariableChip({ name, onRename, onRemove, color }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)

  const commit = () => {
    setEditing(false)
    if (value.trim() && value.trim() !== name) onRename(value.trim())
    else setValue(name)
  }

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white ${color}`}>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setValue(name); setEditing(false) }
          }}
          className="bg-transparent outline-none w-20 text-white"
        />
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white ${color}`}>
      <button onClick={() => setEditing(true)} className="hover:underline">
        {name}
      </button>
      <button
        onClick={onRemove}
        aria-label="remove variable"
        className="opacity-70 hover:opacity-100 leading-none"
      >
        ×
      </button>
    </span>
  )
}
