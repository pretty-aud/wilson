// ============================================================
// RABBIT — IntakeWizardView
// ============================================================
//
// Multi-step wizard that turns a pile of source documents into
// a structured project breakdown via runIngestion(). The flow:
//
//   upload → classify → core → run → review → save
//
// As of WILSON v0.6.x the wizard is wizard-only — picking and
// creating projects happens exclusively in the Summary tab. If
// no project is active when the user lands here we point them
// at Summary instead of bouncing them through a project picker.
//
// Wizard-local state (files, personas, runResult) is still
// discardable on close. The chosen project id lives on the
// RabbitProvider so other views see it too.

import { useState } from 'react'
import { AlertCircle, Folder } from 'lucide-react'
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
  const project = ctx?.project

  const [step, setStep] = useState('upload')
  const [files, setFiles] = useState([])
  const [enabledPersonas, setEnabledPersonas] = useState(
    PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id)
  )
  const [runResult, setRunResult] = useState(null)

  const apiKey = readApiKey()

  function resetWizard() {
    setStep('upload')
    setFiles([])
    setRunResult(null)
    setEnabledPersonas(PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id))
  }

  // No project? Send the user to the Summary tab to pick or create
  // one. We do not host a project picker here — Summary owns that.
  if (!activeProjectId) {
    return <NoProjectGate />
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Active project banner — orient the user inside the wizard */}
      <div
        className="flex items-center gap-2 px-6 py-2"
        style={{ borderBottom: '1px solid #44403c', backgroundColor: '#1c1917' }}
      >
        <Folder className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
        <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#78716c' }}>
          Intake into
        </span>
        <span className="text-[11px] font-mono font-bold truncate" style={{ color: '#d6d3d1' }}>
          {project?.title || 'Loading…'}
        </span>
      </div>

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
      style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
    >
      {STEPS.map((s, i) => {
        const done = i < stepIdx
        const active = i === stepIdx
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm"
              style={{
                color: active ? '#fff7ed' : '#a8a29e',
                backgroundColor: active ? '#ea580c' : 'transparent',
                border: '1px solid #44403c',
                opacity: done || active ? 1 : 0.5,
              }}
            >
              <span className="text-[10px] font-mono font-bold">{i + 1}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="text-[10px]" style={{ color: '#78716c' }}>›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── No-project gate ───
//
// Shown when the user lands on Intake without an active project.
// We don't host a project picker here anymore — Summary owns that.
function NoProjectGate() {
  return (
    <div
      className="h-full flex flex-col items-center justify-center gap-4 p-8"
      style={{ backgroundColor: '#1c1917' }}
    >
      <Folder className="w-10 h-10" style={{ color: '#57534e' }} />
      <div
        className="text-[11px] font-mono text-center max-w-md leading-relaxed"
        style={{ color: '#a8a29e' }}
      >
        No project selected. Open the <span style={{ color: '#fb923c' }}>Summary</span> tab
        to pick an existing project or scaffold a new one, then come back here to ingest
        documents.
      </div>
    </div>
  )
}

// ─── No-api-key gate (only blocks the run step) ───
function NoApiKeyGate({ onBack }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8" style={{ backgroundColor: '#1c1917' }}>
      <AlertCircle className="w-8 h-8" style={{ color: '#fca5a5' }} />
      <div
        className="text-[11px] font-mono text-center max-w-md leading-relaxed p-3 rounded-sm"
        style={{ color: '#fca5a5', backgroundColor: '#1c1917', border: '1px solid #7f1d1d' }}
      >
        The intake pipeline needs an Anthropic API key. Add one in
        System Settings → API & Models, then come back to this step.
      </div>
      <button
        type="button"
        onClick={onBack}
        className="px-3 py-1 text-[11px] font-mono uppercase tracking-wider rounded-sm"
        style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
      >
        ← Back
      </button>
    </div>
  )
}
