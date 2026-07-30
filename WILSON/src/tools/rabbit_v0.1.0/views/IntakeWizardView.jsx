// ============================================================
// RABBIT — IntakeWizardView
// ============================================================
//
// Multi-step wizard that turns a pile of source documents into
// a structured project breakdown via runIngestion(). The flow:
//
//   prepare → run → review
//
// `prepare` consolidates what were originally three separate steps (upload,
// classify, core-definer). Session 17 deleted the three superseded step
// components — IntakePrepare.jsx is the whole of step 1 now.
//
// "New Project" opens a form page (not auto-create) so the user
// can fill in fields and confirm before anything is created.

import { useState, useCallback, useRef } from 'react'
import { Folder, Plus, AlertTriangle, Upload, X, DollarSign, UserCircle, FileText, Paperclip, File as FileIcon, Calendar, Hash } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { useTeamMembers } from '../../../components/TeamMembers/useTeamMembers'
import { PERSONA_LIST } from '../intake/personas'
import { loadRabbitSettings, DEFAULT_PROJECT_TYPE_TEMPLATES } from './TimelineView'
import IntakePrepare, { DEFAULT_GENERATION_OPTIONS } from './intake/IntakePrepare'
import IntakeProgress from './intake/IntakeProgress'
import IntakeReview from './intake/IntakeReview'

const STEPS = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'run',     label: 'Run'     },
  { id: 'review',  label: 'Review'  },
]

const TYPE_OPTIONS     = ['commercial', 'film', 'series', 'music_video', 'branded_content', 'social', 'animation', 'documentary', 'video_game', 'interactive_experience', 'experiential_activation', 'other']
const TIER_OPTIONS     = ['micro', 'small', 'mid', 'large', 'enterprise']
const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']

function fmt(s) { return (s || '').replace(/_/g, ' ') }

export default function IntakeWizardView() {
  const ctx = useRabbit()
  const activeProjectId = ctx?.activeProjectId
  const project = ctx?.project
  const createProject = ctx?.createProject
  const setActiveProject = ctx?.setActiveProject

  const [step, setStep] = useState('prepare')
  const [files, setFiles] = useState([])
  const [enabledPersonas, setEnabledPersonas] = useState(
    PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id)
  )
  const [generationOptions, setGenerationOptions] = useState({ ...DEFAULT_GENERATION_OPTIONS })
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [showNewProjectForm, setShowNewProjectForm] = useState(false)

  const phases = ctx?.phases || []
  const assets = ctx?.assets || []
  const tasks  = ctx?.tasks  || []
  const existingDataCounts = (phases.length > 0 || assets.length > 0 || tasks.length > 0)
    ? { phases: phases.length, assets: assets.length, tasks: tasks.length }
    : null

  function resetWizard() {
    setStep('prepare')
    setFiles([])
    setRunResult(null)
    setOverwriteConfirmed(false)
    setEnabledPersonas(PERSONA_LIST.filter(p => p.defaultEnabled).map(p => p.id))
    setGenerationOptions({ ...DEFAULT_GENERATION_OPTIONS })
  }

  const handleProjectCreated = useCallback((id) => {
    setActiveProject?.(id)
    setShowNewProjectForm(false)
    resetWizard()
  }, [setActiveProject])

  // No project? Show gate with new-project option
  if (!activeProjectId) {
    if (showNewProjectForm) {
      return <NewProjectForm createProject={createProject} onCreated={handleProjectCreated} onCancel={() => setShowNewProjectForm(false)} />
    }
    return <NoProjectGate onNewProject={() => setShowNewProjectForm(true)} />
  }

  // New project form overlay (when a project already exists but user wants a new one)
  if (showNewProjectForm) {
    return <NewProjectForm createProject={createProject} onCreated={handleProjectCreated} onCancel={() => setShowNewProjectForm(false)} />
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Step indicator */}
      <StepIndicator step={step} />

      <div className="flex-1 overflow-hidden">
        {step === 'prepare' && (
          <IntakePrepare
            files={files}
            onChange={setFiles}
            enabledPersonas={enabledPersonas}
            onPersonasChange={setEnabledPersonas}
            generationOptions={generationOptions}
            onNewProject={() => setShowNewProjectForm(true)}
            onGenerationOptionsChange={setGenerationOptions}
            existingDataCounts={existingDataCounts}
            overwriteConfirmed={overwriteConfirmed}
            onOverwriteConfirmedChange={setOverwriteConfirmed}
            scenesEnabled={project?.scenes_enabled}
            onRun={() => setStep('run')}
          />
        )}
        {step === 'run' && (
            <IntakeProgress
              projectId={activeProjectId}
              files={files.filter(f => f.is_core_definer)}
              personas={enabledPersonas}
              onComplete={(result) => {
                // Filter result based on generation options
                if (result?.breakdown) {
                  if (!generationOptions.generate_timeline) result.breakdown.phases = []
                  if (!generationOptions.generate_assets) result.breakdown.assets = []
                  if (!generationOptions.generate_tasks) result.breakdown.tasks = []
                }
                setRunResult(result)
                setStep('review')
              }}
              onBack={() => setStep('prepare')}
            />
        )}
        {step === 'review' && (
          <IntakeReview
            result={runResult}
            onBack={() => setStep('prepare')}
            onSaved={resetWizard}
            onDiscarded={resetWizard}
          />
        )}
      </div>
    </div>
  )
}


