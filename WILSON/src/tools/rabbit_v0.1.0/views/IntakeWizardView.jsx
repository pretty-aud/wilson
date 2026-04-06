// ============================================================
// RABBIT — IntakeWizardView
// ============================================================
//
// Multi-step wizard that turns a pile of source documents into
// a structured project breakdown via runIngestion(). The flow:
//
//   upload → classify → core → run → review → save
//
// Commit 7 shipped steps 1-3 (upload / classify / core-definer)
// plus the scaffolding for step 4 (run). Commit 8 wires the
// IntakeProgress + IntakeReview UI and the acceptIngestion
// save path.
//
// State lives in the wizard itself, not the provider, because
// it's wizard-local and discardable on close. The exception is
// the *result* of a run — the moment the user clicks "Save to
// project", the breakdown is pushed into the bundle via
// `acceptIngestion(null, breakdown)` and the wizard resets.

import { useState } from 'react'
import { Sparkles, FolderPlus, AlertCircle } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { PERSONA_LIST } from '../intake/personas'
import IntakeUploader from './intake/IntakeUploader'
import IntakeClassifier from './intake/IntakeClassifier'
import IntakeCoreDefiner from './intake/IntakeCoreDefiner'
import IntakeProgress from './intake/IntakeProgress'
import IntakeReview from './intake/IntakeReview'

const STEPS = [
  { id: 'upload',   label: 'Upload'   },
  { id: 'classify', label: 'Classify' },
  { id: 'core',     label: 'Core'     },
  { id: 'run',      label: 'Run'      },
  { id: 'review',   label: 'Review'   },
]

function readApiKey() {
  try {
    return localStorage.getItem('wilson-api-key') || ''
  } catch {
    return ''
  }
}

export default function IntakeWizardView() {
  const ctx = useRabbit()
  const activeProjectId = ctx?.activeProjectId

  const [step, setStep] = useState('upload')
  const [files, setFiles] = useState([])
  const [enabledPersonas, setEnabledPersonas] = useState(
    PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id)
  )
  const [runResult, setRunResult] = useState(null)

  // No project yet → nudge user to create one before uploading.
  if (!activeProjectId) {
    return <NoProjectGate />
  }

  // No API key → block the run step entirely. We can still let
  // the user upload + classify; only the actual pipeline call
  // requires Anthropic.
  const apiKey = readApiKey()

  function resetWizard() {
    setStep('upload')
    setFiles([])
    setRunResult(null)
    setEnabledPersonas(PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id))
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#fef3e8' }}>
      {/* Step indicator */}
      <StepIndicator step={step} />

      <div className="flex-1 overflow-hidden">
        {step === 'upload' && (
          <IntakeUploader
            files={files}
            onChange={setFiles}
            onNext={() => setStep('classify')}
          />
        )}
        {step === 'classify' && (
          <IntakeClassifier
            files={files}
            onChange={setFiles}
            onBack={() => setStep('upload')}
            onNext={() => setStep('core')}
          />
        )}
        {step === 'core' && (
          <IntakeCoreDefiner
            files={files}
            onChange={setFiles}
            enabledPersonas={enabledPersonas}
            onPersonasChange={setEnabledPersonas}
            onBack={() => setStep('classify')}
            onRun={() => setStep('run')}
          />
        )}
        {step === 'run' && (
          apiKey ? (
            <IntakeProgress
              projectId={activeProjectId}
              files={files.filter(f => f.is_core_definer)}
              personas={enabledPersonas}
              apiKey={apiKey}
              onComplete={(result) => {
                setRunResult(result)
                setStep('review')
              }}
              onBack={() => setStep('core')}
            />
          ) : (
            <NoApiKeyGate onBack={() => setStep('core')} />
          )
        )}
        {step === 'review' && (
          <IntakeReview
            result={runResult}
            onBack={() => setStep('core')}
            onSaved={resetWizard}
            onDiscarded={resetWizard}
          />
        )}
      </div>
    </div>
  )
}

// ─── Step indicator strip ───
function StepIndicator({ step }) {
  const stepIdx = STEPS.findIndex(s => s.id === step)
  return (
    <div
      className="flex items-center gap-2 px-6 py-3"
      style={{ borderBottom: '1px solid #f4a261', backgroundColor: '#fff7ed' }}
    >
      {STEPS.map((s, i) => {
        const done = i < stepIdx
        const active = i === stepIdx
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm"
              style={{
                color: active ? '#fff7ed' : '#7c2d12',
                backgroundColor: active ? '#ea580c' : 'transparent',
                border: '1px solid #7c2d12',
                opacity: done || active ? 1 : 0.5,
              }}
            >
              <span className="text-[10px] font-mono font-bold">{i + 1}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="text-[10px]" style={{ color: '#7c2d12' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── No-project gate ───
function NoProjectGate() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      <Sparkles className="w-10 h-10" style={{ color: '#7c2d12' }} />
      <div className="text-xs font-mono text-center max-w-sm leading-relaxed" style={{ color: '#7c2d12' }}>
        The intake wizard runs against an active project. Create one
        from the project picker in the header to get started.
      </div>
      <FolderPlus className="w-5 h-5" style={{ color: '#7c2d12' }} />
    </div>
  )
}

// ─── No-api-key gate (only blocks the run step) ───
function NoApiKeyGate({ onBack }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
      <AlertCircle className="w-8 h-8" style={{ color: '#991b1b' }} />
      <div
        className="text-[11px] font-mono text-center max-w-md leading-relaxed p-3 rounded-sm"
        style={{ color: '#991b1b', backgroundColor: '#fee2e2', border: '2px solid #991b1b' }}
      >
        The intake pipeline needs an Anthropic API key. Add one in
        System Settings → API & Models, then come back to this step.
      </div>
      <button
        type="button"
        onClick={onBack}
        className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm"
        style={{ color: '#7c2d12', border: '1px solid #7c2d12', backgroundColor: 'transparent' }}
      >
        ← Back
      </button>
    </div>
  )
}
