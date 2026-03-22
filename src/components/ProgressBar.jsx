const STEPS = ['Upload', 'Review', 'Library', 'Generate']

export default function ProgressBar({ step }) {
  return (
    <div className="flex border-b border-gray-700 shrink-0">
      {STEPS.map((label, i) => {
        const num = i + 1
        const active = step === num
        const done = step > num
        return (
          <div
            key={label}
            data-testid={`step-${num}`}
            data-active={String(active)}
            data-done={String(done)}
            className={`flex-1 py-2 text-center text-xs font-medium border-b-2 transition-colors ${
              active
                ? 'border-blue-500 text-blue-400'
                : done
                ? 'border-green-500 text-green-400'
                : 'border-transparent text-gray-500'
            }`}
          >
            {done ? '✓ ' : ''}{label}
          </div>
        )
      })}
    </div>
  )
}
