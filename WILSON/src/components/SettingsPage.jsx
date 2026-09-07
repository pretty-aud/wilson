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
// Session 43 §B — Settings is a light page (#f4a261). The two CONFIRM DIALOGS
// near the bottom paint #1c1917 and keep their greys.
import { LIGHT_INK, LIGHT_RULE } from './lightSurface'
import { canCreateNewEgg } from '../lib/petLifecycle'


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
  // A3 (2026-09-07): the pet's cross-device notices — today, "Your pet changed
  // on another device — refreshed" after migration 0068 refuses this window's
  // stale copy. The same object drives the app-level <PetNotice> toast; this
  // card is the surface that is still there once the toast has gone.
  // null | { kind: 'info' | 'error', message }
  petNotice = null,
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

  const inputStyle = {
    backgroundColor: 'rgba(120, 70, 30, 0.55)',
    color: '#fde8d0',
    border: 'none',
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
  const tabs = [
    { key: 'general', label: 'General' },
    { key: 'profile', label: 'Profile' },
    { key: 'models',  label: 'Models' },
    // Session 22: labelled "Storage", not "RABBIT". The tab is about where
    // data lives, and naming it after the tool told users nothing. The KEY
    // stays 'rabbit' — it is the only thing the panel below switches on.
    { key: 'rabbit',  label: 'Storage' },
    { key: 'teams',   label: 'Teams' },
    ...(onAgentEnabledChange ? [{ key: 'agent', label: 'Agent' }] : []),
    { key: 'skills', label: 'Agent Skills' },
  ]

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex justify-center py-8 px-8 overflow-auto">
        <div className="w-full max-w-2xl">
          {/* Tab bar */}
          <div className="flex gap-1 mb-8">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="px-5 py-2 text-xs font-bold uppercase tracking-widest rounded-t-sm transition-colors"
                style={{
                  backgroundColor: activeTab === tab.key ? 'rgba(120, 70, 30, 0.55)' : 'transparent',
                  color: activeTab === tab.key ? '#ffffff' : LIGHT_INK,
                  borderBottom: activeTab === tab.key ? '2px solid #f97316' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-8">

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
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  AI Features
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  AI features are included with your workspace sign-in — no API key
                  needed. Access is managed by your workspace admins.
                </p>
              </div>

              {/* Companion Section */}
              {petData && (
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                    Companion
                  </h2>
                  {/* 🚨 A3: CLOUD-ONLY, SAID OUT LOUD. The pet is one row per
                      person in your account (migration 0046) and every save
                      goes there — `savePetData`'s local branch is only reached
                      when nobody is signed in. The Phase 3 brief claimed the
                      pet "works on desktop in local mode"; it does not, and
                      until now nothing on screen said so. Somebody whose egg
                      failed to hatch on a bad connection had no way to tell
                      that from the feature being broken. */}
                  <p className="text-xs text-stone-950 mb-2 leading-relaxed">
                    Your AI pet companion appears on every page. Manage pet mode, difficulty, and more.
                  </p>
                  <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                    Your pet lives in your account, so it follows you between computers —
                    and it needs a connection. There is no offline copy: if the connection
                    drops, changes to your pet are not saved until it comes back.
                  </p>

                  <div className="space-y-4">
                    {/* 🚨 A3: the cross-device notice, on the page that
                        describes the pet. The app-level toast auto-dismisses
                        after ten seconds; a person who was looking elsewhere
                        when their pet was refreshed underneath them finds the
                        explanation here. LIGHT_INK for the same contrast reason
                        the Create Egg status block below spells out — this
                        block composites onto the page's #f4a261. */}
                    {petNotice && (
                      <div
                        role="status"
                        aria-live="polite"
                        className="px-3 py-2 rounded-sm border text-[10px] font-mono leading-relaxed"
                        style={
                          petNotice.kind === 'error'
                            ? { borderColor: '#7f1d1d', color: LIGHT_INK, backgroundColor: 'rgba(185, 28, 28, 0.10)' }
                            : { borderColor: LIGHT_RULE, color: LIGHT_INK, backgroundColor: 'rgba(120, 70, 30, 0.08)' }
                        }
                      >
                        {petNotice.message}
                      </div>
                    )}

                    {/* Pet info card */}
                    <div className="p-4 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.55)' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-sm font-bold" style={{ color: '#f4a261' }}>{petData.name || 'Ollie'}</span>
                          <span className="text-xs ml-2" style={{ color: '#1c1917' }}>
                            {petData.gender === 'female' ? 'F' : 'M'} / {breedLabel} / {form}
                          </span>
                        </div>
                        <span className="text-xs uppercase font-bold tracking-wider" style={{
                          color: petData.state === 'dead' ? '#ef4444' :
                                 petData.state === 'starving' ? '#ef4444' :
                                 petData.state === 'hungry' ? '#f59e0b' :
                                 petData.state === 'lonely' ? '#8b5cf6' :
                                 petData.state === 'sleeping' ? '#6b7280' :
                                 '#22c55e'
                        }}>
                          {petData.state}
                        </span>
                      </div>
                      {(form === 'baby' || form === 'adult') && (
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#1c1917' }}>Hunger</span>
                              <span className="text-[10px] font-mono" style={{ color: '#f4a261' }}>{Math.round(petData.hunger)}/100</span>
                            </div>
                            <div className="h-1.5 rounded-none overflow-hidden" style={{ backgroundColor: 'rgba(80, 45, 15, 0.5)' }}>
                              <div className="h-full transition-all duration-500" style={{ width: `${Math.round(petData.hunger)}%`, backgroundColor: '#f97316' }} />
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] uppercase tracking-wider" style={{ color: '#1c1917' }}>Happiness</span>
                              <span className="text-[10px] font-mono" style={{ color: '#f4a261' }}>{Math.round(petData.happiness)}/100</span>
                            </div>
                            <div className="h-1.5 rounded-none overflow-hidden" style={{ backgroundColor: 'rgba(80, 45, 15, 0.5)' }}>
                              <div className="h-full transition-all duration-500" style={{ width: `${Math.round(petData.happiness)}%`, backgroundColor: '#f97316' }} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Pet mode toggle */}
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-900">Pet Mode</span>
                        <p className="text-[10px] text-stone-950 mt-0.5">When off, companion is a helper-only chatbot with no hunger/sleep mechanics</p>
                      </div>
                      <button
                        onClick={() => onPetModeToggle(!petData.petMode)}
                        className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"
                        style={{
                          backgroundColor: petData.petMode ? '#f97316' : '#44403c',
                          color: petData.petMode ? '#fff' : LIGHT_INK,
                        }}
                      >
                        {petData.petMode ? 'ON' : 'OFF'}
                      </button>
                    </div>

                    {/* Difficulty selector */}
                    {petData.petMode && (
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold uppercase tracking-wider text-stone-900">Difficulty</span>
                          <p className="text-[10px] text-stone-950 mt-0.5">Controls decay speed, evolution time, and sleep duration</p>
                        </div>
                        <div className="flex gap-1">
                          {['low', 'medium', 'high'].map(d => (
                            <button
                              key={d}
                              onClick={() => onDifficultyChange(d)}
                              className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                              style={{
                                backgroundColor: petData.difficulty === d ? '#f97316' : 'rgba(120, 70, 30, 0.45)',
                                color: petData.difficulty === d ? '#fff' : LIGHT_INK,
                              }}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Danger zone */}
                    <div className="pt-2 border-t border-stone-400/30">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 block mb-3">Danger Zone</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPetResetConfirm(true)}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors border"
                          style={{
                            backgroundColor: 'transparent',
                            color: '#1c1917',
                            borderColor: '#44403c',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#44403c'; e.currentTarget.style.color = '#1c1917'; }}
                        >
                          Reset History
                        </button>
                        {isGhost && (
                          <button
                            onClick={() => setNewPetConfirm(true)}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors border"
                            style={{
                              backgroundColor: 'transparent',
                              color: '#1c1917',
                              borderColor: '#44403c',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#44403c'; e.currentTarget.style.color = '#1c1917'; }}
                          >
                            {/* ⚠️ NO pending label or `disabled` here, deliberately.
                                A first pass added both and they were DEAD CODE: the
                                same batch that sets newPetPending also installs the
                                egg, so `isGhost` goes false and this button unmounts
                                before either can render. The pending state is shown
                                by the status block below, which is outside that gate.
                                Re-entrancy is guarded in handleNewPet itself. */}
                            New Pet
                          </button>
                        )}
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
                          className="mt-3 px-3 py-2 rounded-sm border text-[10px] font-mono leading-relaxed"
                          style={
                            newPetPending
                              ? { borderColor: LIGHT_RULE, color: LIGHT_INK, backgroundColor: 'rgba(120, 70, 30, 0.08)' }
                              : newPetStatus.ok
                                ? { borderColor: '#14532d', color: LIGHT_INK, backgroundColor: 'rgba(21, 128, 61, 0.10)' }
                                : { borderColor: '#7f1d1d', color: LIGHT_INK, backgroundColor: 'rgba(185, 28, 28, 0.10)' }
                          }
                        >
                          {newPetPending ? 'Creating a new egg…' : newPetStatus.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Project Files Root Directory */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Project Files Location
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Default root directory where RABBIT creates project folders and stores asset files.
                  Each project can also override this with its own location.
                </p>
                <div className="p-4 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.15)', border: '1px solid rgba(120, 70, 30, 0.3)' }}>
                  {filesRootDir ? (
                    <div className="space-y-3">
                      <div>
                        <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: LIGHT_INK }}>Current path</span>
                        <div className="mt-1 px-3 py-2 rounded-sm text-xs font-mono break-all" style={{ backgroundColor: 'rgba(0,0,0,0.1)', color: '#1c1917' }}>
                          {filesRootDir}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                          <button
                            type="button"
                            onClick={handlePickRootDir}
                            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                            style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
                          >
                            Change
                          </button>
                        </GatedAction>
                        <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                          <button
                            type="button"
                            onClick={handleClearRootDir}
                            className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors hover:bg-red-50"
                            style={{ color: '#dc2626', border: '1px solid #dc2626' }}
                          >
                            Clear
                          </button>
                        </GatedAction>
                        <button
                          type="button"
                          onClick={() => {
                            window.electronAPI?.rabbit?.openInExplorer?.({ filePath: filesRootDir })
                          }}
                          className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                          style={{ color: LIGHT_INK, border: `1px solid ${LIGHT_RULE}` }}
                        >
                          Open in Explorer
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs italic" style={{ color: LIGHT_INK }}>
                        No default location set. Project files will not be managed until a root directory is chosen.
                      </p>
                      <GatedAction allowed={canEditMachineRoot} reason={machineRootReason}>
                        <button
                          type="button"
                          onClick={handlePickRootDir}
                          className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                          style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
                        >
                          Select Root Directory
                        </button>
                      </GatedAction>
                    </div>
                  )}
                </div>
              </div>

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
              {/* Adapter mode */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Storage Backend
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Where R.A.B.B.I.T. stores projects, phases, assets, tasks, files, and rate
                  cards. Switching backends preserves whatever lives in the destination — it
                  does not migrate data between adapters.
                </p>
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
                        mode === 'local_server' ? 'In-app Express server (desktop only — single user)' :
                        mode === 'google_drive' ? 'Read-only sync from a Drive folder (writes deferred to v0.2)' : ''
                    return (
                      <button
                        key={mode}
                        type="button"
                        disabled={adapterSwitching || active || unavailableOnWeb}
                        onClick={() => handleRabbitAdapterSwitch(mode)}
                        className="flex items-start gap-2 px-3 py-2 text-left rounded-sm transition-colors disabled:cursor-default"
                        style={{
                          backgroundColor: active ? 'rgba(234, 88, 12, 0.18)' : 'rgba(120, 70, 30, 0.18)',
                          border: `2px solid ${active ? '#ea580c' : 'transparent'}`,
                        }}
                      >
                        <span
                          className="mt-0.5 w-3 h-3 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: active ? '#ea580c' : 'transparent',
                            border: '2px solid #7c2d12',
                          }}
                        />
                        <div className="flex flex-col">
                          <span className="text-[12px] font-mono font-bold uppercase tracking-wider" style={{ color: '#1c1917' }}>
                            {label}
                            {/* Session 22: an active backend is disabled because
                                you are already on it, not because it failed.
                                Say so — this badge is the whole difference
                                between "connected" and "dead". */}
                            {active && (
                              <span
                                className="ml-2 px-1.5 py-0.5 text-[9px] rounded-sm normal-case tracking-normal"
                                style={{ backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #166534' }}
                              >
                                In use
                              </span>
                            )}
                            {!writes && (
                              <span
                                className="ml-2 px-1.5 py-0.5 text-[9px] rounded-sm normal-case tracking-normal"
                                style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #991b1b' }}
                              >
                                Read only
                              </span>
                            )}
                          </span>
                          <span className="text-[11px]" style={{ color: '#1c1917' }}>{hint}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: rabbitCtx?.adapterStatus?.online ? '#22c55e' : '#ef4444' }}
                  />
                  <span className="text-[11px] font-mono" style={{ color: '#1c1917' }}>
                    {rabbitCtx?.adapterStatus?.online ? 'Connected' : 'Offline'}
                    {rabbitCtx?.adapterStatus?.error && ` — ${rabbitCtx.adapterStatus.error}`}
                  </span>
                </div>
              </div>

              {/* Cloud migration tool — dry-run + migrate + archive local */}
              {/* Session 9: per-provider connection details (locked #14). */}
              <StorageConnections />

              <MigrationPanel />

              {/* Session 11: runOtterMigration.js shipped in S10 with no caller.
                  Sits beside the RABBIT one so both migrations are found in the
                  same place. */}
              <OtterMigrationPanel />

              {/* Default currency */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Default Project Currency
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Used as the starting currency for new RABBIT projects and budget rollups.
                  Each project can override this once it's been created.
                </p>
                <CurrencyPicker
                  value={rabbitDefaultCurrency}
                  onChange={handleCurrencyChange}
                />
              </div>

              {/* Default rate card */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Default Rate Card
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  New projects open with this rate card pinned in the budget view. Manage
                  individual cards on the Rate Card page.
                </p>
                {rateCard.rateCards.length === 0 ? (
                  <div className="text-[11px] font-mono italic" style={{ color: '#7c2d12' }}>
                    No rate cards yet. Create one on the Rate Card page.
                  </div>
                ) : (
                  <select
                    value={rabbitDefaultRateCardId || ''}
                    onChange={(e) => handleRabbitDefaultRateCardChange(e.target.value)}
                    className="px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
                    style={{
                      backgroundColor: 'rgba(120, 70, 30, 0.55)',
                      color: '#fde8d0',
                      border: 'none',
                      minWidth: '260px',
                    }}
                  >
                    <option value="">— None —</option>
                    {rateCard.rateCards.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Task Templates */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Task Templates
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Define reusable sets of tasks that can be automatically applied to assets.
                  Templates are available across all projects unless marked as project-specific.
                </p>
                <button
                  type="button"
                  onClick={() => setShowTemplateManager(true)}
                  className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                  style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
                >
                  Manage Task Templates
                </button>
              </div>
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
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Departments
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Manage the department tags available for team members. These appear as dropdown
                  options when assigning a department to a team member.
                </p>

                {/* Add new department */}
                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddDepartment() }}
                    placeholder="New department name..."
                    className="flex-1 px-3 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={handleAddDepartment}
                    disabled={!newDeptName.trim()}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors disabled:opacity-40"
                    style={{ backgroundColor: '#1c1917', color: '#f4a261' }}
                  >
                    Add
                  </button>
                </div>

                {/* Department list */}
                <div className="space-y-1">
                  {departments.map((dept, idx) => (
                    <DepartmentRow
                      key={idx}
                      name={dept}
                      onRename={(newName) => handleRenameDepartment(dept, newName)}
                      onRemove={() => handleRemoveDepartment(dept)}
                    />
                  ))}
                  {departments.length === 0 && (
                    <div className="text-xs font-mono italic py-4 text-center" style={{ color: LIGHT_INK }}>
                      No departments configured. Add one above.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  AGENT TAB                                                */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'agent' && onAgentEnabledChange && (
            <>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Agent Settings
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  The companion agent can edit, correct, and create lesson content in O.T.T.E.R. when switched to "Work with" mode.
                </p>

                <div className="space-y-4">
                  {/* Token warning */}
                  <div className="p-3 rounded-sm border" style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)', borderColor: 'rgba(120, 70, 30, 0.5)' }}>
                    <p className="text-[11px] text-stone-900 leading-relaxed">
                      Agent workflows use <strong>Sonnet</strong> and consume tokens faster than companion chat (which uses Haiku). Each edit request costs approximately 3-5x more tokens than a chat message.
                    </p>
                  </div>

                  {/* Agent enable/disable */}
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-900">Agent Mode</span>
                      <p className="text-[10px] text-stone-950 mt-0.5">When off, the agent toggle is hidden from the companion</p>
                    </div>
                    <button
                      onClick={() => onAgentEnabledChange(!agentEnabled)}
                      className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"
                      style={{
                        backgroundColor: agentEnabled ? '#f97316' : '#44403c',
                        color: agentEnabled ? '#fff' : LIGHT_INK,
                      }}
                    >
                      {agentEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  {/* Auto-approve threshold */}
                  {agentEnabled && (
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-900">Auto-Approve</span>
                        <p className="text-[10px] text-stone-950 mt-0.5">Controls when changes are applied without review</p>
                      </div>
                      <div className="flex gap-1">
                        {[
                          { key: 'always_ask', label: 'Always Ask' },
                          { key: 'minor', label: 'Minor Edits' },
                          { key: 'all', label: 'All' },
                        ].map(opt => (
                          <button
                            key={opt.key}
                            onClick={() => onAutoApproveChange(opt.key)}
                            className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                            style={{
                              backgroundColor: autoApprove === opt.key ? '#f97316' : 'rgba(120, 70, 30, 0.45)',
                              color: autoApprove === opt.key ? '#fff' : LIGHT_INK,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Auto-approve "all" warning */}
                  {agentEnabled && autoApprove === 'all' && (
                    <div className="p-3 rounded-sm border border-red-700/50" style={{ backgroundColor: 'rgba(153, 27, 27, 0.2)' }}>
                      <p className="text-[11px] text-red-700 font-bold leading-relaxed">
                        Warning: All agent edits will be applied immediately without review. Use with caution.
                      </p>
                    </div>
                  )}

                  {/* Scope restrictions — locked subjects */}
                  {agentEnabled && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-900 block mb-2">Scope Restrictions</span>
                      <p className="text-[10px] text-stone-950 mb-3">Lock subjects to prevent the agent from editing them. Select a course to see its subjects.</p>

                      {/* Course selector */}
                      <div className="flex gap-2 mb-3 flex-wrap">
                        {softwareList.map(sw => (
                          <button
                            key={sw.slug}
                            onClick={() => handleLoadSubjectsForSoftware(sw.slug)}
                            className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                            style={{
                              backgroundColor: 'rgba(120, 70, 30, 0.45)',
                              color: '#1c1917',
                            }}
                          >
                            {sw.name}
                          </button>
                        ))}
                      </div>

                      {/* Subject list with lock toggles */}
                      {subjectList.length > 0 && (
                        <div className="space-y-1 p-3 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)' }}>
                          {subjectList.map(sub => {
                            const isLocked = lockedSubjects?.includes(sub.slug)
                            return (
                              <div key={sub.slug} className="flex items-center justify-between py-1">
                                <span className="text-xs text-stone-900 font-mono flex items-center gap-1.5">
                                  {isLocked && <span title="Locked">🔒</span>}
                                  {sub.title || sub.slug}
                                </span>
                                <button
                                  onClick={() => handleToggleLock(sub.slug)}
                                  className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-sm transition-colors"
                                  style={{
                                    backgroundColor: isLocked ? '#ef4444' : 'rgba(120, 70, 30, 0.45)',
                                    color: isLocked ? '#fff' : LIGHT_INK,
                                  }}
                                >
                                  {isLocked ? 'Unlock' : 'Lock'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Agent system prompt editor */}
                  {agentEnabled && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-stone-900">Agent System Prompt</span>
                        <div className="flex gap-1">
                          {!editingAgentPrompt ? (
                            <button
                              onClick={() => { setAgentPromptDraft(agentSystemPrompt || AGENT_SYSTEM_PROMPT); setEditingAgentPrompt(true); }}
                              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                              style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
                            >
                              Edit
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => { onAgentSystemPromptChange(agentPromptDraft); setEditingAgentPrompt(false); }}
                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                                style={{ backgroundColor: '#f97316', color: '#fff' }}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingAgentPrompt(false)}
                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                                style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: LIGHT_INK }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => { setAgentPromptDraft(AGENT_SYSTEM_PROMPT); }}
                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                                style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: LIGHT_INK }}
                              >
                                Reset
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {editingAgentPrompt ? (
                        <textarea
                          value={agentPromptDraft}
                          onChange={e => setAgentPromptDraft(e.target.value)}
                          className="w-full h-48 px-3 py-2 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
                          style={inputStyle}
                        />
                      ) : (
                        <div className="px-3 py-2 rounded-sm text-[10px] text-stone-950 font-mono leading-relaxed max-h-24 overflow-hidden" style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)' }}>
                          {(agentSystemPrompt || AGENT_SYSTEM_PROMPT).slice(0, 200)}...
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
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

      {/* Version number */}
      <div className="flex justify-start px-6 pb-3">
        <span className="text-xs text-stone-950 font-mono">{wilsonVersion}</span>
      </div>

      {/* Pet Reset Confirmation Modal */}
      {petResetConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div style={{ backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '28px 32px', maxWidth: '400px', width: '90%', textAlign: 'center' }}>
            <h2 style={{ color: '#ea580c', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'monospace' }}>Reset Pet History</h2>
            <p style={{ color: '#a8a29e', fontSize: '12px', lineHeight: '1.5', marginBottom: '20px' }}>
              Reset all pet feedback and interaction history? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => setPetResetConfirm(false)}
                style={{ flex: 1, padding: '8px 16px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', backgroundColor: '#44403c', color: '#a8a29e', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}
              >Cancel</button>
              <button
                onClick={() => { onPetReset(); setPetResetConfirm(false); }}
                style={{ flex: 1, padding: '8px 16px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}
              >Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* New Pet Confirmation Modal */}
      {newPetConfirm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <div style={{ backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', padding: '28px 32px', maxWidth: '400px', width: '90%', textAlign: 'center' }}>
            <h2 style={{ color: '#ea580c', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'monospace' }}>New Pet</h2>
            <p style={{ color: '#a8a29e', fontSize: '12px', lineHeight: '1.5', marginBottom: '20px' }}>
              Create a new egg? Your current ghost will be released.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => setNewPetConfirm(false)}
                style={{ flex: 1, padding: '8px 16px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', backgroundColor: '#44403c', color: '#a8a29e', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}
              >Cancel</button>
              <button
                onClick={() => { onNewPet(); setNewPetConfirm(false); }}
                style={{ flex: 1, padding: '8px 16px', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase', backgroundColor: '#ea580c', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace' }}
              >Create Egg</button>
            </div>
          </div>
        </div>
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
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-sm transition-colors hover:bg-stone-200/40"
      style={{ backgroundColor: 'rgba(120, 70, 30, 0.12)' }}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(name); setEditing(false) }
          }}
          className="flex-1 px-2 py-1 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)', color: '#1c1917', border: '1px solid #d6d3d1' }}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setDraft(name); setEditing(true) }}
          className="flex-1 text-left text-xs font-mono px-2 py-1 rounded-sm hover:bg-stone-200 transition-colors"
          style={{ color: '#1c1917' }}
        >
          {name}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Remove department "${name}"?`)) onRemove()
        }}
        className="p-1 rounded-sm hover:bg-stone-300 transition-colors"
        style={{ color: '#dc2626' }}
        title="Remove department"
      >
        <span className="text-sm font-mono">&times;</span>
      </button>
    </div>
  )
}
