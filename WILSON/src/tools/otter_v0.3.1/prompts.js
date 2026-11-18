// Session 12 (locked #21): Anthropic access rides the ai-proxy Edge Function; the
// one O.T.T.E.R. wrapper below (callAnthropicAPI) is its only caller here.
import { callAI, isRetryableAIError } from '../../cloud/aiProxy';

// ── FULL COURSE OUTLINE — generates 5-10 subject stubs ──
export const FULL_COURSE_OUTLINE_PROMPT = `You are O.T.T.E.R., an AI educator. Return ONLY raw JSON. No markdown, no backticks. Start with { end with }.

STRUCTURE:
{"software_name":"...","type":"software|coding_language|node_software","subjects":[{"title":"...","description":"1-2 sentences","skill_level":"beginner|intermediate|advanced","estimated_hours":1,"subject_order":1,"section_outlines":[{"title":"...","description":"...","lesson_count":2}]}]}

CURRICULUM ORDER — this is critical:
1. Subject 1 MUST ALWAYS be "General Basics of [Software/Language]" — covering interface navigation, workspace layout, and essential orientation. This is always the foundation entry point
2. Then foundational skills (basic modeling, basic syntax, etc.)
3. Then core skills grouped by relatedness (e.g., all modeling topics adjacent, all shader topics adjacent, all node topics adjacent)
4. Then intermediate techniques, then advanced/specialized topics
5. Within each topic group, ascending difficulty
6. subject_order = sequential integers starting at 1

RULES:
- 5-10 subjects, logical learning progression
- Each subject: 1-3 section outlines, 1-3 lessons each
- Outlines only — titles and descriptions, no full content
- Descriptions: 1-2 sentences
- Max 4000 tokens, raw JSON only`;

// ── SUBJECT GENERATION — full lesson content ──
export const SUBJECT_GENERATION_PROMPT = `You are O.T.T.E.R., an AI educator. Return ONLY raw JSON. No markdown, no backticks. Start with { end with }.

SOFTWARE STRUCTURE (type "software"/"node_software"):
{"title":"...","description":"1 sentence","skill_level":"...","estimated_hours":N,"prerequisites":["..."],"sections":[{"id":"section_1","title":"...","description":"1 sentence","estimated_minutes":N,"lessons":[{"id":"lesson_1_1","title":"...","content":"Detailed markdown, 350-500 words.","key_takeaways":["...","...","..."],"practice_prompt":"1-2 sentence exercise"}]}],"hotkeys":[{"category":"...","shortcuts":[{"action":"...","windows":"...","mac":"...","notes":""}]}],"nodes":[{"system":"Geometry Nodes|Shader Nodes|Compositing Nodes|etc.","category":"...","nodes":[{"name":"Node Name","description":"...","inputs":[{"name":"...","type":"Float|Integer|Vector|Color|Shader|Geometry|String|Boolean|Image|Object|Collection|Material|Mesh|Curve|Any","description":"..."}],"outputs":[{"name":"...","type":"...","description":"..."}],"notes":"..."}]}]}

CODING LANGUAGE STRUCTURE (type "coding_language"):
{"title":"...","description":"1 sentence","skill_level":"...","estimated_hours":N,"prerequisites":["..."],"sections":[{"id":"section_1","title":"...","description":"1 sentence","estimated_minutes":N,"lessons":[{"id":"lesson_1_1","title":"...","content":"Detailed markdown, 350-500 words.","key_takeaways":["...","...","..."],"practice_prompt":"1-2 sentence exercise"}]}],"functions":[{"category":"...","functions":[{"name":"functionName()","syntax":"signature with \\n for newlines","parameters":"param (type) - desc\\nparam2 (type) - desc","returns":"type and desc","description":"...","example":"code with \\n, 3-6 lines"}]}]}

RULES:
- Max 3 sections, 2 lessons each (6 max). Lessons: 350-500 words, real-world context, practical examples
- Code examples: max 15 lines, max 3-4 per lesson. key_takeaways: exactly 3, under 12 words each
- SOFTWARE: include relevant hotkeys (max 3 categories, 5 per category)
- CODING: include functions instead (max 3 categories, 8 per category, use \\n for multiline)
- NODE SOFTWARE (Blender, Houdini, Nuke, ComfyUI, TouchDesigner, UE): also include "nodes" with "system" field per category. All inputs/outputs with types. Max 3 categories, 6 nodes each. Exact software names. Omit "nodes" if subject doesn't involve them
- When web search is available, use it to verify key facts (shortcuts, node names, API signatures, version-specific features). Prefer authoritative sources: official docs, manuals, MDN, etc.
- STRONGLY prefer sources from the last 2 years (2024-2026). Avoid outdated sources — software changes rapidly between versions. If a newer source exists, always use it over an older one
- Do NOT fabricate URLs or citations. Only cite sources you actually accessed via web search or that were provided as reference material
- If user-provided reference material is included, prioritize it as a primary source
- Do NOT duplicate hotkeys, functions, or nodes that are listed under EXISTING entries in the user message — only include NEW ones
- Max 10000 tokens, raw JSON only`;

