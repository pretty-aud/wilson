// ============================================================
// IntakeReview — step 5 of the intake wizard
// ============================================================
//
// Renders the merged breakdown produced by runIngestion() and
// gives the user a chance to look it over before committing it
// to the project bundle. The actual write happens via the
// provider's `acceptIngestion(runId, breakdown)` — discardIngestion
// drops it on the floor.
//
// We pass `runId = null` because the wizard runs the pipeline
// directly and never creates a row in `ingestion_runs`. The
// provider has a guard for the null case (post-build §4.6).

import { useState } from 'react'
import {
  Sparkles, ChevronRight, ChevronDown, Save, Trash2, Loader2,
  Layers, Boxes, ListTodo, AlertTriangle, HelpCircle, DollarSign,
} from 'lucide-react'
import { useRabbit } from '../../state/RabbitProvider'

export default function IntakeReview({ result, onBack, onSaved, onDiscarded }) {
  const ctx = useRabbit()
  const breakdown = result?.breakdown || {}
  const fileResults = result?.files || []

  const [saving, setSaving]     = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const phases    = breakdown.phases    || []
  const assets    = breakdown.assets    || []
  const tasks     = breakdown.tasks     || []
  const budgets   = breakdown.budget_lines || []
  const risks     = breakdown.risks     || []
  const questions = breakdown.open_questions || []

  async function handleSave() {
    setSaving(true)
    setErrorMsg(null)
    try {
      await ctx.acceptIngestion(null, breakdown)
      ctx.dismissBackgroundIngestion?.()
      onSaved?.()
    } catch (err) {
      setErrorMsg(err?.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  async function handleDiscard() {
    setDiscarding(true)
    setErrorMsg(null)
    try {
      await ctx.discardIngestion(null)
      ctx.dismissBackgroundIngestion?.()
      onDiscarded?.()
    } catch (err) {
      setErrorMsg(err?.message || String(err))
    } finally {
      setDiscarding(false)
    }
  }

  const busy = saving || discarding

  return (
    <div className="h-full flex flex-col p-6 gap-4 overflow-auto" style={{ backgroundColor: '#1c1917' }}>
      <div>
        <h2 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: '#fb923c' }}>
          Step 5 · Review & save breakdown
        </h2>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#a8a29e' }}>
          The pipeline merged {fileResults.length} source file
          {fileResults.length === 1 ? '' : 's'} into the breakdown
          below. Save it to push phases, assets, and tasks into the
          active project — or discard if it missed the mark.
        </p>
      </div>

      {/* Counts strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <CountTile icon={Layers}    label="Phases"    n={phases.length}    />
        <CountTile icon={Boxes}     label="Assets"    n={assets.length}    />
        <CountTile icon={ListTodo}  label="Tasks"     n={tasks.length}     />
        <CountTile icon={DollarSign}label="Budget"    n={budgets.length}   />
        <CountTile icon={AlertTriangle} label="Risks" n={risks.length}     />
        <CountTile icon={HelpCircle}label="Questions" n={questions.length} />
      </div>

      <div className="flex-1 overflow-auto flex flex-col gap-3">
        <Section title="Phases" count={phases.length} defaultOpen>
          {phases.length === 0 && <Empty />}
          {phases.map((p, i) => (
            <Row key={`ph-${i}`} title={p.name} subtitle={p.rationale} />
          ))}
        </Section>

        <Section title="Assets" count={assets.length}>
          {assets.length === 0 && <Empty />}
          {assets.map((a, i) => (
            <Row
              key={`as-${i}`}
              title={a.name}
              subtitle={a.rationale}
              tag={a.type}
              hint={a.phase_hint && `phase: ${a.phase_hint}`}
            />
          ))}
        </Section>

        <Section title="Tasks" count={tasks.length}>
          {tasks.length === 0 && <Empty />}
          {tasks.map((t, i) => (
            <Row
              key={`tk-${i}`}
              title={t.title}
              subtitle={t.rationale}
              tag={t.priority}
              hint={[
                t.asset_hint && `asset: ${t.asset_hint}`,
                t.role && `role: ${t.role}`,
                t.bid_days != null && `${t.bid_days} day${t.bid_days === 1 ? '' : 's'}`,
              ].filter(Boolean).join(' · ')}
            />
          ))}
        </Section>

        {budgets.length > 0 && (
          <Section title="Budget hints" count={budgets.length}>
            {budgets.map((b, i) => (
              <Row
                key={`bu-${i}`}
                title={b.label}
                tag={b.category}
                hint={[
                  b.amount != null && `$${b.amount}`,
                  b.role_hint && `role: ${b.role_hint}`,
                ].filter(Boolean).join(' · ')}
              />
            ))}
          </Section>
        )}

        {risks.length > 0 && (
          <Section title="Risks" count={risks.length}>
            {risks.map((r, i) => (
              <Row
                key={`rk-${i}`}
                title={r.label}
                subtitle={r.mitigation}
                tag={r.severity}
              />
            ))}
          </Section>
        )}

        {questions.length > 0 && (
          <Section title="Open questions" count={questions.length}>
            {questions.map((q, i) => (
              <Row key={`qn-${i}`} title={q} />
            ))}
          </Section>
        )}
      </div>

      {/* Error block */}
      {errorMsg && (
        <div
          className="text-[11px] font-mono p-2 rounded-sm"
          style={{ backgroundColor: '#1c1917', color: '#fca5a5', border: '1px solid #7f1d1d' }}
        >
          {errorMsg}
        </div>
      )}

      {/* Controls */}
      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
          style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={busy}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{ color: '#a8a29e', border: '1px solid #44403c', backgroundColor: 'transparent' }}
          >
            {discarding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy || (phases.length === 0 && assets.length === 0 && tasks.length === 0)}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors disabled:opacity-30"
            style={{
              color: '#fff7ed',
              backgroundColor: '#ea580c',
              border: '1px solid #c2410c',
            }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save to project
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───
function CountTile({ icon: Icon, label, n }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-sm"
      style={{ backgroundColor: '#292524', border: '1px solid #44403c' }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#fb923c' }} />
      <div className="flex flex-col leading-tight">
        <span className="text-[14px] font-mono font-bold" style={{ color: '#d6d3d1' }}>{n}</span>
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: '#a8a29e' }}>{label}</span>
      </div>
    </div>
  )
}

function Section({ title, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="rounded-sm overflow-hidden" style={{ border: '1px solid #44403c', backgroundColor: '#292524' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-stone-700"
        style={{ borderBottom: open ? '1px solid #44403c' : 'none', backgroundColor: '#44403c' }}
      >
        <Chevron className="w-3.5 h-3.5" style={{ color: '#fb923c' }} />
        <span className="text-[11px] font-mono uppercase tracking-widest font-bold" style={{ color: '#fb923c' }}>
          {title}
        </span>
        <span className="text-[10px] font-mono" style={{ color: '#a8a29e' }}>({count})</span>
      </button>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  )
}

function Row({ title, subtitle, tag, hint }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2" style={{ borderBottom: '1px solid #1c1917' }}>
      <div className="flex items-start gap-2">
        <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: '#fb923c' }} />
        <span className="flex-1 text-xs font-mono" style={{ color: '#d6d3d1' }}>{title}</span>
        {tag && (
          <span
            className="px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded-sm"
            style={{ backgroundColor: '#1c1917', color: '#fb923c', border: '1px solid #57534e' }}
          >
            {tag}
          </span>
        )}
      </div>
      {subtitle && (
        <div className="ml-5 text-[10px] font-mono" style={{ color: '#a8a29e' }}>{subtitle}</div>
      )}
      {hint && (
        <div className="ml-5 text-[10px] font-mono italic" style={{ color: '#78716c' }}>{hint}</div>
      )}
    </div>
  )
}

function Empty() {
  return (
    <div className="px-3 py-3 text-[10px] font-mono italic" style={{ color: '#78716c' }}>
      (none returned by the pipeline)
    </div>
  )
}
