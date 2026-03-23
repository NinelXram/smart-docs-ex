import { useEffect } from 'react'
import { useLanguage } from '../lib/i18n.jsx'

const BG = {
  error: 'bg-red-700',
  warning: 'bg-yellow-700',
  info: 'bg-blue-700',
}

export default function Toast({ message, type = 'info', onDismiss }) {
  const { t } = useLanguage()

  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      data-testid="toast"
      className={`fixed top-2 left-2 right-2 z-50 flex items-center justify-between gap-2 px-3 py-2 rounded text-white text-xs shadow-lg ${BG[type] ?? BG.info}`}
    >
      <span>{message}</span>
      <button onClick={onDismiss} aria-label={t('toast.ariaDismiss')} className="shrink-0 opacity-80 hover:opacity-100">
        ✕
      </button>
    </div>
  )
}
