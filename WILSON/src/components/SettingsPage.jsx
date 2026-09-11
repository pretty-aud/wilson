import { useState, useEffect } from 'react'
import { PET_BREEDS } from './sprites/index'
import { AGENT_SYSTEM_PROMPT } from '../agent/agentPrompts'
import { useAgent } from '../agent/AgentProvider'
import CurrencyPicker from './settings/CurrencyPicker'
import TaskTemplateManager from './TaskTemplates/TaskTemplateManager'
import AgentSkillsSection from './settings/AgentSkillsSection'
import ProfileSection from './settings/ProfileSection'
import PasswordSection from './settings/PasswordSection'
import SessionSection from './settings/SessionSection'
import { defaultAgentSkillsState } from './settings/agentSkillRegistry'
import { useRabbit } from '../tools/rabbit_v0.1.0/state/RabbitProvider'
import { useRateCard } from './RateCard/useRateCard'
import { ADAPTER_MODES, adapterSupportsWrites } from '../tools/rabbit_v0.1.0/adapters'
import { otterFetch } from '../tools/otter_v0.3.1/adapters'
import { hasLocalServer, loadOtterSettings, saveOtterSettings, loadAgentSkills, saveAgentSkills } from '../lib/localData'
import { pushSettingsToCloud } from '../lib/userState'
import WorkspaceSwitcher from '../cloud/auth/WorkspaceSwitcher'
import MigrationPanel from '../cloud/migrate/MigrationPanel'
import OtterMigrationPanel from '../cloud/migrate/OtterMigrationPanel'
import { MfaSecuritySection } from '../cloud/auth/MfaSection'
import VersionPanel from './settings/VersionPanel'
import StorageConnections from './settings/StorageConnections'
import UserModelsSection from './settings/UserModelsSection'
import { usePermissions } from '../permissions'
import GatedAction from '../permissions/GatedAction'
// Session 43 §B — Settings is a light page (#f4a261). The two confirm dialogs
// near the bottom paint #1c1917 and keep their greys; they are the kit Dialog
// now, which stamps data-surface="dark" and brings its own tokens, so this
// file no longer imports a light token directly. Everything it needs is in
// settings.css and in src/ui/.
import { canCreateNewEgg } from '../lib/petLifecycle'
// UI overhaul D1 (2026-09-11): every hover / selected / on / tone state on
// this surface moved out of inline style ternaries and out of two
// onMouseEnter/onMouseLeave handlers into data attributes resolved here. An
// inline style beats a hover: class, so the two cannot coexist — see the
// file header for why this had to be its own commit.
import './settings/settings.css'
import { Section, Group, Row, Note } from './settings/SettingsChrome'
import { Button, IconButton, Input, TextArea, Select, Dialog } from '../ui'
import { Lock, X } from 'lucide-react'


/**
 * The pet card's status word, as one named tone per state rather than the
 * six-branch nested colour ternary it used to be inline. Kept next to the
 * component (not in the pet's own modules) because it is Settings chrome:
 * plan §2 Q20 puts this card in scope and leaves PetCompanion.jsx, the
 * sprites and every pet keyframe untouched (C5).
 */
function petStateTone(state) {
  if (state === 'dead' || state === 'starving') return 'danger'
  if (state === 'hungry') return 'warning'
  if (state === 'lonely') return 'lonely'
  if (state === 'sleeping') return 'sleeping'
  return 'ok'
}