// ─── New Project Form ───
function NewProjectForm({ createProject, onCreated, onCancel }) {
  const tm = useTeamMembers()
  const [draft, setDraft] = useState({
    title: '',
    client_name: '',
    project_code: '',
    description: '',
    project_type: '',
    project_tier: '',
    start_date: '',
    end_date: '',
    director_id: '',
    producer_id: '',
    budget_currency: 'USD',
    budget_total: '',
    budget_margin_pct: '',
    budget_contingency_pct: '',
    budget_agency_enabled: false,
    budget_agency_pct: '',
    notes: '',
  })
  const [files, setFiles] = useState([])
  const fileInputRef = useRef(null)
  const [creating, setCreating] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  function patch(field, value) { setDraft(d => ({ ...d, [field]: value })) }

  function handleReviewAndConfirm() {
    if (!draft.title.trim()) return
    setShowConfirm(true)
  }

  async function handleConfirmCreate() {
    if (creating) return
    setCreating(true)
    try {
      // Build payload
      const payload = { title: draft.title.trim() }
      if (draft.client_name.trim()) payload.client_name = draft.client_name.trim()
      if (draft.project_code.trim()) payload.project_code = draft.project_code.trim()
      if (draft.description.trim()) payload.description = draft.description.trim()
      if (draft.project_type) payload.project_type = draft.project_type
      if (draft.project_tier) payload.project_tier = draft.project_tier
      if (draft.start_date) payload.start_date = draft.start_date
      if (draft.end_date) payload.end_date = draft.end_date
      if (draft.director_id) payload.director_id = draft.director_id
      if (draft.producer_id) payload.producer_id = draft.producer_id
      if (draft.budget_currency) payload.budget_currency = draft.budget_currency
      if (draft.budget_total) payload.budget_total = Number(draft.budget_total) || 0
      if (draft.budget_margin_pct) payload.budget_margin_pct = Number(draft.budget_margin_pct) || 0
      if (draft.budget_contingency_pct) payload.budget_contingency_pct = Number(draft.budget_contingency_pct) || 0
      payload.budget_agency_enabled = draft.budget_agency_enabled
      if (draft.budget_agency_pct) payload.budget_agency_pct = Number(draft.budget_agency_pct) || 0
      if (draft.notes.trim()) payload.notes = draft.notes.trim()
      if (files.length > 0) payload.files = files
      payload.status = 'draft'

      // Apply database toggle defaults from type template
      if (draft.project_type) {
        const settings = loadRabbitSettings()
        const tpl = settings.projectTypeTemplates?.[draft.project_type] || DEFAULT_PROJECT_TYPE_TEMPLATES[draft.project_type]
        if (tpl) {
          if (tpl.scenes_enabled !== undefined) payload.scenes_enabled = tpl.scenes_enabled
          if (tpl.levels_enabled !== undefined) payload.levels_enabled = tpl.levels_enabled
          if (tpl.experiences_enabled !== undefined) payload.experiences_enabled = tpl.experiences_enabled
          if (tpl.uses_realtime_engine !== undefined) payload.uses_realtime_engine = tpl.uses_realtime_engine
        }
      }

      const created = await createProject?.(payload)
      if (created?.id) onCreated(created.id)
    } catch (err) {
      console.error('Failed to create project:', err)
    } finally {
      setCreating(false)
    }
  }

  const canSubmit = draft.title.trim().length > 0

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#1c1917' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3" style={{ borderBottom: '2px solid #f97316', backgroundColor: '#292524' }}>
        <div className="flex items-center gap-2.5">
          <Plus className="w-4 h-4" style={{ color: '#fb923c' }} />
          <span className="text-[13px] font-mono font-bold uppercase tracking-wider" style={{ color: '#fb923c' }}>
            Create New Project
          </span>
        </div>
        <button type="button" onClick={onCancel}
          className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
          style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
          Cancel
        </button>
      </div>

      {/* Form body — two-column: left form, right files */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto p-6 grid gap-6" style={{ gridTemplateColumns: '3fr 2fr' }}>

        {/* ── LEFT COLUMN ── */}
        <div className="flex flex-col gap-5">

          {/* ── Section: Project Info ── */}
          <SectionCard icon={<Folder className="w-3.5 h-3.5" />} title="Project Info">
            <FormField label="Project name" required>
              <input type="text" autoFocus value={draft.title} onChange={e => patch('title', e.target.value)}
                placeholder="e.g. Nike — Summer Campaign"
                className="w-full px-3 py-2.5 text-[13px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Client / Studio">
                <input type="text" value={draft.client_name} onChange={e => patch('client_name', e.target.value)}
                  placeholder="Company name"
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
              </FormField>
              <FormField label="Project code">
                <input type="text" value={draft.project_code} onChange={e => patch('project_code', e.target.value.toUpperCase())}
                  placeholder="PROJ"
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Project type">
                <select value={draft.project_type} onChange={e => patch('project_type', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.project_type ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">Select type...</option>
                  {TYPE_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </FormField>
              <FormField label="Project tier">
                <select value={draft.project_tier} onChange={e => patch('project_tier', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.project_tier ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">Select tier...</option>
                  {TIER_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Start date">
                <input type="date" value={draft.start_date} onChange={e => patch('start_date', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.start_date ? '#f4a261' : '#57534e', border: '1px solid #44403c', colorScheme: 'dark' }} />
              </FormField>
              <FormField label="End date">
                <input type="date" value={draft.end_date} onChange={e => patch('end_date', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.end_date ? '#f4a261' : '#57534e', border: '1px solid #44403c', colorScheme: 'dark' }} />
              </FormField>
            </div>
          </SectionCard>

          {/* ── Section: People ── */}
          <SectionCard icon={<UserCircle className="w-3.5 h-3.5" />} title="People">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Director">
                <select value={draft.director_id} onChange={e => patch('director_id', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.director_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">Select director...</option>
                  {(tm.members || []).map(m => <option key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ''}</option>)}
                </select>
              </FormField>
              <FormField label="Producer">
                <select value={draft.producer_id} onChange={e => patch('producer_id', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: draft.producer_id ? '#f4a261' : '#57534e', border: '1px solid #44403c' }}>
                  <option value="">Select producer...</option>
                  {(tm.members || []).map(m => <option key={m.id} value={m.id}>{m.name}{m.title ? ` — ${m.title}` : ''}</option>)}
                </select>
              </FormField>
            </div>
          </SectionCard>

          {/* ── Section: Budget ── */}
          <SectionCard icon={<DollarSign className="w-3.5 h-3.5" />} title="Budget">
            <div className="grid grid-cols-3 gap-4">
              <FormField label="Currency">
                <select value={draft.budget_currency} onChange={e => patch('budget_currency', e.target.value)}
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }}>
                  {CURRENCY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField label="Budget total">
                <input type="number" value={draft.budget_total} onChange={e => patch('budget_total', e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
              </FormField>
              <div />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField label="Margin %">
                <input type="number" value={draft.budget_margin_pct} onChange={e => patch('budget_margin_pct', e.target.value)}
                  placeholder="0" min="0" max="100" step="0.5"
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
              </FormField>
              <FormField label="Contingency %">
                <input type="number" value={draft.budget_contingency_pct} onChange={e => patch('budget_contingency_pct', e.target.value)}
                  placeholder="0" min="0" max="100" step="0.5"
                  className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
              </FormField>
              <div className="flex flex-col gap-1">
                <FormField label="Agency fee">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={draft.budget_agency_enabled} onChange={e => patch('budget_agency_enabled', e.target.checked)}
                        className="accent-orange-500" />
                      <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>Enable</span>
                    </label>
                    {draft.budget_agency_enabled && (
                      <input type="number" value={draft.budget_agency_pct} onChange={e => patch('budget_agency_pct', e.target.value)}
                        placeholder="20" min="0" max="100" step="0.5"
                        className="w-20 px-2 py-1.5 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500"
                        style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
                    )}
                  </div>
                </FormField>
              </div>
            </div>
          </SectionCard>

          {/* ── Section: Details ── */}
          <SectionCard icon={<FileText className="w-3.5 h-3.5" />} title="Details">
            <FormField label="Description">
              <textarea value={draft.description} onChange={e => patch('description', e.target.value)}
                placeholder="Brief project description..."
                rows={3}
                className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            </FormField>
            <FormField label="Notes">
              <textarea value={draft.notes} onChange={e => patch('notes', e.target.value)}
                placeholder="Internal notes..."
                rows={2}
                className="w-full px-3 py-2 text-[12px] font-mono rounded focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: '1px solid #44403c' }} />
            </FormField>
          </SectionCard>

        </div>{/* end LEFT COLUMN */}

        {/* ── RIGHT COLUMN: Attachments ── */}
        <div className="flex flex-col gap-5" style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
          <SectionCard icon={<Paperclip className="w-3.5 h-3.5" />} title="Attachments">
            <input ref={fileInputRef} type="file" multiple onChange={e => {
              const newFiles = Array.from(e.target.files || []).map(f => ({
                name: f.name,
                path: f.path || f.name,
                size: f.size || 0,
                type: f.type || '',
                lastModified: f.lastModified || null,
              }))
              setFiles(prev => [...prev, ...newFiles])
              e.target.value = ''
            }} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
              style={{ color: '#a8a29e', border: '2px dashed #44403c' }}>
              <Upload className="w-4 h-4" /> Drop or click to add files
            </button>
            {files.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: '#57534e' }}>
                  {files.length} file{files.length !== 1 ? 's' : ''} attached
                </span>
                {files.map((f, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded" style={{ backgroundColor: '#1c1917', border: '1px solid #3a3733' }}>
                    <FileIcon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#fb923c' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-mono truncate" style={{ color: '#d6d3d1' }}>{f.name}</div>
                      <div className="flex items-center gap-3 mt-1">
                        {f.size > 0 && (
                          <span className="text-[9px] font-mono" style={{ color: '#57534e' }}>
                            {f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1048576).toFixed(1)} MB`}
                          </span>
                        )}
                        {f.type && (
                          <span className="text-[9px] font-mono" style={{ color: '#57534e' }}>{f.type.split('/').pop()}</span>
                        )}
                        {f.lastModified && (
                          <span className="text-[9px] font-mono" style={{ color: '#57534e' }}>
                            {new Date(f.lastModified).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))}
                      className="p-0.5 hover:bg-stone-700 rounded transition-colors flex-shrink-0" style={{ color: '#fca5a5' }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {files.length === 0 && (
              <div className="text-center py-4">
                <Paperclip className="w-6 h-6 mx-auto mb-2" style={{ color: '#44403c' }} />
                <p className="text-[10px] font-mono" style={{ color: '#57534e' }}>
                  No files attached yet. Upload scripts, briefs, references, or any project documents.
                </p>
              </div>
            )}
          </SectionCard>
        </div>

        </div>{/* end grid */}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: '1px solid #44403c', backgroundColor: '#292524' }}>
        <span className="text-[10px] font-mono" style={{ color: '#57534e' }}>
          Nothing is saved until you confirm.
        </span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onCancel}
            className="px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
            style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
            Cancel
          </button>
          <button type="button" onClick={handleReviewAndConfirm} disabled={!canSubmit}
            className="px-5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-40"
            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
            Review & Create
          </button>
        </div>
      </div>

      {/* ── Confirmation dialog ── */}
      {showConfirm && (
        <>
          <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowConfirm(false)} />
          <div className="fixed z-50 top-1/2 left-1/2 w-full max-w-md rounded overflow-hidden"
            style={{ backgroundColor: '#292524', border: '2px solid #f97316', transform: 'translate(-50%,-50%)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid #44403c' }}>
              <AlertTriangle className="w-4 h-4" style={{ color: '#fb923c' }} />
              <span className="text-[13px] font-mono font-bold" style={{ color: '#fb923c' }}>Confirm project creation</span>
            </div>
            <div className="px-5 py-4 max-h-[60vh] overflow-auto">
              <p className="text-[11px] font-mono leading-relaxed mb-4" style={{ color: '#a8a29e' }}>
                Please verify the details below are correct. This will create a new project in your workspace.
              </p>
              <div className="flex flex-col gap-3">
                {/* Project info */}
                <div className="rounded p-3 flex flex-col gap-1.5" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                  <span className="text-[9px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: '#57534e' }}>Project</span>
                  <ConfirmRow label="Name" value={draft.title} />
                  {draft.client_name && <ConfirmRow label="Client" value={draft.client_name} />}
                  {draft.project_code && <ConfirmRow label="Code" value={draft.project_code} />}
                  {draft.project_type && <ConfirmRow label="Type" value={fmt(draft.project_type)} />}
                  {draft.project_tier && <ConfirmRow label="Tier" value={fmt(draft.project_tier)} />}
                  {draft.start_date && <ConfirmRow label="Start" value={draft.start_date} />}
                  {draft.end_date && <ConfirmRow label="End" value={draft.end_date} />}
                </div>
                {/* People */}
                {(draft.director_id || draft.producer_id) && (
                  <div className="rounded p-3 flex flex-col gap-1.5" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                    <span className="text-[9px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: '#57534e' }}>People</span>
                    {draft.director_id && <ConfirmRow label="Director" value={(tm.members || []).find(m => m.id === draft.director_id)?.name || draft.director_id} />}
                    {draft.producer_id && <ConfirmRow label="Producer" value={(tm.members || []).find(m => m.id === draft.producer_id)?.name || draft.producer_id} />}
                  </div>
                )}
                {/* Budget */}
                {(draft.budget_total || draft.budget_margin_pct || draft.budget_contingency_pct || draft.budget_agency_enabled) && (
                  <div className="rounded p-3 flex flex-col gap-1.5" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                    <span className="text-[9px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: '#57534e' }}>Budget</span>
                    <ConfirmRow label="Currency" value={draft.budget_currency} />
                    {draft.budget_total && <ConfirmRow label="Total" value={Number(draft.budget_total).toLocaleString()} />}
                    {draft.budget_margin_pct && <ConfirmRow label="Margin" value={`${draft.budget_margin_pct}%`} />}
                    {draft.budget_contingency_pct && <ConfirmRow label="Contingency" value={`${draft.budget_contingency_pct}%`} />}
                    {draft.budget_agency_enabled && <ConfirmRow label="Agency fee" value={draft.budget_agency_pct ? `${draft.budget_agency_pct}%` : 'Enabled'} />}
                  </div>
                )}
                {/* Details */}
                {(draft.description || draft.notes) && (
                  <div className="rounded p-3 flex flex-col gap-1.5" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                    <span className="text-[9px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: '#57534e' }}>Details</span>
                    {draft.description && <ConfirmRow label="Description" value={draft.description} />}
                    {draft.notes && <ConfirmRow label="Notes" value={draft.notes} />}
                  </div>
                )}
                {/* Files */}
                {files.length > 0 && (
                  <div className="rounded p-3 flex flex-col gap-1.5" style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}>
                    <span className="text-[9px] font-mono uppercase tracking-widest font-bold mb-0.5" style={{ color: '#57534e' }}>Attachments</span>
                    <ConfirmRow label="Files" value={`${files.length} file${files.length !== 1 ? 's' : ''}`} />
                  </div>
                )}
              </div>
            </div>
            <div className="px-5 py-3 flex items-center justify-end gap-3" style={{ borderTop: '1px solid #44403c' }}>
              <button type="button" onClick={() => setShowConfirm(false)}
                className="px-4 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded hover:bg-stone-700 transition-colors"
                style={{ color: '#a8a29e', border: '1px solid #44403c' }}>
                Go back
              </button>
              <button type="button" onClick={handleConfirmCreate} disabled={creating}
                className="px-5 py-1.5 text-[11px] font-mono font-bold uppercase tracking-wider rounded transition-colors disabled:opacity-40"
                style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
                {creating ? 'Creating...' : 'Confirm & Create'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SectionCard({ icon, title, children }) {
  return (
    <div className="rounded-md flex flex-col gap-4 p-4" style={{ backgroundColor: '#292524', border: '1px solid #3a3733' }}>
      <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid #3a3733' }}>
        <span style={{ color: '#fb923c' }}>{icon}</span>
        <span className="text-[10px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function FormField({ label, required, children }) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: '#78716c' }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      {children}
    </div>
  )
}

function ConfirmRow({ label, value }) {
  const isLong = value && value.length > 60
  return (
    <div className={isLong ? 'flex flex-col gap-0.5' : 'flex gap-3'}>
      <span className="text-[10px] font-mono uppercase tracking-wider flex-shrink-0" style={{ color: '#57534e', width: isLong ? undefined : 90 }}>{label}</span>
      <span className={`text-[11px] font-mono ${isLong ? '' : 'truncate'}`} style={{ color: '#d6d3d1', whiteSpace: isLong ? 'pre-wrap' : undefined }}>{value}</span>
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
function NoProjectGate({ onNewProject }) {
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
        to pick an existing project, or create a new one below.
      </div>
      <button type="button" onClick={onNewProject}
        className="flex items-center gap-1.5 px-5 py-2 text-[11px] font-mono uppercase tracking-wider rounded transition-colors"
        style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}>
        <Plus className="w-3.5 h-3.5" /> New project
      </button>
    </div>
  )
}

