// ============================================================
// agentPrompts.js — back-compat shim
// ============================================================
//
// As of v0.6 each tool owns its agent prompt under its own folder.
// This file used to hold Otter's prompt directly; it now re-exports
// the Otter prompt from the Otter tool tree under the legacy names
// so existing imports keep working until everything migrates.
//
//   → src/tools/otter_v0.3.1/agent/otterAgentPrompt.js  (Otter)
//   → src/tools/rabbit_v0.1.0/agent/rabbitAgentPrompt.js (RABBIT, Commit 11)

export {
  OTTER_AGENT_SYSTEM_PROMPT as AGENT_SYSTEM_PROMPT,
  OTTER_AGENT_EDIT_CONTEXT  as AGENT_EDIT_CONTEXT,
} from '../tools/otter_v0.3.1/agent/otterAgentPrompt';
