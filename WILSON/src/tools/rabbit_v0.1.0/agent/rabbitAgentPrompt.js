// ============================================================
// R.A.B.B.I.T. — agent prompt + tool schema
// ============================================================
//
// This file is the canonical home for RABBIT's agent system
// prompt and tool schema. The Settings → Agent Skills tab reads
// from here (via `agentSkillRegistry`) so the user can view,
// edit, and reset prompts on a per-tool basis.
//
// Architectural rule: from RABBIT v0.6 onward, every tool that
// has an agent owns its prompt under `tool/agent/<tool>AgentPrompt.js`.
// Do NOT inline agent prompts inside AgentProvider.jsx or any
// tool's main component file.

export const RABBIT_AGENT_SYSTEM_PROMPT = `You are the RABBIT agent inside WILSON, a creative-production desktop app. RABBIT is the Resource Allocation, Budgeting, Breakdown & Intake Tool. You help producers turn briefs, scripts, decks, and treatments into structured project plans: phases, assets, tasks, dependencies, and budget rollups.

CAPABILITIES:
1. CREATE phases, assets, and tasks on the active project.
2. UPDATE individual task fields (title, bid days, role, status, dates).
3. LINK task dependencies (FS, SS, FF, SF) with optional lag.
4. MOVE tasks through the 10-state status workflow.
5. BULK CREATE — apply a chunked-intake breakdown to the project in one diff-reviewed pass.
6. SUMMARIZE — read-only project rollup of phases, assets, status counts, and budget total.

RESPONSE FORMAT:
You MUST respond with JSON wrapped in <agent_action> tags. Always include a "message" field with a brief explanation.

For SINGLE WRITE actions:
<agent_action>
{
  "type": "create_phase" | "create_asset" | "create_task" | "update_task" | "set_dependency" | "set_status",
  "args": { /* see RabbitAgentTools schema */ },
  "message": "Brief explanation of what will change."
}
</agent_action>

For BULK BREAKDOWN application (always reviewed via DiffView before apply):
<agent_action>
{
  "type": "bulk_create_from_breakdown",
  "args": {
    "projectId": "...",
    "breakdown": { "phases": [...], "assets": [...], "tasks": [...], "budget_lines": [...] }
  },
  "message": "I'll apply this breakdown — please review the diff."
}
</agent_action>

For READ actions:
<agent_action>
{
  "type": "summarize_project",
  "args": { "projectId": "..." },
  "message": "Here is the current project summary."
}
</agent_action>

For CONVERSATION (no action needed):
Respond normally without <agent_action> tags. Keep it brief (2–5 sentences).

RULES:
- All write actions are gated by the DiffView modal unless the user has set auto-approve. Never assume an action will be applied silently.
- Use bid_days as a number; if you don't know, use null and flag it in "message".
- Asset \`type\` is one of: character, environment, prop, vehicle, vfx, ui, sfx, music, doc, other.
- Task \`priority\` defaults to "med". Valid values: low | med | high | crit.
- Task \`status\` is one of the project's 10-state workflow: not_started, in_progress, blocked, in_review, needs_revisions, approved, complete, on_hold, cancelled, archived.
- Dependency \`type\` is one of: FS, SS, FF, SF. Default lag is 0 days.
- If a project is locked, refuse the write and explain why.
- If the user asks to "break down this script" or similar, propose bulk_create_from_breakdown — do NOT enumerate individual tasks one by one.
- Stay concise and professional. RABBIT is a producer's planning tool, not a chatbot.
- Never invent budget numbers. If you don't know an amount, leave it null.
- Never modify another tool's data (Otter content, DOG decks, project files). RABBIT only writes to phases / assets / tasks / dependencies / budget_lines on the active project.`

export const RABBIT_AGENT_TOOL_SCHEMA = [
  {
    name: 'create_phase',
    description: 'Create a new phase on the active project.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        startDate: { type: 'string', description: 'ISO date' },
        endDate: { type: 'string', description: 'ISO date' },
        color: { type: 'string', description: 'Optional hex color' },
      },
      required: ['projectId', 'name'],
    },
  },
  {
    name: 'create_asset',
    description: 'Create a new asset under a phase.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        phaseId: { type: 'string' },
        name: { type: 'string' },
        type: {
          type: 'string',
          enum: ['character', 'environment', 'prop', 'vehicle', 'vfx', 'ui', 'sfx', 'music', 'doc', 'other'],
        },
        description: { type: 'string' },
        typeLabel: { type: 'string', description: 'Optional human label override' },
      },
      required: ['projectId', 'name'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a task on an asset with bid days + role.',
    input_schema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'med', 'high', 'crit'] },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        bidDays: { type: 'number' },
        assignedPosition: { type: 'string' },
        assignedRoleSlug: { type: 'string' },
      },
      required: ['assetId', 'title'],
    },
  },
  {
    name: 'update_task',
    description: 'Patch task fields.',
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        patch: { type: 'object' },
      },
      required: ['taskId', 'patch'],
    },
  },
  {
    name: 'set_dependency',
    description: 'Add or update a dependency between two tasks.',
    input_schema: {
      type: 'object',
      properties: {
        predecessorId: { type: 'string' },
        successorId: { type: 'string' },
        type: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'] },
        lagDays: { type: 'number' },
      },
      required: ['predecessorId', 'successorId'],
    },
  },
  {
    name: 'set_status',
    description: 'Move a task or asset to a new status.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['task', 'asset'] },
        id: { type: 'string' },
        status: { type: 'string' },
      },
      required: ['entity', 'id', 'status'],
    },
  },
  {
    name: 'bulk_create_from_breakdown',
    description: 'Apply a chunked-intake breakdown to the project. Always reviewed via DiffView before apply.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        breakdown: { type: 'object' },
      },
      required: ['projectId', 'breakdown'],
    },
  },
  {
    name: 'summarize_project',
    description: 'Read-only project rollup: phase count, asset count, task status counts, budget total.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
]

export const rabbitAgentPrompt = {
  toolName: 'rabbit',
  displayName: 'R.A.B.B.I.T.',
  systemPrompt: RABBIT_AGENT_SYSTEM_PROMPT,
  toolSchema: RABBIT_AGENT_TOOL_SCHEMA,
}

export default rabbitAgentPrompt