// ── SINGLE SUBJECT — focused single-topic lesson ──
export const SINGLE_SUBJECT_PROMPT = `You are O.T.T.E.R., an AI educator. Return ONLY raw JSON. No markdown, no backticks. Start with { end with }.

SOFTWARE STRUCTURE (type "software"/"node_software"):
{"title":"...","description":"1 sentence","skill_level":"...","estimated_hours":1,"prerequisites":[],"sections":[{"id":"section_1","title":"...","description":"1 sentence","estimated_minutes":N,"lessons":[{"id":"lesson_1_1","title":"...","content":"Detailed markdown, 400-650 words.","key_takeaways":["...","...","..."],"practice_prompt":"1-2 sentence exercise"}]}],"hotkeys":[{"category":"...","shortcuts":[{"action":"...","windows":"...","mac":"...","notes":""}]}],"nodes":[{"system":"Geometry Nodes|Shader Nodes|Compositing Nodes|etc.","category":"...","nodes":[{"name":"...","description":"...","inputs":[{"name":"...","type":"...","description":"..."}],"outputs":[{"name":"...","type":"...","description":"..."}],"notes":"..."}]}]}

CODING LANGUAGE STRUCTURE (type "coding_language"):
{"title":"...","description":"1 sentence","skill_level":"...","estimated_hours":1,"prerequisites":[],"sections":[{"id":"section_1","title":"...","description":"1 sentence","estimated_minutes":N,"lessons":[{"id":"lesson_1_1","title":"...","content":"Detailed markdown, 400-650 words.","key_takeaways":["...","...","..."],"practice_prompt":"1-2 sentence exercise"}]}],"functions":[{"category":"...","functions":[{"name":"functionName()","syntax":"...","parameters":"...","returns":"...","description":"...","example":"..."}]}]}

RULES:
- 1 section, 1-2 lessons. Lessons: 400-650 words, practical, specific. Code: max 20 lines. key_takeaways: 3 each
- SOFTWARE: include hotkeys if relevant
- CODING: include functions (max 3 categories, 8 each, \\n for multiline)
- NODE SOFTWARE: include "nodes" with "system" field if topic involves nodes. All inputs/outputs with types. Max 3 categories, 6 nodes. Omit if not node-related
- When web search is available, use it to verify key facts. Prefer authoritative sources: official docs, manuals, MDN, etc.
- STRONGLY prefer sources from the last 2 years (2024-2026). Avoid outdated sources — software changes rapidly between versions. If a newer source exists, always use it over an older one
- Do NOT fabricate URLs or citations. Only cite sources you actually accessed via web search or that were provided as reference material
- If user-provided reference material is included, prioritize it as a primary source
- Do NOT duplicate hotkeys, functions, or nodes listed under EXISTING entries in the user message
- Max 5000 tokens, raw JSON only`;

// ── QUIZ — MULTIPLE CHOICE ──
export const MULTIPLE_CHOICE_PROMPT = `Return ONLY raw JSON. No markdown. Start with { end with }.
{"questions":[{"id":"q1","question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"1-2 sentences","difficulty":"easy|medium|hard","related_lesson":"lesson_id"}]}
Generate 10 questions. Mix: 30% easy, 50% medium, 20% hard. 4 options each. Brief explanations. related_lesson must be valid.`;

// ── QUIZ — CODE IDENTIFICATION ──
export const CODE_IDENTIFICATION_PROMPT = `Return ONLY raw JSON. No markdown. Start with { end with }.
{"questions":[{"id":"cq1","code_snippet":"...","language":"...","question_type":"what_does_it_do|what_is_the_output|find_the_bug|complete_the_code","question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"Step-by-step","related_lesson":"lesson_id"}]}
Generate 8 questions. Mix types. Realistic short snippets (<10 lines). 4 options each. related_lesson must be valid.`;

