// ============================================================
// Settings — agentSkillRegistry
// ============================================================
//
// From RABBIT v0.6 onward, all tool agent system prompts live in
// this registry. When adding a new tool with an agent, create an
// `{toolname}AgentPrompt.js` file in the tool's `agent/` folder
// and import it here. Do NOT inline agent prompts inside tool
// components or AgentProvider.jsx.
//
// The registry has two layers:
//
//   1. AGENT_SKILL_REGISTRY  — per-tool { displayName, systemPrompt,
//      toolSchema, skills: [...] }. The Agent Skills section reads
//      from here for both the prompt editor (top) and the per-skill
//      checkbox grid (bottom).
//
//   2. Effective prompts — `getEffectivePrompt(toolName, overrides)`
//      merges baked-in defaults with the user's edits stored in
//      `userData/otter-data/agent-skills.json` (loaded by SettingsPage
//      via /api/agent-skills). The agent runtime uses this getter so
//      future skills can be added without hardcoding.

import { otterAgentPrompt } from '../../tools/otter_v0.3.1/agent/otterAgentPrompt'
import { rabbitAgentPrompt } from '../../tools/rabbit_v0.1.0/agent/rabbitAgentPrompt'

export const AGENT_SKILL_REGISTRY = {
  otter: {
    label: otterAgentPrompt.displayName,
    description: 'Lesson editing, subject generation, and course generation.',
    systemPrompt: otterAgentPrompt.systemPrompt,
    toolSchema:   otterAgentPrompt.toolSchema,
    skills: [
      {
        id: 'edit',
        label: 'Edit lesson content',
        description: 'Apply small text-level edits to a lesson with diff review.',
        defaultEnabled: true,
      },
      {
        id: 'bulk_edit',
        label: 'Bulk edits across lessons',
        description: 'Walk multiple lessons in one pass — reviewed one diff at a time.',
        defaultEnabled: true,
      },
      {
        id: 'generate_subject',
        label: 'Generate a new subject',
        description: 'Create a brand-new subject card with full lessons + hotkeys.',
        defaultEnabled: true,
      },
      {
        id: 'generate_course',
        label: 'Generate a new course',
        description: 'Create a software/language course with 5-10 subject stubs.',
        defaultEnabled: true,
      },
    ],
  },
  rabbit: {
    label: rabbitAgentPrompt.displayName,
    description: 'Project breakdown, scheduling, and budget operations.',
    systemPrompt: rabbitAgentPrompt.systemPrompt,
    toolSchema:   rabbitAgentPrompt.toolSchema,
    skills: [
      {
        id: 'create_phase',
        label: 'Create phase',
        description: 'Add a new phase to the active project.',
        defaultEnabled: true,
      },
      {
        id: 'create_asset',
        label: 'Create asset',
        description: 'Add a new asset under a phase.',
        defaultEnabled: true,
      },
      {
        id: 'create_task',
        label: 'Create task',
        description: 'Add a task to an asset with bid days + role.',
        defaultEnabled: true,
      },
      {
        id: 'update_task',
        label: 'Update task',
        description: 'Edit task fields (title, bid days, role, status, dates).',
        defaultEnabled: true,
      },
      {
        id: 'set_dependency',
        label: 'Link task dependencies',
        description: 'Add or remove FS/SS/FF/SF links between tasks.',
        defaultEnabled: true,
      },
      {
        id: 'set_status',
        label: 'Change task status',
        description: 'Move tasks through the 10-state workflow.',
        defaultEnabled: true,
      },
      {
        id: 'bulk_create_from_breakdown',
        label: 'Bulk create from breakdown',
        description: 'Apply a chunked-intake breakdown to the project in one pass.',
        defaultEnabled: true,
      },
      {
        id: 'summarize_project',
        label: 'Summarize project',
        description: 'Read-only summary of phases, assets, status, and budget.',
        defaultEnabled: true,
      },
    ],
  },
}

export const AGENT_SKILL_TOOLS = Object.keys(AGENT_SKILL_REGISTRY)

/**
 * The shape stored in `userData/otter-data/agent-skills.json`:
 *
 *   {
 *     [toolName]: {
 *       systemPromptOverride: string | null,
 *     }
 *   }
 *
 * The user toggles for individual skill IDs continue to live under
 * `otter-settings.json -> agentSkills` (separate concern, separate file).
 */

/**
 * Compute the default enabled-skill set for every tool. Used as the
 * fallback when settings are missing the `agentSkills` block.
 */
export function defaultAgentSkillsState() {
  const out = {}
  for (const toolName of AGENT_SKILL_TOOLS) {
    out[toolName] = AGENT_SKILL_REGISTRY[toolName].skills
      .filter(s => s.defaultEnabled)
      .map(s => s.id)
  }
  return out
}

/**
 * `state` shape: `{ otter: ['edit', ...], rabbit: ['create_phase', ...] }`.
 */
export function isSkillEnabled(state, toolName, skillId) {
  if (!state?.[toolName]) {
    return AGENT_SKILL_REGISTRY[toolName]?.skills.find(s => s.id === skillId)?.defaultEnabled ?? false
  }
  return state[toolName].includes(skillId)
}

/**
 * Resolve the effective system prompt for a given tool, layering
 * the user's persisted override on top of the baked-in default.
 *
 * @param {string} toolName
 * @param {{ [k: string]: { systemPromptOverride?: string|null } } | null} overrides
 * @returns {string}
 */
export function getEffectivePrompt(toolName, overrides) {
  const entry = AGENT_SKILL_REGISTRY[toolName]
  if (!entry) return ''
  const override = overrides?.[toolName]?.systemPromptOverride
  if (typeof override === 'string' && override.trim().length > 0) {
    return override
  }
  return entry.systemPrompt
}

/**
 * Convenience flat array (per §9.2 spec) for any UI that wants to
 * iterate prompt entries directly without keying by name.
 */
export const agentSkillRegistry = AGENT_SKILL_TOOLS.map(toolName => ({
  toolName,
  displayName: AGENT_SKILL_REGISTRY[toolName].label,
  systemPrompt: AGENT_SKILL_REGISTRY[toolName].systemPrompt,
  toolSchema:   AGENT_SKILL_REGISTRY[toolName].toolSchema,
}))
