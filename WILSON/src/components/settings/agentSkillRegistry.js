// ============================================================
// Settings — agentSkillRegistry
// ============================================================
//
// Declares which agent capabilities each tool exposes. The
// Settings → Agent Skills tab reads this registry to render
// per-tool checkboxes; tool runtimes (Otter, RABBIT) consult
// the persisted enabled-skills set before honoring an action.
//
// The registry is intentionally a static module — adding a new
// skill means adding a new entry here AND wiring its action
// type into the relevant tool's handler. The registry never
// owns runtime state; the on/off booleans live in
// otter-settings.json under `agentSkills.{toolName}`.

export const AGENT_SKILL_REGISTRY = {
  otter: {
    label: 'O.T.T.E.R.',
    description: 'Lesson editing, subject generation, and course generation.',
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
    label: 'R.A.B.B.I.T.',
    description: 'Project breakdown, scheduling, and budget operations.',
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
