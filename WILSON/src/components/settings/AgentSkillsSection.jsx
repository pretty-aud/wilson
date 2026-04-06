// ============================================================
// Settings — AgentSkillsSection
// ============================================================
//
// Renders the contents of the Settings → Agent Skills tab.
// Per-tool checkboxes drive an `agentSkills` shape persisted
// inside otter-settings.json. Each tool runtime checks the
// persisted state before honoring an action.

import { AGENT_SKILL_REGISTRY, AGENT_SKILL_TOOLS, defaultAgentSkillsState } from './agentSkillRegistry'

export default function AgentSkillsSection({ value, onChange }) {
  const state = value || defaultAgentSkillsState()

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
          Each tool exposes a set of agent capabilities. Disable a skill here to
          tell the agent it cannot use that action — useful for read-only
          sessions or when training a new tool.
        </p>
      </div>

      {AGENT_SKILL_TOOLS.map(toolName => {
        const tool = AGENT_SKILL_REGISTRY[toolName]
        const enabled = state[toolName] || []
        return (
          <div key={toolName}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-stone-900">
                {tool.label}
              </h3>
              <div className="flex gap-1">
                <button
                  onClick={() => setAll(toolName, true)}
                  className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
                >
                  All on
                </button>
                <button
                  onClick={() => setAll(toolName, false)}
                  className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: 'rgba(120, 70, 30, 0.45)', color: '#1c1917' }}
                >
                  All off
                </button>
              </div>
            </div>
            <p className="text-[11px] text-stone-950 mb-3 leading-relaxed">{tool.description}</p>

            <div className="space-y-1 p-3 rounded-sm" style={{ backgroundColor: 'rgba(120, 70, 30, 0.35)' }}>
              {tool.skills.map(skill => {
                const isOn = enabled.includes(skill.id)
                return (
                  <button
                    key={skill.id}
                    onClick={() => toggle(toolName, skill.id)}
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
      })}
    </div>
  )
}
