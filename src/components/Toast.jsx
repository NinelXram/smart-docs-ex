import { useEffect } from 'react'

const BG = {
  error: 'bg-red-700',
  warning: 'bg-yellow-700',
  info: 'bg-blue-700',
}

export default function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      data-testid="toast"
      className={`fixed top-2 left-2 right-2 z-50 flex items-center justify-between gap-2 px-3 py-2 rounded text-white text-xs shadow-lg ${BG[type] ?? BG.info}`}
    >
      <span>{message}</span>
      <button onClick={onDismiss} aria-label="dismiss toast" className="shrink-0 opacity-80 hover:opacity-100">
        ✕
      </button>
    </div>
  )
}