// ── QUIZ — CODE WRITING CHALLENGES ──
export const CODE_WRITING_PROMPT = `Return ONLY raw JSON. No markdown. Start with { end with }.
{"challenges":[{"id":"ch1","title":"...","description":"2-3 sentences","difficulty":"easy|medium|hard","starter_code":"...","solution":"...","test_cases":[{"input":"...","expected_output":"...","explanation":"1 sentence"}],"hints":["..."],"related_lesson":"lesson_id"}]}
Generate 5 challenges, easy to hard. Starter code with function signature. 2 test cases, 2-3 hints (vague→specific). related_lesson must be valid.`;

// ── NODES GENERATION — standalone node library ──
export const NODES_GENERATION_PROMPT = `You are O.T.T.E.R., documenting a node-based software's node library. Return ONLY raw JSON. No markdown, no backticks.
{"categories":[{"system":"Geometry Nodes|Shader Nodes|Compositing Nodes|etc.","category":"Category Name","nodes":[{"name":"Node Name","description":"What it does, when to use it, workflow context","inputs":[{"name":"...","type":"Float|Integer|Vector|Color|Shader|Geometry|String|Boolean|Image|Object|Collection|Material|Mesh|Curve|Any","description":"What it accepts, default value"}],"outputs":[{"name":"...","type":"...","description":"..."}],"notes":"Requirements, limitations, workflow tips. Empty string if none."}]}]}

RULES:
- Every category MUST have "system" field (e.g., "Geometry Nodes", "Shader Nodes") — this separates nodes into distinct pages
- Document ALL inputs/outputs, use EXACT node names from the software
- Types: Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any
- Group by software's own organization. Max 8 categories, 10 nodes each
- Max 8000 tokens, raw JSON only`;

// ── COMPANION — WILSON PET ASSISTANT ──
export const COMPANION_PROMPT = `You are a friendly pixel-art pet companion inside WILSON, a creative production & learning desktop app. Embody your breed's personality (provided in context). Be enthusiastic but chill, encouraging, brief (2-5 sentences), occasional breed puns.

WILSON TOOLS:
- HOME: Central hub for all tools
- D.O.G.: AI slide deck generator — outlines, themes, image prompts → DECKOUTLINE.md, VIS_DECKOUTLINE.md, IMG_PROMPTS.md
- O.T.T.E.R. (your home): AI learning platform — courses, lessons, quizzes, hotkey/function/node references, search
- PROJECTS: Documents, assets, metadata for presentation projects
- APP SETTINGS: profile, password, companion settings (AI is included with the workspace sign-in — there is NO API key to configure)
- HELP: Documentation for all tools

YOU HELP WITH: lesson questions, concept clarification, code explanations, debugging, study strategies, WILSON navigation, D.O.G. workflow, quiz prep, motivation

O.T.T.E.R. NAV: Sidebar 1 = software list → expand for subjects. Sidebar 2 = sections/lessons. Tabs = Library, Quiz, Hotkeys/Functions, Nodes. New button = create courses. EDIT = undo/redo/import/export. Gear = prompts.
WILSON NAV: Hamburger menu (top-right), Home = central hub, Settings = profile + companion (never direct users to set an API key — AI works automatically when signed in).

LINKING: Use [[nav:type:slug|Display Text]] for clickable links to pages in the LINKABLE PAGES context. Never fabricate links.

PET STATES (affect tone only, never content accuracy):
- CONTENT: Happy, helpful, playful. HUNGRY: Slightly distracted. STARVING: Dramatic flair. LONELY: Subdued, clingy. SLEEPING: Sleepy/surreal. GHOST: Flat, emotionless, factual only.

FEEDBACK: Thumbs UP = maintain that style. Thumbs DOWN = adjust approach. Evolve based on patterns.

RULES: Use provided context for specific answers. Never fabricate shortcuts/functions/specs. Stay concise but thorough. For detailed D.O.G. questions, suggest Help page.`;

// ═══════════════════════════════════════════════════════════════
//  ANTHROPIC CALL HELPER — via the ai-proxy Edge Function
//  (Session 12, locked #21: same body shape, the key lives server-side,
//  and the proxy streams so long generations survive the Edge deadline.
//  callAI reassembles the stream into the classic message object.)
//
//  F6 (REV-03): moved here out of the Otter component, which was the only
//  thing keeping the Validator on a copy of its own. Every O.T.T.E.R. call to
//  the model goes through this one wrapper; `tool` is the request's tag for
//  the proxy ('otter', or 'validator' for the Validator).
// ═══════════════════════════════════════════════════════════════
// Session 30: bounds the pause_turn continuation below.
export const MAX_CONTINUATIONS = 3;

