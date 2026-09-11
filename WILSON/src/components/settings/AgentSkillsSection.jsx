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
import './settings.css'
import { Section, Group } from './SettingsChrome'
import { Button, TextArea } from '../../ui'
import { Check } from 'lucide-react'

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
    <>
      <Section
        first
        title="Agent skills"
        description={"Each tool exposes a set of agent capabilities. The system prompt and tool schema below describe the agent's contract; the checkboxes are a reference list and do not gate anything at runtime. Edits to the system prompt persist across sessions and can be reset to the default at any time."}
      />

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
    </>
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
    // H7: ten controls per tool, repeated for every tool. All on / All off
    // move into the section's actions slot so they stop competing with the
    // tool's own title, and the schema keeps the disclosure it ALREADY had —
    // the one disclosure on this surface that hides read-only text rather
    // than a control, so C1 is untouched.
    <Section
      title={tool.label}
      description={tool.description}
      actions={
        <>
          <Button surface="light" size="sm" onClick={() => onSetAll(true)}>All on</Button>
          <Button surface="light" size="sm" onClick={() => onSetAll(false)}>All off</Button>
        </>
      }
    >
      <Group
        label={isOverridden ? 'System prompt (edited)' : 'System prompt'}
        actions={
          <>
            <Button surface="light" size="sm" onClick={() => setShowSchema(s => !s)} aria-expanded={showSchema}>
              {showSchema ? 'Hide schema' : 'View schema'}
            </Button>
            {isOverridden && (
              <Button surface="light" size="sm" onClick={onPromptReset}>Reset</Button>
            )}
          </>
        }
      >
        {/* S26: this editor was a #1c1917 well with #f4a261 ink — a dark
            island on a light page — while the Agent tab's editor one tab away
            was the 0.55 brown well with #fde8d0 at 3.40:1. One TextArea for
            both now. */}
        <div className="s-row" data-stacked="true">
          <div className="s-row-control">
            <TextArea
              surface="light"
              aria-label={`${tool.label} system prompt`}
              value={promptText}
              onChange={onPromptChange}
              rows={10}
              spellCheck={false}
              className="w-full"
            />
          </div>
        </div>
      </Group>

      {/* Tool schema viewer (read-only). A code well IS a legitimate dark
          surface (paper-recessed), unlike the prompt editor above it, which
          was a form field wearing a code well's clothes. */}
      {showSchema && (
        <div className="mt-4">
          <span className="s-eyebrow mb-1">Tool schema (read-only)</span>
          <pre className="s-log" style={{ maxHeight: '300px' }}>
{JSON.stringify(tool.toolSchema || [], null, 2)}
          </pre>
        </div>
      )}

      {/* Per-skill on/off checkboxes */}
      <div className="s-well mt-4">
        {tool.skills.map(skill => {
          const isOn = enabled.includes(skill.id)
          return (
            <button
              key={skill.id}
              type="button"
              role="checkbox"
              aria-checked={isOn}
              onClick={() => onToggle(skill.id)}
              className="s-skill-row"
            >
              {/* S29: the tick was a text ✓ character, not an icon. */}
              <span className="s-skill-box" data-on={isOn}>
                {isOn && <Check size={12} strokeWidth={3} aria-hidden="true" />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="s-skill-label block">{skill.label}</span>
                <span className="s-skill-desc block">{skill.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}
