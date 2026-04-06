import { useState, useEffect } from 'react'
import { PET_BREEDS } from './sprites/index'
import { AGENT_SYSTEM_PROMPT } from '../agent/agentPrompts'
import CurrencyPicker from './settings/CurrencyPicker'
import AgentSkillsSection from './settings/AgentSkillsSection'
import { defaultAgentSkillsState } from './settings/agentSkillRegistry'


export default function SettingsPage({
  apiKey, onApiKeyChange,
  petData, onPetModeToggle, onDifficultyChange, onPetReset, onNewPet,
  // Agent settings (passed via SettingsPageWithAgent wrapper)
  agentEnabled, onAgentEnabledChange,
  autoApprove, onAutoApproveChange,
  lockedSubjects, onLockedSubjectsChange,
  agentSystemPrompt, onAgentSystemPromptChange,
}) {
  const [activeTab, setActiveTab] = useState('general')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState(null)

  // Pet danger zone confirmations
  const [petResetConfirm, setPetResetConfirm] = useState(false)
  const [newPetConfirm, setNewPetConfirm] = useState(false)

  // Agent settings local state
  const [editingAgentPrompt, setEditingAgentPrompt] = useState(false)
  const [agentPromptDraft, setAgentPromptDraft] = useState('')
  const [lockSubjectInput, setLockSubjectInput] = useState('')
  const [subjectList, setSubjectList] = useState([])
  const [softwareList, setSoftwareList] = useState([])

  // RABBIT default currency + agent skills (persisted in otter-settings.json)
  const [rabbitDefaultCurrency, setRabbitDefaultCurrency] = useState('USD')
  const [agentSkills, setAgentSkills] = useState(defaultAgentSkillsState())

  // Load software list for subject lock picker
  useEffect(() => {
    fetch('/api/software').then(r => r.json()).then(list => {
      setSoftwareList(list || [])
    }).catch(() => {})
  }, [])

  // Load Rabbit + agent-skills slices from otter-settings.json on mount.
  useEffect(() => {
    let cancelled = false
    fetch('/api/otter-settings').then(r => r.json()).then(data => {
      if (cancelled) return
      if (data?.rabbit?.defaultCurrency) setRabbitDefaultCurrency(data.rabbit.defaultCurrency)
      if (data?.agentSkills) setAgentSkills({ ...defaultAgentSkillsState(), ...data.agentSkills })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const persistOtterSettings = async (patch) => {
    try {
      const res = await fetch('/api/otter-settings')
      const data = await res.json().catch(() => ({}))
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
      await fetch('/api/otter-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
    } catch {
      /* best effort */
    }
  }

  const handleCurrencyChange = (code) => {
    setRabbitDefaultCurrency(code)
    persistOtterSettings({ rabbit: { defaultCurrency: code } })
  }

  const handleAgentSkillsChange = (next) => {
    setAgentSkills(next)
    persistOtterSettings({ agentSkills: next })
  }

  const handleChangePassword = async () => {
    if (newPassword.length === 0) {
      setPasswordMessage({ type: 'error', text: 'New password cannot be empty' })
      return
    }
    if (newPassword.length > 12) {
      setPasswordMessage({ type: 'error', text: 'Password must be 12 characters or fewer' })
      return
    }
    if (!/^[a-zA-Z0-9]+$/.test(newPassword)) {
      setPasswordMessage({ type: 'error', text: 'Password must contain only letters and numbers' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }
    try {
      const res = await fetch('/api/auth/change', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: currentPassword, newPassword })
      })
      const data = await res.json()
      if (data.ok) {
        setPasswordMessage({ type: 'success', text: 'Password changed successfully' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setPasswordMessage({ type: 'error', text: data.error || 'Failed to change password' })
      }
    } catch {
      setPasswordMessage({ type: 'error', text: 'Failed to save password' })
    }
  }

  const handleLoadSubjectsForSoftware = async (slug) => {
    try {
      const res = await fetch(`/api/software/${slug}/subjects`)
      const list = await res.json()
      setSubjectList(list || [])
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
  const isGhost = form === 'ghost' || form === 'corpse'

  const tabs = [
    { key: 'general', label: 'General' },
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
                  color: activeTab === tab.key ? '#ffffff' : '#57534e',
                  borderBottom: activeTab === tab.key ? '2px solid #f97316' : '2px solid transparent',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-8">

          {/* ═══════════════════════════════════════════════════════════ */}
          {/*  GENERAL TAB                                              */}
          {/* ═══════════════════════════════════════════════════════════ */}
          {activeTab === 'general' && (
            <>
              {/* API Key Section */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Anthropic API Key
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Required for all AI features. Your key is stored in localStorage and never sent anywhere except the Anthropic API.
                </p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  placeholder="sk-ant-api03-..."
                  className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={inputStyle}
                />
                <div className="mt-2 flex items-center gap-3">
                  {apiKey ? (
                    <span className="text-xs text-stone-950">Key is set ({apiKey.length} characters)</span>
                  ) : (
                    <span className="text-xs text-red-700">No API key configured</span>
                  )}
                  {apiKey && (
                    <button
                      onClick={() => onApiKeyChange('')}
                      className="text-xs text-stone-950 hover:text-red-700 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* RABBIT Default Currency */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Default Project Currency
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Used by R.A.B.B.I.T. as the starting currency for new projects and budget rollups.
                  Each project can override this once it's been created.
                </p>
                <CurrencyPicker
                  value={rabbitDefaultCurrency}
                  onChange={handleCurrencyChange}
                />
              </div>

              {/* Companion Section */}
              {petData && (
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                    Companion
                  </h2>
                  <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                    Your AI pet companion appears on every page. Manage pet mode, difficulty, and more.
                  </p>

                  <div className="space-y-4">
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
                          color: petData.petMode ? '#fff' : '#a8a29e',
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
                                color: petData.difficulty === d ? '#fff' : '#a8a29e',
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
                            New Pet
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Password Change Section */}
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
                  Change Password
                </h2>
                <p className="text-xs text-stone-950 mb-4 leading-relaxed">
                  Update the login password. Letters and numbers only, up to 12 characters.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-950 mb-1">
                      Current Password
                    </label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => { setCurrentPassword(e.target.value); setPasswordMessage(null); }}
                      placeholder="Enter current password"
                      className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-950 mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordMessage(null); }}
                      placeholder="Enter new password"
                      className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      style={inputStyle}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-stone-950 mb-1">
                      Retype New Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setPasswordMessage(null); }}
                      placeholder="Retype new password"
                      className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                      style={inputStyle}
                    />
                  </div>

                  <div className="flex items-center gap-4 pt-1">
                    <button
                      onClick={handleChangePassword}
                      className="px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-sm transition-colors"
                      style={{
                        backgroundColor: '#1c1917',
                        color: '#f4a261',
                      }}
                      onMouseEnter={(e) => { e.target.style.backgroundColor = '#292524'; }}
                      onMouseLeave={(e) => { e.target.style.backgroundColor = '#1c1917'; }}
                    >
                      Update Password
                    </button>

                    {passwordMessage && (
                      <span className={`text-xs ${passwordMessage.type === 'success' ? 'text-green-700' : 'text-red-700'}`}>
                        {passwordMessage.text}
                      </span>
                    )}
                  </div>
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
                        color: agentEnabled ? '#fff' : '#a8a29e',
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
                              color: autoApprove === opt.key ? '#fff' : '#a8a29e',
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
                                    color: isLocked ? '#fff' : '#a8a29e',
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
                                style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#a8a29e' }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => { setAgentPromptDraft(AGENT_SYSTEM_PROMPT); }}
                                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                                style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#a8a29e' }}
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
