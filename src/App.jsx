import { useState, useEffect } from 'react'
import { getApiKey, checkOpfsAvailable, getLang, saveLang, getTemplates } from './lib/storage.js'
import { LanguageProvider, makeT } from './lib/i18n.jsx'
import ProgressBar from './components/ProgressBar.jsx'
import Toast from './components/Toast.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Upload from './pages/Upload.jsx'
import Review from './pages/Review.jsx'
import Library from './pages/Library.jsx'
import Generate from './pages/Generate.jsx'
import EditTemplate from './pages/EditTemplate.jsx'

export default function App() {
  const [step, setStep] = useState(null)
  const [apiKey, setApiKey] = useState(null)
  const [scanData, setScanData] = useState(null)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [toast, setToast] = useState(null)
  const [opfsError, setOpfsError] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [lang, setLang] = useState('vi')

  useEffect(() => {
    Promise.all([getApiKey(), getLang(), getTemplates()])
      .then(([key, savedLang, templates]) => {
        setApiKey(key)
        setLang(savedLang)
        if (!key) {
          setStep(0)
        } else if (templates.length > 0) {
          setStep(3)
        } else {
          setStep(1)
        }
      })
      .catch(() => setStep(0))
  }, [])

  useEffect(() => {
    checkOpfsAvailable().catch(() => setOpfsError(true))
  }, [])

  const handleLangToggle = async () => {
    const prev = lang
    const next = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    try {
      await saveLang(next)
    } catch {
      setLang(prev)
      setToast({ message: makeT(prev)('app.langSaveError'), type: 'error' })
    }
  }

  if (opfsError) {
    return (
      <div
        data-testid="opfs-error"
        className="flex items-center justify-center h-screen bg-white text-gray-900 text-sm"
      >
        {makeT(lang)('app.opfsError')}
      </div>
    )
  }

  if (step === null) {
    return (
      <div
        data-testid="loading"
        className="flex items-center justify-center h-screen bg-white text-gray-900 text-sm"
      >
        {makeT(lang)('app.loading')}
      </div>
    )
  }

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
          <footer className="shrink-0 border-t border-gray-100 py-1.5 text-center text-[10px] text-gray-400">
            Created by{' '}
            <a
              href="https://huynhquocbao.web.app"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-600 underline transition-colors"
            >
              Huynh Quoc Bao
            </a>
            {' · '}
            <a
              href="mailto:esdridz@gmail.com"
              className="hover:text-gray-600 underline transition-colors"
            >
              esdridz@gmail.com
            </a>
          </footer>
        </div>
      </LanguageProvider>
    )
  }

  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <div className="flex flex-col h-screen bg-white text-gray-900 text-sm">
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
            <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 shrink-0">
              <span className="font-semibold">AI GÁNH (ây ai gánh)</span>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={() => setStep(0)}
                >
                  {makeT(lang)('app.changeApiKey')}
                </button>
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={() => setStep(3)}
                >
                  {makeT(lang)('app.library')}
                </button>
                <button
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                  onClick={handleLangToggle}
                >
                  {lang === 'vi' ? 'EN' : 'VI'}
                </button>
              </div>
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
                  onEdit={tpl => setEditingTemplate(tpl)}
                  onNew={() => setStep(1)}
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
        <footer className="shrink-0 border-t border-gray-100 py-1.5 text-center text-[10px] text-gray-400">
          Created by{' '}
          <a
            href="https://huynhquocbao.web.app"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 underline transition-colors"
          >
            Huynh Quoc Bao
          </a>
          {' · '}
          <a
            href="mailto:esdridz@gmail.com"
            className="hover:text-gray-600 underline transition-colors"
          >
            esdridz@gmail.com
          </a>
        </footer>
      </div>
    </LanguageProvider>
  )
}