export default function SettingsPage({
  petData, onPetModeToggle, onDifficultyChange, onPetReset, onNewPet,
  // Phase 3 (2026-08-12): Create Egg reported nothing on this page. It set an
  // error into App's `petSaveError`, whose only renderer is the companion chat
  // panel — which navigateTo force-closes on every page change. So the button
  // threw, the dialog shut, and Audrey saw "nothing happened".
  //
  // `newPetStatus` is this button's OWN channel: { ok, message }, success as
  // well as failure. It is not `petSaveError`, which multiplexes four unrelated
  // conditions and is cleared by any later successful save.
  newPetStatus = null, newPetPending = false,
  // Agent settings (passed via SettingsPageWithAgent wrapper)
  agentEnabled, onAgentEnabledChange,
  autoApprove, onAutoApproveChange,
  lockedSubjects, onLockedSubjectsChange,
  agentSystemPrompt, onAgentSystemPromptChange,
}) {
  const [activeTab, setActiveTab] = useState('general')

  // Pet danger zone confirmations
  const [petResetConfirm, setPetResetConfirm] = useState(false)
  const [newPetConfirm, setNewPetConfirm] = useState(false)

  // Agent settings local state
  const [editingAgentPrompt, setEditingAgentPrompt] = useState(false)
  const [agentPromptDraft, setAgentPromptDraft] = useState('')
  const [lockSubjectInput, setLockSubjectInput] = useState('')
  const [subjectList, setSubjectList] = useState([])
  const [softwareList, setSoftwareList] = useState([])

  // Task template manager popup
  const [showTemplateManager, setShowTemplateManager] = useState(false)

  // Project files root directory
  const [filesRootDir, setFilesRootDir] = useState(null)
  const [filesRootLoaded, setFilesRootLoaded] = useState(false)

  // Load files config on mount
  useEffect(() => {
    const api = window.electronAPI?.rabbit
    if (!api?.readFilesConfig) { setFilesRootLoaded(true); return }
    api.readFilesConfig().then(cfg => {
      if (cfg?.defaultRootDir) setFilesRootDir(cfg.defaultRootDir)
      setFilesRootLoaded(true)
    }).catch(() => setFilesRootLoaded(true))
  }, [])

  // ── S34 (TPN-AUTH-009): who may repoint this machine's root ──────────────
  // Signed into a workspace, the machine default is the fallback the whole
  // resolution chain lands on (project folder_root → workspace root →
  // THIS), so it follows Audrey's drive rule: admins only. With no workspace
  // there is no team to break — a solo Local Server user keeps full control.
  // Fails CLOSED while permissions load (the money-gate direction: a real
  // admin sees the control a beat late rather than a member seeing it at
  // all); the reason string tells the two states apart.
  const perms = usePermissions()
  const canEditMachineRoot = perms.ready && (!perms.workspaceId || perms.role === 'admin')
  const machineRootReason = !perms.ready
    ? 'Checking permissions…'
    : 'Only a workspace admin can change this computer’s storage folder while signed in to a company workspace.'

  async function handlePickRootDir() {
    if (!canEditMachineRoot) return
    const api = window.electronAPI?.rabbit
    if (!api?.pickDirectory) return
    const dir = await api.pickDirectory()
    if (!dir) return
    setFilesRootDir(dir)
    await api.writeFilesConfig({ defaultRootDir: dir })
  }

  async function handleClearRootDir() {
    if (!canEditMachineRoot) return
    const api = window.electronAPI?.rabbit
    if (!api?.writeFilesConfig) return
    setFilesRootDir(null)
    await api.writeFilesConfig({ defaultRootDir: null })
  }

  // RABBIT default currency + agent skills (persisted in otter-settings.json)
  const [rabbitDefaultCurrency, setRabbitDefaultCurrency] = useState('USD')
  const [agentSkills, setAgentSkills] = useState(defaultAgentSkillsState())

  // Per-tool agent system prompt overrides — separate file at
  // userData/otter-data/agent-skills.json (see §9.2 spec).
  const [agentPromptOverrides, setAgentPromptOverrides] = useState({})

  // Multi-tool agent context — used to push prompt-override changes
  // back into the live AgentProvider so the next sendAgentMessage
  // call sees the new prompt without a page reload.
  const agentCtx = useAgent()

  // RABBIT provider + rate card hooks for the new RABBIT tab.
  const rabbitCtx = useRabbit()
  const rateCard = useRateCard()
  const [rabbitDefaultRateCardId, setRabbitDefaultRateCardId] = useState(null)
  const [adapterSwitching, setAdapterSwitching] = useState(false)

  // Load software list for subject lock picker. otterFetch (Session 12): the
  // raw fetch always hit the local Express server, which meant local courses
  // in cloud mode and a 404 on the web — the adapter routes it correctly on
  // both hosts.
  useEffect(() => {
    otterFetch('/api/software').then(r => r.json()).then(list => {
      setSoftwareList(Array.isArray(list) ? list : [])
    }).catch(() => {})
  }, [])

  // Load Rabbit + agent-skills slices from otter-settings on mount
  // (localData: Express in Electron, localStorage on the web).
  useEffect(() => {
    let cancelled = false
    loadOtterSettings().then(data => {
      if (cancelled) return
      if (data?.rabbit?.defaultCurrency) setRabbitDefaultCurrency(data.rabbit.defaultCurrency)
      if (data?.rabbit?.defaultRateCardId) setRabbitDefaultRateCardId(data.rabbit.defaultRateCardId)
      if (data?.agentSkills) setAgentSkills({ ...defaultAgentSkillsState(), ...data.agentSkills })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Load per-tool agent prompt overrides on mount.
  useEffect(() => {
    let cancelled = false
    loadAgentSkills().then(data => {
      if (cancelled) return
      if (data && typeof data === 'object') setAgentPromptOverrides(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const persistOtterSettings = async (patch) => {
    try {
      const data = await loadOtterSettings().catch(() => ({}))
      // Shallow-merge top-level keys, but for object-valued keys do a one-deep merge
      // so updating settings.rabbit.defaultCurrency doesn't blow away other rabbit fields.
      const next = { ...data }
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && data[k] && typeof data[k] === 'object') {
          next[k] = { ...data[k], ...v }
        } else {
          next[k] = v
        }
      }
      await saveOtterSettings(next)
    } catch {
      /* best effort */
    }
  }

  const handleCurrencyChange = (code) => {
    setRabbitDefaultCurrency(code)
    persistOtterSettings({ rabbit: { defaultCurrency: code } })
  }

  const handleRabbitAdapterSwitch = async (mode) => {
    if (!rabbitCtx?.switchAdapter || mode === rabbitCtx.adapterMode) return
    setAdapterSwitching(true)
    try {
      await rabbitCtx.switchAdapter(mode)
    } finally {
      setAdapterSwitching(false)
    }
  }

  const handleRabbitDefaultRateCardChange = (id) => {
    setRabbitDefaultRateCardId(id || null)
    persistOtterSettings({ rabbit: { defaultRateCardId: id || null } })
  }

  const handleAgentSkillsChange = (next) => {
    setAgentSkills(next)
    persistOtterSettings({ agentSkills: next })
  }

  // Persist per-tool prompt overrides at userData/otter-data/agent-skills.json.
  // Passing `override === null` clears the override (Reset to default).
  const handlePromptOverrideChange = async (toolName, override) => {
    const next = { ...agentPromptOverrides }
    if (override == null) {
      delete next[toolName]
    } else {
      next[toolName] = { ...(next[toolName] || {}), systemPromptOverride: override }
    }
    setAgentPromptOverrides(next)
    try {
      await saveAgentSkills(next)
      // S31: the only writer of the agent prompt overrides, which follow the
      // PERSON between computers. No-ops when signed out.
      await pushSettingsToCloud()
      // Tell the live AgentProvider to re-read its overrides so the
      // next sendAgentMessage uses the new prompt.
      agentCtx?.refreshPromptOverrides?.()
    } catch {
      /* best effort */
    }
  }

  const handleLoadSubjectsForSoftware = async (slug) => {
    try {
      const res = await otterFetch(`/api/software/${slug}/subjects`)
      const list = await res.json()
      setSubjectList(Array.isArray(list) ? list : [])
    } catch {
      setSubjectList([])
    }
  }

  const handleToggleLock = (subjectSlug) => {
    if (!onLockedSubjectsChange || !lockedSubjects) return
    if (lockedSubjects.includes(subjectSlug)) {
      onLockedSubjectsChange(lockedSubjects.filter(s => s !== subjectSlug))
    } else {
      onLockedSubjectsChange([...lockedSubjects, subjectSlug])
    }
  }

  const wilsonVersion = typeof __WILSON_VERSION__ !== 'undefined' ? __WILSON_VERSION__ : 'v?'

  const form = petData?.form || 'egg'
  const breedLabel = PET_BREEDS[petData?.breed]?.label || (form === 'egg' ? 'Unknown' : 'Otter')
  // 🚨 THE BUTTON AND THE ACTION MUST ASK THE SAME QUESTION. This read
  // `form === 'ghost' || form === 'corpse'` while newPetEgg() demanded
  // `form === 'ghost'` exactly — two hand-written copies of one rule that had
  // silently drifted apart, so a pet sitting in 'corpse' was OFFERED a button
  // that could only ever refuse. Importing the predicate is what stops that
  // recurring; do not inline the form list here again.
  const isGhost = canCreateNewEgg(petData)

  // ── Departments state ──
  const [departments, setDepartments] = useState([
    'CG Art', 'Production', 'Creatives', 'Post', 'QA',
    'Audio', 'Physical Production', 'Development', 'Executive', 'Operations',
  ])
  const [newDeptName, setNewDeptName] = useState('')

  // Load departments from otter-settings on mount (localData: Express in
  // Electron, localStorage on the web).
  useEffect(() => {
    let cancelled = false
    loadOtterSettings().then(data => {
      if (cancelled) return
      if (data?.rabbit?.departments && Array.isArray(data.rabbit.departments)) {
        setDepartments(data.rabbit.departments)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const persistDepartments = (next) => {
    setDepartments(next)
    persistOtterSettings({ rabbit: { departments: next } })
  }

  const handleAddDepartment = () => {
    const name = newDeptName.trim()
    if (!name || departments.includes(name)) return
    persistDepartments([...departments, name])
    setNewDeptName('')
  }

  const handleRemoveDepartment = (dept) => {
    persistDepartments(departments.filter(d => d !== dept))
  }

  const handleRenameDepartment = (oldName, newName) => {
    const trimmed = newName.trim()
    if (!trimmed || (trimmed !== oldName && departments.includes(trimmed))) return
    persistDepartments(departments.map(d => d === oldName ? trimmed : d))
  }

  // Session 20: Models is its own tab rather than a block inside General.
  // 28 functions grouped by tool is a screenful, and burying the only place
  // that answers "why is this function using that model?" under a scroll is
  // how the last outage stayed invisible for 47 days.
  //
  // `groupEnd` draws a hairline separator after the tab, nothing more. It is
  // the whole of S17's fix: seven ungrouped peers read as
  // [General | Profile] [Models | Storage | Teams] [Agent | Agent Skills]
  // — two account tabs, three workspace tabs, two AI tabs. No tab moves, none
  // is hidden and none is collapsed, so the count of reachable controls and
  // the number of clicks to each are unchanged (C1).
  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'profile', label: 'Profile', groupEnd: true },
    { key: 'models',  label: 'Models' },
    // Session 22: labelled "Storage", not "RABBIT". The tab is about where
    // data lives, and naming it after the tool told users nothing. The KEY
    // stays 'rabbit' — it is the only thing the panel below switches on.
    { key: 'rabbit',  label: 'Storage' },
    { key: 'teams',   label: 'Teams', groupEnd: true },
    ...(onAgentEnabledChange ? [{ key: 'agent', label: 'Agent' }] : []),
    { key: 'skills', label: 'Agent Skills' },
  ]

  return (
    // 🚨 `data-surface="light"` is load-bearing, not decoration. F1 scopes the
    // global :focus-visible ring, the placeholder ink, the caret and
    // ::selection off it; without the stamp this page keeps the orange signal
    // ring, which measures about 1.6:1 on #f4a261 and is invisible. That
    // single attribute is most of S32's fix (49 buttons, zero focus styles).
    // `wilson-light-scroll` is F1's light scrollbar, applied per surface.
    <div className="h-full flex flex-col wilson-light-scroll" data-surface="light">
      <div className="flex-1 flex justify-center overflow-auto">
        {/* One measure for the whole surface (S18): the password form's own
            max-w-md and the page's py-8 px-8 are gone, so every tab's right
            edge lands in the same place and the gutter is the shell's 24px. */}
        <div className="s-page">
          <div className="s-tabs" role="tablist" aria-label="Settings sections">
            {tabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`s-tab-${tab.key}`}
                aria-selected={activeTab === tab.key}
                aria-controls={`s-panel-${tab.key}`}
                onClick={() => setActiveTab(tab.key)}
                className="s-tab"
                data-active={activeTab === tab.key}
                data-group-end={!!tab.groupEnd}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Arrow-key roving focus is deliberately NOT added: the review
              (S35) says it changes interaction, so it waits for Audrey. */}
          <div role="tabpanel" id={`s-panel-${activeTab}`} aria-labelledby={`s-tab-${activeTab}`}>

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  PROFILE TAB (Session 4 — same component the Session 8     */}
          {/*  Dashboard mounts)                                         */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'profile' && (
            <>
              <ProfileSection />
              {/* Session 9: TOTP management (locked #9 — required for
                  admins, offered to everyone). */}
              <MfaSecuritySection />
              {/* Session 31: Sign out. Belongs on the identity tab, next to the
                  password and 2FA. Ships with the pet teardown in App.jsx —
                  see the header of SessionSection for why they are one change. */}
              <SessionSection />
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  MODELS TAB (Session 20 — the user tier of the cascade)    */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'models' && <UserModelsSection />}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  GENERAL TAB                                              */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'general' && (
            <>
              {/* Active workspace switcher — hidden unless the user belongs
                  to more than one workspace. */}
              <WorkspaceSwitcher />

              {/* Session 9: version + auto-update surface. */}
              <VersionPanel />

              {/* AI access (Session 12, locked #21): no per-user key anymore.
                  AI features authenticate with the signed-in session and the
                  workspace's key lives server-side, managed by admins. */}
              {/* S16: this was an h2 at the same rank as Companion and
                  Project files location, followed by two lines of prose and
                  nothing to set — a note wearing a section's clothes. It is a
                  note now. It stays on this tab: moving it to Models, which
                  the review also proposed, would be a cross-tab content move
                  rather than a restyle. */}
              <Note>
                AI features are included with your workspace sign-in — no API key
                needed. Access is managed by your workspace admins.
              </Note>

              {/* Companion Section. Q20: the CARD is Settings chrome and is
                  in scope — its name label, its two numeric readouts, its
                  progress bars and its status word. The pet itself is not:
                  PetCompanion.jsx, src/components/sprites/ and every pet
                  keyframe in index.css are untouched (C5). */}
              {petData && (
                <Section
                  title="Companion"
                  description="Your AI pet companion appears on every page. Manage pet mode, difficulty, and more."
                >
                  {/* Pet info card. S6: the name and both numeric readouts
                      were #f4a261 — the page's own ground used as ink — on the
                      0.55 well, measuring 2.10:1. That is within rounding of
                      the 2.06:1 white-on-orange defect Session 43 existed to
                      fix. One ink now; the name takes the 14px card-title step
                      and the numbers the 12px caption step with tabular
                      figures, so rank comes from size, not colour. */}
                  <div className="s-well mb-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div className="min-w-0">
                        <span className="s-card-title">{petData.name || 'Ollie'}</span>
                        <span className="s-row-desc inline-block ml-2">
                          {petData.gender === 'female' ? 'F' : 'M'} / {breedLabel} / {form}
                        </span>
                      </div>
                      {/* The six-value colour ladder was a nested ternary
                          inline. Two of the six (#8b5cf6 violet, #6b7280 cool
                          grey) were cool hues on a warm-only palette — S11 —
                          and under Q1 option A no status colour is drawn on
                          this ground at all. The word carries the state; the
                          tone attribute survives so a dark-ground rendering
                          can colour it later with no JSX change. */}
                      <span className="s-pet-state" data-tone={petStateTone(petData.state)}>
                        {petData.state}
                      </span>
                    </div>
                    {(form === 'baby' || form === 'adult') && (
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="s-label">Hunger</span>
                            <span className="s-data s-row-desc">{Math.round(petData.hunger)}/100</span>
                          </div>
                          {/* S34: 500ms on a readout that only moves on a data
                              refresh the user did not initiate. 120ms is the
                              state-change duration from §3.4. */}
                          <div className="s-pet-bar">
                            <div className="s-pet-bar-fill" style={{ width: `${Math.round(petData.hunger)}%` }} />
                          </div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between mb-1">
                            <span className="s-label">Happiness</span>
                            <span className="s-data s-row-desc">{Math.round(petData.happiness)}/100</span>
                          </div>
                          <div className="s-pet-bar">
                            <div className="s-pet-bar-fill" style={{ width: `${Math.round(petData.happiness)}%` }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* S20 / A3: these two rows and the two on the Agent tab
                      were `flex items-center justify-between` with no height
                      at all, so a ~30px toggle sat above a ~26px segmented
                      group and no two rows shared a baseline. */}
                  <Group>
                    <Row
                      label="Pet mode"
                      description="When off, companion is a helper-only chatbot with no hunger/sleep mechanics"
                    >
                      <button
                        type="button"
                        onClick={() => onPetModeToggle(!petData.petMode)}
                        className="s-toggle"
                        data-on={!!petData.petMode}
                      >
                        {petData.petMode ? 'On' : 'Off'}
                      </button>
                    </Row>

                    {petData.petMode && (
                      <Row
                        label="Difficulty"
                        description="Controls decay speed, evolution time, and sleep duration"
                      >
                        {['low', 'medium', 'high'].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => onDifficultyChange(d)}
                            className="s-seg"
                            data-selected={petData.difficulty === d}
                          >
                            {d}
                          </button>
                        ))}
                      </Row>
                    )}
                  </Group>

                  {/* Danger zone. The eyebrow was text-red-700 on #f4a261 —
                      2.41:1 — so the one label whose whole job is to warn was
                      among the least readable text on the page (S10). It is
                      the page's ink at the Label step; the warning is carried
                      by the grouping and by each button's own copy. */}
                  <div className="mt-6">
                    <Group label="Danger zone">
                      <div className="s-row">
                        <div className="s-row-label">
                          <p className="s-row-desc">
                            Resetting clears this pet&rsquo;s feedback and interaction history. Neither action can be undone.
                          </p>
                        </div>
                        <div className="s-row-control">
                        <button
                          type="button"
                          onClick={() => setPetResetConfirm(true)}
                          className="s-danger-btn"
                          data-tone="danger"
                        >
                          Reset history
                        </button>
                        {isGhost && (
                          <button
                            type="button"
                            onClick={() => setNewPetConfirm(true)}
                            className="s-danger-btn"
                            data-tone="signal"
                          >
                            {/* ⚠️ NO pending label or `disabled` here, deliberately.
                                A first pass added both and they were DEAD CODE: the
                                same batch that sets newPetPending also installs the
                                egg, so `isGhost` goes false and this button unmounts
                                before either can render. The pending state is shown
                                by the status block below, which is outside that gate.
                                Re-entrancy is guarded in handleNewPet itself. */}
                            New pet
                          </button>
                        )}
                        </div>
                      </div>

                      {/* 🚨 Phase 3: the outcome, ON THE PAGE THAT HOSTS THE
                          BUTTON. Pressing Create Egg must never again be
                          indistinguishable from pressing nothing.

                          🚨 THE INK IS LIGHT_INK IN ALL THREE STATES, AND THAT
                          IS NOT A STYLE PREFERENCE. This block has no opaque
                          ancestor — SettingsPage's wrappers are transparent —
                          so these translucent fills composite straight onto the
                          page's #f4a261. A first pass used green-900 and
                          red-900, which measure 4.00:1 and 4.33:1 at 10px:
                          both UNDER AA, the same class as the white-on-#f4a261
                          at 2.06:1 that shipped in S43. On the same fills
                          LIGHT_INK measures 7.68:1 and 7.56:1.

                          ⚠️ lightSurface.test.js only checks the EXPORTED
                          tokens, so an inline colour here is invisible to the
                          contrast suite. Classify by the SURFACE, not the file,
                          and use the token. */}
                      {(newPetPending || newPetStatus) && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="s-status mt-3"
                          data-state={newPetPending ? 'pending' : newPetStatus.ok ? 'ok' : 'error'}
                        >
                          {newPetPending ? 'Creating a new egg…' : newPetStatus.message}
                        </div>
                      )}
                    </Group>
                  </div>
                </Section>
              )}

              {/* Project files location.

                  ⚠️ THIS SECTION IS TEST-PINNED IN A WAY A RESTYLE CAN BREAK.
                  workspaceRootWiring.test.js:282 counts the gated-action tags
                  in this file by their source text and requires at least
                  THREE. There are exactly three, all below, so none may be
                  removed.

                  🚨 That comment does NOT spell the tag out, deliberately. A
                  source-text count cannot tell code from prose: writing the
                  literal here would have raised the count to four and the
                  assertion would then have passed with one real gate deleted.
                  The same trap is recorded in userStateWiring.test.js, where a
                  negative assertion matched its own documentation twice.

                  The review's S15 proposes deleting
                  this panel in favour of the near-identical one in the Storage
                  tab; doing that would drop the count to one and fail a test
                  that says nothing about design. Both mount points stay, and
                  the row contract is what makes them read as one control
                  instead of two that merely resemble each other. */}
              <Section
                title="Project files location"
                description="Default root directory where R.A.B.B.I.T. creates project folders and stores asset files. Each project can also override this with its own location."
              >
                {filesRootDir ? (
                  <Group>
                    <Row label="Current path" stacked>
                      {/* A path is a fact: mono, full, wraps anywhere, never
                          truncated — the same treatment StorageConnections'
                          PathLine gives it, so the two agree. */}
                      <div className="s-data s-well break-all" style={{ fontSize: 'var(--text-dense)' }}>
                        {filesRootDir}
                      </div>
                    </Row>
                    <Row label="Folder">
                      <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                        <Button surface="light" size="sm" variant="primary" onClick={handlePickRootDir}>
                          Change
                        </Button>
                      </GatedAction>
                      <Button
                        surface="light"
                        size="sm"
                        onClick={() => {
                          window.electronAPI?.rabbit?.openInExplorer?.({ filePath: filesRootDir })
                        }}
                      >
                        Open in Explorer
                      </Button>
                      {/* One filled primary per region (S7). Clear is the
                          danger variant rather than a second fill, and its
                          hover:bg-red-50 — a near-white on the orange ground,
                          C9 — goes with it. */}
                      <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                        <Button surface="light" size="sm" variant="danger" onClick={handleClearRootDir}>
                          Clear
                        </Button>
                      </GatedAction>
                    </Row>
                  </Group>
                ) : (
                  <Group>
                    <Row
                      label="Folder"
                      description="No default location set. Project files will not be managed until a root directory is chosen."
                    >
                      <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                        <Button surface="light" size="sm" variant="primary" onClick={handlePickRootDir}>
                          Select root directory
                        </Button>
                      </GatedAction>
                    </Row>
                  </Group>
                )}
              </Section>

              {/* Password. Session 15 deleted the legacy LOCAL password panel
                  (MASTER_PLAN §6 #32): it drove /api/auth/change, which edited
                  a plaintext credential in otter-data/wilson-auth.json that
                  nothing has checked since the Supabase login landed in S2.
                  Editing a credential that grants nothing is worse than having
                  no panel — it implies a security control exists.

                  Session 21 restores it against Supabase. The component keeps
                  S15's copy verbatim for the no-session case, so local-only
                  mode still says the one true thing rather than showing a form
                  that cannot work. See PasswordSection.jsx for why there is no
                  current-password field (it would downgrade an MFA session). */}
              <PasswordSection />
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  RABBIT TAB                                               */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'rabbit' && (
            <>
              {/* Adapter mode.

                  🚨 THE PARAGRAPH BELOW KEEPS ITS EXACT LINE BREAKS, and that
                  is a test contract rather than a formatting preference.
                  localMediaWiring.test.js:124-125 asserts two substrings
                  against this file's raw source: one ends a line here and the
                  other IS the following line. Re-wrapping the paragraph
                  splits the second across a newline and the assertion fails —
                  with copy that never changed and a message that says nothing
                  about design. Change the className freely; do not reflow the
                  text. The same holds for the `hint` ternary below, whose
                  Local Server string is asserted WITH its surrounding single
                  quotes, so it must stay a one-line quoted literal. */}
              <Section
                first
                title="Storage backend"
                description={<>
                  Where R.A.B.B.I.T. stores projects, phases, assets, tasks, files, and rate
                  cards. Switching backends preserves whatever lives in the destination — it
                  does not migrate data between adapters. Supabase is where every project’s
                  database lives and the only backend other people can see. Local Server is
                  for demos only: its projects stay on this computer and cannot be shared.
                </>}
              >
                <div className="flex flex-col gap-2">
                  {ADAPTER_MODES.map(mode => {
                    const active = rabbitCtx?.adapterMode === mode
                    const writes = adapterSupportsWrites(mode)
                    // Session 12: in a browser only Supabase can work — the
                    // others need the desktop app's local server / Drive
                    // bridge. Disabled with the reason shown, not hidden.
                    const unavailableOnWeb = !hasLocalServer() && mode !== 'supabase'
                    const label =
                      mode === 'supabase'     ? 'Supabase'      :
                      mode === 'local_server' ? 'Local Server'  :
                      mode === 'google_drive' ? 'Google Drive'  : mode
                    // Session 22: the copy, not the logic, was the bug. On the
                    // web all three buttons are disabled BY CONSTRUCTION —
                    // Supabase because it is `active`, the other two because
                    // they are `unavailableOnWeb` — and three dead buttons
                    // read as "storage is broken" when Supabase is working
                    // perfectly. Nothing here changes which backend is used;
                    // it changes what the panel says about it.
                    const hint = unavailableOnWeb
                      ? 'Desktop app only — needs the local server or Drive bridge'
                      : mode === 'supabase'     ? "WILSON's own cloud backend. Already connected — no account to link and nothing to set up." :
                        mode === 'local_server' ? 'For demos only — projects here stay on this computer and cannot be shared (in-app Express server, desktop only)' :
                        mode === 'google_drive' ? 'Read-only sync from a Drive folder (writes deferred to v0.2)' : ''
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={adapterSwitching || active || unavailableOnWeb}
                        onClick={() => handleRabbitAdapterSwitch(mode)}
                        className="s-adapter"
                        data-selected={active}
                      >
                        <span className="s-adapter-dot" />
                        <div className="flex flex-col min-w-0">
                          {/* S41: a 12px label wearing four emphasis
                              mechanisms at once — mono, bold, uppercase and
                              tracking. It is a name, so it takes the card
                              title step in sentence case. */}
                          <span className="s-adapter-label">
                            {label}
                            {/* Session 22: an active backend is disabled because
                                you are already on it, not because it failed.
                                Say so — this badge is the whole difference
                                between "connected" and "dead". */}
                            {active && (
                              <span className="s-badge" data-badge="in-use">In use</span>
                            )}
                            {!writes && (
                              <span className="s-badge" data-badge="read-only">Read only</span>
                            )}
                          </span>
                          <span className="s-adapter-hint">{hint}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                {/* A8: the status dot used to sit at the container's left
                    edge while the radio dots above it started ~14px in, so the
                    two label columns never lined up. It is inside the group
                    now, on the same optical left edge. */}
                <div className="mt-3 flex items-center gap-2" style={{ paddingLeft: '13px' }}>
                  <span className="s-online-dot" data-online={!!rabbitCtx?.adapterStatus?.online} />
                  <span className="s-row-desc">
                    {rabbitCtx?.adapterStatus?.online ? 'Connected' : 'Offline'}
                    {rabbitCtx?.adapterStatus?.error && ` — ${rabbitCtx.adapterStatus.error}`}
                  </span>
                </div>
              </Section>

              {/* Cloud migration tool — dry-run + migrate + archive local */}
              {/* Session 9: per-provider connection details (locked #14). */}
              <StorageConnections />

              <MigrationPanel />

              {/* Session 11: runOtterMigration.js shipped in S10 with no caller.
                  Sits beside the RABBIT one so both migrations are found in the
                  same place. */}
              <OtterMigrationPanel />

              {/* Default currency. H8 in the review is the one Hick's-law
                  hotspot on this surface that was ALREADY right: nineteen
                  options behind one trigger with an autofocusing search
                  filter. Only its geometry changes (48px trigger to 36px). */}
              <Section
                title="Default project currency"
                description="Used as the starting currency for new R.A.B.B.I.T. projects and budget rollups. Each project can override this once it has been created."
              >
                <Group>
                  <Row label="Currency" stacked>
                    <CurrencyPicker
                      value={rabbitDefaultCurrency}
                      onChange={handleCurrencyChange}
                    />
                  </Row>
                </Group>
              </Section>

              {/* Default rate card. The empty state used #7c2d12, an ink
                  used nowhere else on the surface, at 11px italic mono (S27).
                  The select used the 0.55 well with #fde8d0 — 3.40:1, the
                  worst measured contrast in the project (S5). */}
              <Section
                title="Default rate card"
                description="New projects open with this rate card pinned in the budget view. Manage individual cards on the Rate Card page."
              >
                <Group>
                  <Row label="Rate card" htmlFor="s-default-rate-card">
                    {rateCard.rateCards.length === 0 ? (
                      <span className="s-row-desc">No rate cards yet. Create one on the Rate Card page.</span>
                    ) : (
                      <Select
                        id="s-default-rate-card"
                        surface="light"
                        aria-label="Default rate card"
                        value={rabbitDefaultRateCardId || ''}
                        onChange={(v) => handleRabbitDefaultRateCardChange(v || '')}
                        placeholder="None"
                        options={rateCard.rateCards.map(c => ({ value: c.id, label: c.name }))}
                      />
                    )}
                  </Row>
                </Group>
              </Section>

              <Section
                title="Task templates"
                description="Define reusable sets of tasks that can be automatically applied to assets. Templates are available across all projects unless marked as project-specific."
              >
                <Group>
                  <Row label="Templates">
                    <Button surface="light" size="sm" variant="primary" onClick={() => setShowTemplateManager(true)}>
                      Manage task templates
                    </Button>
                  </Row>
                </Group>
              </Section>
            </>
          )}

          {showTemplateManager && (
            <TaskTemplateManager onClose={() => setShowTemplateManager(false)} />
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  TEAMS TAB                                                */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'teams' && (
            <>
              <Section
                first
                title="Departments"
                description="Manage the department tags available for team members. These appear as dropdown options when assigning a department to a team member."
              >
                <Group label="Add a department">
                  <div className="s-row">
                    <div className="s-row-label flex-1">
                      {/* The kit Input keeps binUi's Escape-reverts-the-edit
                          behaviour, which is the best input interaction in the
                          app and which this surface had only in DepartmentRow,
                          hand-rolled (U4). */}
                      <Input
                        surface="light"
                        aria-label="New department name"
                        value={newDeptName}
                        onChange={setNewDeptName}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddDepartment() }}
                        placeholder="New department name"
                      />
                    </div>
                    <div className="s-row-control">
                      <Button
                        surface="light"
                        variant="primary"
                        onClick={handleAddDepartment}
                        disabled={!newDeptName.trim()}
                      >
                        Add
                      </Button>
                    </div>
                  </div>
                </Group>

                <div className="mt-4">
                  {departments.map((dept, idx) => (
                    <DepartmentRow
                      key={idx}
                      name={dept}
                      onRename={(newName) => handleRenameDepartment(dept, newName)}
                      onRemove={() => handleRemoveDepartment(dept)}
                    />
                  ))}
                  {/* S27: this was the only centred text on the surface, and
                      it used the empty-state treatment that also stood in for
                      loading and for errors. Left-aligned like everything
                      else, and it says only what it means. */}
                  {departments.length === 0 && (
                    <p className="s-row-desc">No departments configured. Add one above.</p>
                  )}
                </div>
              </Section>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  AGENT TAB                                                */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'agent' && onAgentEnabledChange && (
            <>
              <Section
                first
                title="Agent settings"
                description={'The companion agent can edit, correct, and create lesson content in O.T.T.E.R. when switched to "Work with" mode.'}
              >
                <Note>
                  Agent workflows use <strong>Sonnet</strong> and consume tokens faster than companion chat (which uses Haiku). Each edit request costs approximately 3-5x more tokens than a chat message.
                </Note>

                <div className="mt-4">
                <Group>
                  <Row
                    label="Agent mode"
                    description="When off, the agent toggle is hidden from the companion"
                  >
                    <button
                      type="button"
                      onClick={() => onAgentEnabledChange(!agentEnabled)}
                      className="s-toggle"
                      data-on={!!agentEnabled}
                    >
                      {agentEnabled ? 'On' : 'Off'}
                    </button>
                  </Row>

                  {agentEnabled && (
                    <Row
                      label="Auto-approve"
                      description="Controls when changes are applied without review"
                    >
                      {[
                        { key: 'always_ask', label: 'Always ask' },
                        { key: 'minor', label: 'Minor edits' },
                        { key: 'all', label: 'All' },
                      ].map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => onAutoApproveChange(opt.key)}
                          className="s-seg"
                          data-selected={autoApprove === opt.key}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </Row>
                  )}
                </Group>

                  {/* 🚨 S10, and the single worst-measured thing on this
                      surface: this sentence is the most consequential one on
                      the page and it was text-red-700 on a translucent red
                      over #f4a261 — 2.41:1, the LEAST readable text here. The
                      semantics move to the left edge and the ink becomes the
                      page's one ink, which is the pattern the new-pet status
                      block sixty lines up already proved at 7.68:1. */}
                  {agentEnabled && autoApprove === 'all' && (
                    <p className="s-feedback mt-4" data-tone="warning" role="alert">
                      Warning: All agent edits will be applied immediately without review. Use with caution.
                    </p>
                  )}

                  {/* Scope restrictions — locked subjects */}
                  {/* H6: an unbounded row of unlabelled chips with one 10px
                      line of explanation. The eyebrow names what the row IS
                      ("Course"), the chips take the 28px control height that
                      the difficulty and auto-approve groups use, and the
                      subject list beneath reads as the result of a choice.
                      Nothing is hidden and nothing is collapsed. */}
                  {agentEnabled && (
                    <div className="mt-6">
                      <Group label="Course">
                        <Row description="Lock subjects to prevent the agent from editing them. Select a course to see its subjects." stacked>
                          <div className="flex gap-2 flex-wrap">
                            {softwareList.map(sw => (
                              <button
                                key={sw.slug}
                                type="button"
                                onClick={() => handleLoadSubjectsForSoftware(sw.slug)}
                                className="s-seg"
                              >
                                {sw.name}
                              </button>
                            ))}
                          </div>
                        </Row>
                      </Group>

                      {subjectList.length > 0 && (
                        <div className="s-well mt-3">
                          {subjectList.map(sub => {
                            const isLocked = lockedSubjects?.includes(sub.slug)
                            return (
                              <div key={sub.slug} className="s-row">
                                <div className="s-row-label flex items-center gap-2">
                                  {/* S29: a lock EMOJI, which rendered from the
                                      OS colour-emoji font. visual-language.md
                                      bans emoji in UI; lucide is the library. */}
                                  {isLocked && <Lock size={14} aria-hidden="true" />}
                                  <span className="s-row-desc">{sub.title || sub.slug}</span>
                                </div>
                                <div className="s-row-control">
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLock(sub.slug)}
                                    className="s-lock"
                                    data-locked={!!isLocked}
                                    aria-pressed={!!isLocked}
                                  >
                                    {isLocked ? 'Unlock' : 'Lock'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Agent system prompt editor */}
                  {/* S26: two system-prompt editors one tab apart, on two
                      wells, in two inks, at two sizes — this one on the 0.55
                      brown at 3.40:1, the Agent Skills one on a #1c1917 well
                      with #f4a261 ink. One TextArea for both now, and the
                      read-only preview is the same control disabled rather
                      than a third treatment. */}
                  {agentEnabled && (
                    <div className="mt-6">
                      <Group
                        label="Agent system prompt"
                        actions={!editingAgentPrompt ? (
                          <Button
                            surface="light"
                            size="sm"
                            onClick={() => { setAgentPromptDraft(agentSystemPrompt || AGENT_SYSTEM_PROMPT); setEditingAgentPrompt(true); }}
                          >
                            Edit
                          </Button>
                        ) : (
                          <>
                            <Button
                              surface="light"
                              size="sm"
                              variant="primary"
                              onClick={() => { onAgentSystemPromptChange(agentPromptDraft); setEditingAgentPrompt(false); }}
                            >
                              Save
                            </Button>
                            <Button surface="light" size="sm" onClick={() => setEditingAgentPrompt(false)}>
                              Cancel
                            </Button>
                            <Button surface="light" size="sm" onClick={() => { setAgentPromptDraft(AGENT_SYSTEM_PROMPT); }}>
                              Reset
                            </Button>
                          </>
                        )}
                      >
                        <div className="s-row" data-stacked="true">
                          <div className="s-row-control">
                            {editingAgentPrompt ? (
                              <TextArea
                                surface="light"
                                aria-label="Agent system prompt"
                                value={agentPromptDraft}
                                onChange={setAgentPromptDraft}
                                rows={12}
                                className="w-full"
                              />
                            ) : (
                              <TextArea
                                surface="light"
                                aria-label="Agent system prompt (read only)"
                                value={agentSystemPrompt || AGENT_SYSTEM_PROMPT}
                                onChange={() => {}}
                                rows={6}
                                disabled
                                className="w-full"
                              />
                            )}
                          </div>
                        </div>
                      </Group>
                    </div>
                  )}
                </div>
              </Section>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  AGENT SKILLS TAB                                         */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'skills' && (
            <AgentSkillsSection
              value={agentSkills}
              onChange={handleAgentSkillsChange}
              promptOverrides={agentPromptOverrides}
              onPromptOverrideChange={handlePromptOverrideChange}
            />
          )}
          </div>
        </div>
      </div>

      {/* S21 / A5: the version string was px-6 on the OUTER column while the
          content was centred inside it, so it aligned to the window edge and
          sat roughly 300px left of everything it belongs to. It is inside the
          measure now, on the same gutter, with a hairline above. */}
      <div className="flex justify-center">
        <div className="s-page" style={{ paddingTop: 0 }}>
          <div className="pt-3" style={{ borderTop: '1px solid var(--color-rule-light)' }}>
            <span className="s-data s-label">{wilsonVersion}</span>
          </div>
        </div>
      </div>

      {/* S25 / S42: these two were the highest-stakes moments on the page —
          resetting a pet's history, releasing a ghost — rendered by the least
          systematic code on it. 100 percent inline style, zero Tailwind, the
          only 6px radius and the only hard-coded `fontFamily: 'monospace'` on
          the surface, a 0.15em tracked uppercase title, two radii inside one
          dialog, and no Escape key, no modal stack and no focus handling.

          They are the kit Dialog now, at the 400px `confirm` width, which
          brings Escape-to-close, the modal stack and the busy lock and
          nothing else (Q17, ruled "yes, but keep it minimal"). The dialog is
          dark by design and correct on a light page: it floats over its own
          backdrop and stamps `data-surface="dark"` so the focus ring inside
          it goes back to the signal.

          ⚠️ The four `window.confirm` calls on this surface are NOT converted.
          localDemoWiring.test.js:225 pins one of them as a demo-sprint wiring
          guard, and converting only the other three would leave one surface
          with two confirm idioms. Recorded in the hand-off. */}
      {petResetConfirm && (
        <Dialog
          title="Reset pet history"
          width="confirm"
          onClose={() => setPetResetConfirm(false)}
          footer={
            <>
              <Button onClick={() => setPetResetConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => { onPetReset(); setPetResetConfirm(false); }}>
                Reset
              </Button>
            </>
          }
        >
          Reset all pet feedback and interaction history? This cannot be undone.
        </Dialog>
      )}

      {newPetConfirm && (
        <Dialog
          title="New pet"
          width="confirm"
          onClose={() => setNewPetConfirm(false)}
          footer={
            <>
              <Button onClick={() => setNewPetConfirm(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => { onNewPet(); setNewPetConfirm(false); }}>
                Create egg
              </Button>
            </>
          }
        >
          Create a new egg? Your current ghost will be released.
        </Dialog>
      )}
    </div>
  )
}

// ─── DepartmentRow — inline-editable department item ───
function DepartmentRow({ name, onRename, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  function commit() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== name) {
      onRename(draft.trim())
    } else {
      setDraft(name)
    }
  }

  return (
    <div className="s-dept-row flex items-center gap-2 px-3 py-2 rounded-sm transition-colors">
      {/* The input is CONDITIONALLY MOUNTED, not hidden with CSS, and it must
          stay that way: `autoFocus` only fires on mount, so turning this into
          a show/hide would silently break focus-on-edit. */}
      {editing ? (
        <div className="flex-1 min-w-0">
          <Input
            surface="light"
            size="sm"
            autoFocus
            aria-label={`Rename ${name}`}
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setDraft(name); setEditing(false) }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(name); setEditing(true) }}
          className="s-dept-name"
        >
          {name}
        </button>
      )}
      {/* S29: the remove control was an HTML &times; glyph at text-sm, which
          sat high in its 24px hit area and was not an icon at all.
          visual-language.md's own rule is lucide-react, and no text glyph ever
          stands in for an icon. */}
      <IconButton
        surface="light"
        size="sm"
        icon={X}
        title="Remove department"
        aria-label={`Remove department ${name}`}
        danger
        onClick={() => {
          if (window.confirm(`Remove department "${name}"?`)) onRemove()
        }}
      />
    </div>
  )
}
