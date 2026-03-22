import { useState, useEffect } from 'react'
import { getApiKey } from './lib/storage.js'
import ProgressBar from './components/ProgressBar.jsx'
import Toast from './components/Toast.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Upload from './pages/Upload.jsx'
import Review from './pages/Review.jsx'
import Library from './pages/Library.jsx'
import Generate from './pages/Generate.jsx'

export default function App() {
  const [step, setStep] = useState(null)
  const [apiKey, setApiKey] = useState(null)
  const [scanData, setScanData] = useState(null)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    getApiKey()
      .then(key => {
        setApiKey(key)
        setStep(key ? 1 : 0)
      })
      .catch(() => setStep(0))
  }, [])

  if (step === null) {
    return (
      <div
        data-testid="loading"
        className="flex items-center justify-center h-screen bg-gray-900 text-white text-sm"
      >
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white text-sm">
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}
      {step === 0 && (
        <Onboarding
          onSuccess={key => {
            setApiKey(key)
            setStep(1)
          }}
        />
      )}
      {step > 0 && (
        <>
          <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 shrink-0">
            <span className="font-semibold">Doc Template Agent</span>
            <button
              className="text-xs text-gray-400 hover:text-white transition-colors"
              onClick={() => setStep(3)}
            >
              Library
            </button>
          </header>
          <ProgressBar step={step} />
          <div className="flex-1 overflow-auto">
            {step === 1 && (
              <Upload
                onScan={data => {
                  setScanData(data)
                  setStep(2)
                }}
                onToast={setToast}
              />
            )}
            {step === 2 && scanData && (
              <Review
                html={scanData.html}
                binary={scanData.binary}
                format={scanData.format}
                fileName={scanData.fileName}
                fields={scanData.fields}
                apiKey={apiKey}
                onSave={() => setStep(3)}
                onBack={() => setStep(1)}
              />
            )}
            {step === 3 && (
              <Library
                onSelect={tpl => {
                  setSelectedTemplate(tpl)
                  setStep(4)
                }}
                onToast={setToast}
              />
            )}
            {step === 4 && (
              <Generate
                template={selectedTemplate}
                onBack={() => setStep(3)}
                onToast={setToast}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}
