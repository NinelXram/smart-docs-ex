import { useMemo } from 'react'

const QUOTES = [
  'Lao động là vinh quang',
  'Có áp lực thì mới có kim cương',
  'Cho tôi một công việc, tôi sẽ cống hiến hết mình cho công ty',
  'Lương thấp cũng được, việc nặng cũng được, tối nhậu là được',
  'Lỡ cả đời không rực rỡ thì sao',
]

export default function WelcomeOverlay({ onClose }) {
  const quote = useMemo(() => QUOTES[Math.floor(Math.random() * QUOTES.length)], [])

  return (
    <div
      data-testid="welcome-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    >
      <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* top accent bar */}
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

        <div className="px-6 py-7 text-center">
          {/* title */}
          <div className="text-3xl font-extrabold tracking-tight text-gray-900 leading-none">
            AI GÁNH
          </div>
          <div className="mt-0.5 text-xs font-medium text-gray-400 tracking-widest uppercase">
            ây ai gánh
          </div>

          {/* subtitle */}
          <p className="mt-4 text-sm text-gray-600 leading-relaxed">
            Công cụ hỗ trợ tạo template docx, excel và nhập liệu tự động cho chị em văn phòng.
          </p>

          {/* quote */}
          <div className="mt-5 rounded-xl bg-indigo-50 px-4 py-3">
            <span className="text-sm italic text-indigo-700 font-medium">{quote}</span>
          </div>

          {/* close button */}
          <button
            data-testid="welcome-ok"
            onClick={onClose}
            className="mt-6 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 transition-all"
          >
            OK, bắt đầu thôi!
          </button>
        </div>
      </div>
    </div>
  )
}
