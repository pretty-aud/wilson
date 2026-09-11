// ============================================================
// Settings — AgentSkillsSection
// ============================================================
//
// Renders the contents of the Settings → Agent Skills tab. There
// are two layers per tool:
//
//   1. System prompt editor — backed by `agent-skills.json` via
//      the parent SettingsPage. The textarea shows the effective
//      prompt (override or default) and a Reset button clears
//      the override.
//
//   2. Read-only tool schema viewer — shows the JSON schema for
//      every action the tool exposes to the agent. Source of
//      truth lives in each tool's agent prompt module.
//
//   3. Per-skill on/off checkboxes — backed by
//      `otter-settings.json -> agentSkills`. Tool runtimes
//      consult this state before honoring an action.
//
// `value`            : agentSkills checkbox state ({ otter:[...], rabbit:[...] })
// `onChange`         : checkbox state setter
// `promptOverrides`  : { [toolName]: { systemPromptOverride: string|null } }
// `onPromptOverrideChange(toolName, override|null)`

import { useState } from 'react'
import { AGENT_SKILL_REGISTRY, AGENT_SKILL_TOOLS, defaultAgentSkillsState } from './agentSkillRegistry'

export default function AgentSkillsSection({
  value,
  onChange,
  promptOverrides,
  onPromptOverrideChange,
}) {
  const state = value || defaultAgentSkillsState()
  const overrides = promptOverrides || {}

  const toggle = (toolName, skillId) => {
    const current = state[toolName] || []
    const next = current.includes(skillId)
      ? current.filter(s => s !== skillId)
      : [...current, skillId]
    onChange({ ...state, [toolName]: next })
  }

  const setAll = (toolName, enabled) => {
    const allIds = AGENT_SKILL_REGISTRY[toolName].skills.map(s => s.id)
    onChange({ ...state, [toolName]: enabled ? allIds : [] })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">
          Agent Skills
        </h2>
        <p className="text-xs text-stone-950 mb-4 leading-relaxed">
          Each tool exposes a set of agent capabilities. The system prompt and
          tool schema below describe the agent's contract; the checkboxes are
          a reference list and do not gate anything at runtime. Edits to the
          system prompt persist across sessions and can be reset to the
          default at any time.
        </p>
      </div>

      {AGENT_SKILL_TOOLS.map(toolName => {
        const tool = AGENT_SKILL_REGISTRY[toolName]
        const enabled = state[toolName] || []
        return (
          <ToolBlock
            key={toolName}
            toolName={toolName}
            tool={tool}
            enabled={enabled}
            override={overrides[toolName]?.systemPromptOverride ?? null}
            onPromptChange={(text) =>
              onPromptOverrideChange?.(toolName, text)
            }
            onPromptReset={() => onPromptOverrideChange?.(toolName, null)}
            onToggle={(skillId) => toggle(toolName, skillId)}
            onSetAll={(enabledFlag) => setAll(toolName, enabledFlag)}
          />
        )
      })}
    </div>
  )
}

function ToolBlock({
  toolName,
  tool,
  enabled,
  override,
  onPromptChange,
  onPromptReset,
  onToggle,
  onSetAll,
}) {
  const [showSchema, setShowSchema] = useState(false)
  const promptText = override != null ? override : tool.systemPrompt
  const isOverridden = override != null

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-bold uppercase tracking-widest text-stone-900">
          {tool.label}
        </h3>
        <div className="flex gap-1">
          <button
            onClick={() => onSetAll(true)}
            className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
          >
            All on
          </button>
          <button
            onClick={() => onSetAll(false)}
            className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
          >
            All off
          </button>
        </div>
      </div>
      <p className="text-[11px] text-stone-950 mb-3 leading-relaxed">{tool.description}</p>

      {/* System prompt editor */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700">
            System Prompt
            {isOverridden && (
              <span className="ml-2 text-[9px] text-orange-700">(edited)</span>
            )}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowSchema(s => !s)}
              className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
              style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
            >
              {showSchema ? 'Hide schema' : 'View schema'}
            </button>
            {isOverridden && (
              <button
                onClick={onPromptReset}
                className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
        <textarea
          value={promptText}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full px-3 py-2 text-[11px] font-mono rounded-sm focus:ring-2 focus:ring-orange-500 resize-y"
          style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', lineHeight: '1.5' }}
        />
      </div>

      {/* Tool schema viewer (read-only) */}
      {showSchema && (
        <div className="mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-stone-700 block mb-1">
            Tool Schema (read-only)
          </span>
          <pre
            className="w-full px-3 py-2 text-[10px] font-mono rounded-sm overflow-x-auto"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', lineHeight: '1.45', maxHeight: '300px' }}
          >
{JSON.stringify(tool.toolSchema || [], null, 2)}
          </pre>
        </div>
      )}

      {/* Per-skill on/off checkboxes */}
      <div className="space-y-1 p-3 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)' }}>
        {tool.skills.map(skill => {
          const isOn = enabled.includes(skill.id)
          return (
            <button
              key={skill.id}
              onClick={() => onToggle(skill.id)}
              className="w-full flex items-start gap-3 px-2 py-2 text-left rounded-sm transition-colors hover:bg-stone-800/30"
            >
              <span
                className="flex-shrink-0 w-4 h-4 mt-0.5 flex items-center justify-center rounded-sm border"
                style={{
                  backgroundColor: isOn ? '#f97316' : 'transparent',
                  borderColor:    isOn ? '#f97316' : '#44403c',
                }}
              >
                {isOn && <span className="text-[10px] text-white font-bold">✓</span>}
              </span>
              <span className="flex-1">
                <span className="block text-xs font-bold text-stone-900 font-mono">{skill.label}</span>
                <span className="block text-[10px] text-stone-950 mt-0.5">{skill.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