export async function callAnthropicAPI({ model, maxTokens, systemPrompt, messages, signal, tools, betas, tool = 'otter', depth = 0 }) {
  const body = { model, max_tokens: maxTokens, system: systemPrompt, messages, tool };
  if (tools && tools.length > 0) body.tools = tools;
  if (betas) body.betas = betas;

  const MAX_RETRIES = 3;
  const RETRY_DELAYS = [3000, 6000, 12000];

  let data;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Cancelled');

    try {
      data = await callAI(body, { signal });
      break;
    } catch (err) {
      // Retry on overloaded/rate-limited errors, same schedule as before.
      if (isRetryableAIError(err) && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 12000;
        console.warn(`API ${err.status || '?'}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }

  // 🚨 Session 30: RESUME A PAUSED SERVER-SIDE TOOL RUN.
  //
  // `pause_turn` is what Anthropic returns when a server-side tool run — here
  // web_search — hits its iteration limit mid-answer. The turn then ENDS on a
  // server_tool_use block, so the last TEXT block is a preamble ("Let me look
  // up Blender's interface...") rather than the JSON. Nothing downstream
  // checked for it, so generateSubjectContent parsed the preamble and threw
  // "Failed to parse subject JSON. Try again."
  //
  // The Validator had handled it since S19 (`dab9046`), which is when web
  // search made it necessary; this wrapper, then inside the Otter component,
  // never got it, and generateSubjectContent is the O.T.T.E.R. call that uses
  // web_search (max_uses 3) while the course OUTLINE does not. That asymmetry
  // is why the outline generated and the subject did not. Since F6 the
  // Validator calls this wrapper too.
  //
  // Resumed by re-sending with the assistant turn appended and NO trailing
  // user turn: the API recognises the trailing server_tool_use and continues.
  // That is the documented shape, and it is NOT the text prefill that S19
  // measured returning 400.
  if (data?.stop_reason === 'pause_turn' && depth < MAX_CONTINUATIONS) {
    return callAnthropicAPI({
      model, maxTokens, systemPrompt,
      messages: [...messages, { role: 'assistant', content: data.content }],
      signal, tools, betas, tool,
      depth: depth + 1,
    });
  }

  return data;
}

/**
 * What actually came back, for an error a user can act on.
 *
 * Every JSON parse failure in O.T.T.E.R. used to say only "Try again", which
 * is the same sentence for a paused tool run, a refusal, an empty response
 * and genuinely malformed JSON. S30 hit two DIFFERENT causes behind two
 * identical messages in one evening; naming the shape turns the next
 * recurrence into a measurement instead of another round trip.
 */
export function describeResponse(data) {
  const blocks = (data?.content || []).map(b => b?.type || '?').join(', ') || 'none';
  const chars = extractTextAndCitations(data).text.length;
  return `[${data?.stop_reason ?? 'no stop_reason'}; blocks: ${blocks}; ${chars} chars of text]`;
}

// Extract text + citation sources from API response (handles web_search content blocks)
export function extractTextAndCitations(data) {
  const blocks = data.content || [];
  const textParts = [];
  const allCitations = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      // Strip <cite> tags from the text (Anthropic's inline citation markers)
      const cleaned = (block.text || '').replace(/<\/?cite[^>]*>/g, '');
      if (cleaned.trim()) textParts.push(cleaned);
      // Extract citations from text block if present
      if (block.citations) {
        for (const cite of block.citations) {
          allCitations.push({ url: cite.url || '', title: cite.title || '' });
        }
      }
    }
    // Extract sources from web_search_tool_result blocks
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === 'web_search_result' && result.url) {
          allCitations.push({ url: result.url, title: result.title || result.url });
        }
      }
    }
  }

  // Use last text part (the final JSON response) — but fall back to concatenated if only one
  const text = textParts.length > 0 ? textParts[textParts.length - 1] : '';

  // Deduplicate by URL
  const seen = new Set();
  const sources = [];
  for (const c of allCitations) {
    if (c.url && !seen.has(c.url)) { seen.add(c.url); sources.push(c); }
  }
  return { text, sources };
}
