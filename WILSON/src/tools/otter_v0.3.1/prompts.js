// Session 12 (locked #21): Anthropic access rides the ai-proxy Edge Function; the
// one O.T.T.E.R. wrapper below (callAnthropicAPI) is its only caller here.
import { callAI, isRetryableAIError } from '../../cloud/aiProxy';
// The course and subject pipeline below reads O.T.T.E.R.'s answers the house way
// and names functions and slugs as the adapters do (F6).
import { functionEntries, functionCategoryName, slugify, readBody, okBody, needBody } from './adapters/otterRoutes.js';

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

// ═══════════════════════════════════════════════════════════════
//  COURSE OUTLINES AND SUBJECTS — one pipeline (F6, A1)
//
//  O.T.T.E.R.'s five generators were two copies of one pipeline plus a third
//  (generateCourse and agentGenerateCourse; generateSingleSubject and
//  agentGenerateSingleSubject; generateSubjectContent filling a stub), about
//  430 copied lines that had drifted: a takeaway the model sent as one string
//  was kept by the stub fill and dropped by the two single-subject paths; the
//  agent's node hint had lost its type list; the course paths' cut-off
//  sentences differed; the slug rule was inlined eight times beside the
//  imported `slugify`. The request, the parse and the subject record are made
//  here, once. Each path in Otter.jsx keeps what is its own: the guards, the
//  timer and phases, the errors it shows, the navigation, and the SAVE, beside
//  its share reminder (design §5.9), whose judge reads each path's own text
//  (NewSubjectShareReminder.test.jsx). otterGeneration.test.js pins these.
// ═══════════════════════════════════════════════════════════════

/**
 * The model's JSON answer: the text read the house way (the last text block),
 * a code fence stripped, then the whole text or its outermost {...}. A failure
 * says what came back. `what`: 'course outline' or 'subject'.
 */
export function parseModelJson(data, what) {
  const { text: rawText } = extractTextAndCitations(data);
  const text = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  try { return JSON.parse(text); }
  catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); }
      catch { /* the sentence below */ }
    }
    throw new Error(`Failed to parse ${what} JSON. Try again. ${describeResponse(data)}`);
  }
}

/**
 * Sections and lessons in the shape every reader expects. A takeaway the
 * model sent as one string is kept, wrapped (the stub fill always did; the
 * single-subject paths dropped it until F6).
 */
export function normalizeSections(sections) {
  return (sections || []).map((s, si) => ({
    id: s.id || `section_${si + 1}`,
    title: s.title || `Section ${si + 1}`,
    description: s.description || '',
    estimated_minutes: s.estimated_minutes || 30,
    lessons: (s.lessons || []).map((l, li) => ({
      id: l.id || `lesson_${si + 1}_${li + 1}`,
      title: l.title || `Lesson ${li + 1}`,
      content: (l.content || '').replace(/<\/?cite[^>]*>/g, ''),
      key_takeaways: Array.isArray(l.key_takeaways) ? l.key_takeaways : (l.key_takeaways ? [l.key_takeaways] : []),
      practice_prompt: l.practice_prompt || '',
    }))
  }));
}

/** The references a person attached that could be read. */
export function readableReferences(references) {
  return references.filter(r => r.text && !r.error);
}

/** A subject's sources: the web search's, then the person's references, each URL once. */
export function subjectSources(webSources, validRefs) {
  const all = [...(webSources || []), ...validRefs.map(r => ({ title: r.title, url: r.url }))];
  const seen = new Set();
  return all.filter(s => { if (!s.url || seen.has(s.url)) return false; seen.add(s.url); return true; });
}

/** The course outline's request: the course, the context, what the course already
 *  holds (read here when adding to an existing course), the references. */
export async function buildCourseMessage({ fetchImpl, name, context, skillLevel, existingMatch, references }) {
  let userMessage = `Software/Language: ${name}\nSkill level: ${skillLevel}\n`;
  if (context?.trim()) userMessage += `\nAdditional context: ${context}`;

  if (existingMatch) {
    try {
      const existingSubs = await fetchImpl(`/api/software/${existingMatch.slug}/subjects`).then(needBody);
      const existingSubjectTitles = existingSubs.map(s => s.title);
      userMessage += `\n\nIMPORTANT: This software already has the following subjects — do NOT generate duplicates or basics:\n${existingSubjectTitles.map(t => `- ${t}`).join('\n')}`;
      userMessage += `\nDo NOT include "General Basics" since it already exists. Only generate NEW subjects.`;
    } catch { /* proceed without existing subject info */ }
  }

  // The person's references, for the outline's context.
  const validRefs = readableReferences(references);
  if (validRefs.length > 0) {
    userMessage += `\n\nThe user provided these reference materials. Design subjects that align with this content:\n`;
    for (const ref of validRefs) {
      userMessage += `- ${ref.title} (${ref.url}): ${ref.text.slice(0, 500)}\n`;
    }
  }
  return userMessage;
}

/** Ask for a course outline and read it: the parsed outline. */
export async function generateCourseOutline({ fetchImpl, model, systemPrompt, name, context, skillLevel, existingMatch, references, onPhase }) {
  const userMessage = await buildCourseMessage({ fetchImpl, name, context, skillLevel, existingMatch, references });
  const data = await callAnthropicAPI({
    model,
    maxTokens: 12000,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Response was too long and got cut off. Try a simpler topic.');
  }
  onPhase?.('Parsing response...');
  return parseModelJson(data, 'course outline');
}

/** Create a course: its slug, or the refusal's own words (a refused tier is an
 *  error, not a downgrade; unchecked, every stub would POST to
 *  /api/software/undefined/subjects). */
export async function createCourse(fetchImpl, { name, type, skillLevel, visibility }) {
  const metaRes = await fetchImpl('/api/software', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, skill_level: skillLevel, visibility })
  });
  const meta = await readBody(metaRes);
  if (!metaRes.ok || !meta?.slug) {
    throw new Error(meta?.error || 'Could not create the course.');
  }
  return meta.slug;
}

/**
 * The outline's subjects as stub records to save, one at a time (a generator,
 * so a run that stops part-way has saved what it saved, as before): a subject
 * the course already holds, by slug or by title, is skipped, and so is a new
 * "General Basics" when adding to an existing course; orders continue after
 * the course's highest.
 */
export function* courseStubs(subjects, { existingSubs, existingMatch, skillLevel }) {
  const existingSlugs = new Set();
  let existingMaxOrder = 0;
  if (existingSubs) {
    try {
      existingSubs.forEach(s => {
        existingSlugs.add(s.slug);
        if (s.subject_order != null && s.subject_order > existingMaxOrder) existingMaxOrder = s.subject_order;
      });
      const existingTitlesLower = new Set(existingSubs.map(s => s.title.toLowerCase()));
      for (const sub of subjects) {
        if (existingTitlesLower.has(sub.title.toLowerCase())) existingSlugs.add(slugify(sub.title));
      }
    } catch { /* proceed with what was read */ }
  }

  let orderCounter = existingMaxOrder;
  for (const sub of subjects) {
    // The title is read as text first: an outline entry without one stops the
    // run, as it always did.
    const subSlug = slugify(sub.title.toLowerCase());
    if (existingSlugs.has(subSlug)) continue;
    if (existingMatch && sub.title.toLowerCase().includes('general basic')) continue;

    orderCounter++;
    yield {
      slug: subSlug,
      title: sub.title,
      description: sub.description || '',
      skill_level: sub.skill_level || skillLevel,
      estimated_hours: sub.estimated_hours || 1,
      is_stub: true,
      sections: [],
      section_outlines: sub.section_outlines || [],
      prerequisites: [],
      subject_order: sub.subject_order || orderCounter,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

const NODE_RE = /\bnode[s]?\b|node.?based|shader.?graph|material.?editor|compositor|geometry.?node/i;

/** What the course already documents, so the model does not repeat it. */
async function dedupContext(fetchImpl, courseSlug, swType, docs) {
  let out = '';
  try {
    if (swType === 'coding_language') {
      const fnData = docs.functions || await fetchImpl(`/api/software/${courseSlug}/functions`).then(okBody);
      const allNames = (Array.isArray(fnData?.categories) ? fnData.categories : []).flatMap(c => functionEntries(c).map(f => f.name)).slice(0, 100);
      if (allNames.length > 0) out += `\n\nEXISTING FUNCTIONS (DO NOT DUPLICATE):\n${allNames.map(n => `- ${n}`).join('\n')}\nOnly include functions NOT in this list.\n`;
    } else {
      const hkData = docs.hotkeys || await fetchImpl(`/api/software/${courseSlug}/hotkeys`).then(okBody);
      const allActions = (hkData?.categories || []).flatMap(c => (c.shortcuts || []).map(s => s.action)).slice(0, 100);
      if (allActions.length > 0) out += `\n\nEXISTING HOTKEYS (DO NOT DUPLICATE):\n${allActions.map(a => `- ${a}`).join('\n')}\nOnly include hotkeys NOT in this list.\n`;
    }
    if (swType === 'node_software' || swType === 'software') {
      const ndData = docs.nodes || await fetchImpl(`/api/software/${courseSlug}/nodes`).then(okBody);
      const allNodeNames = (ndData?.systems || []).flatMap(s => (s.categories || []).flatMap(c => (c.nodes || []).map(n => n.name))).slice(0, 100);
      if (allNodeNames.length > 0) out += `\n\nEXISTING NODES (DO NOT DUPLICATE):\n${allNodeNames.map(n => `- ${n}`).join('\n')}\nOnly include nodes NOT in this list.\n`;
    }
  } catch { /* proceed without dedup context */ }
  return out;
}

/**
 * A subject's request. With `stub`: fill an outline subject (its title,
 * description, level and section outlines); else a new subject on `topic`.
 * Then what the course already documents, then the person's references.
 */
export async function buildSubjectMessage({ fetchImpl, courseSlug, course, stub, topic, skillLevel, docs, references }) {
  const swType = course?.type || 'software';
  let userMessage = `Software/Language: ${course?.name || courseSlug}\n`;
  userMessage += `Type: ${swType}\n`;
  if (stub) {
    userMessage += `Subject: ${stub.title}\n`;
    userMessage += `Description: ${stub.description || ''}\n`;
    userMessage += `Skill level: ${stub.skill_level || 'beginner'}\n`;
    if (swType === 'coding_language') {
      userMessage += `\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") in your response — list built-in functions, methods, and constructs covered in this subject with full parameter details, return types, and examples.\n`;
    }
    if (swType === 'software' || swType === 'node_software') {
      // Detect node-related subjects to give a stronger hint
      const subjectText = `${stub.title || ''} ${stub.description || ''} ${(stub.section_outlines || []).map(s => s.title + ' ' + s.description).join(' ')}`.toLowerCase();
      if (NODE_RE.test(subjectText)) {
        userMessage += `\nCRITICAL: This subject is about node-based workflows. You MUST include a "nodes" array alongside "hotkeys" in your response. Document all relevant nodes with their complete inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). This is mandatory for this subject.\n`;
      } else {
        userMessage += `\nIf this subject involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). Omit "nodes" if the subject does not involve nodes.\n`;
      }
    }
    if (stub.section_outlines?.length) {
      userMessage += `\nSection outlines to follow:\n${stub.section_outlines.map(s => `- ${s.title}: ${s.description} (${s.lesson_count} lessons)`).join('\n')}`;
    }
  } else {
    userMessage += `Skill level: ${skillLevel}\n`;
    if (swType === 'coding_language') {
      userMessage += `\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") — list built-in functions, methods, and constructs with parameter details, return types, and examples.\n`;
    }
    if (swType === 'software' || swType === 'node_software') {
      if (NODE_RE.test(topic.toLowerCase())) {
        userMessage += `\nCRITICAL: This topic is about node-based workflows. You MUST include a "nodes" array alongside "hotkeys" in your response. Document all relevant nodes with their complete inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). This is mandatory for this topic.\n`;
      } else {
        userMessage += `\nIf this topic involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). Omit "nodes" if the topic does not involve nodes.\n`;
      }
    }
    userMessage += `\nSingle topic lesson: ${topic}`;
  }

  userMessage += await dedupContext(fetchImpl, courseSlug, swType, docs);

  // The person's references, as primary sources.
  const validRefs = readableReferences(references);
  if (validRefs.length > 0) {
    userMessage += `\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n`;
    for (const ref of validRefs) {
      userMessage += `\nSource: ${ref.title} (${ref.url})\n${ref.text.slice(0, 3000)}\n`;
    }
    userMessage += `\nUse the above reference material as primary sources. Cite them where relevant.\n`;
  }
  return userMessage;
}

/**
 * Make a subject: the request (with web search), the reply read, the lessons
 * normalized and the record to save: { parsed, record }. It saves nothing: each
 * path saves, beside its share reminder. With `stub`: the stub's record filled
 * in under `stubSlug`; else a new subject on `topic`, slugged from its title.
 * `signal` (the stub fill's) is checked after the reply and before the record.
 */
export async function generateSubject({ fetchImpl, model, systemPrompt, courseSlug, course, stub, stubSlug, topic, skillLevel, docs, references, signal, onPhase }) {
  const userMessage = await buildSubjectMessage({ fetchImpl, courseSlug, course, stub, topic, skillLevel, docs, references });
  const validRefs = readableReferences(references);
  onPhase?.('Sending request...');
  const data = await callAnthropicAPI({
    model,
    maxTokens: 12000,
    systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    signal,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: validRefs.length > 0 ? 1 : 3 }],
    betas: 'web-search-2025-03-05',
  });
  if (signal?.aborted) throw new Error('Cancelled');
  if (data.stop_reason === 'max_tokens') {
    throw new Error(stub ? 'Response was too long. Try generating again.' : 'Response was too long. Try a more specific topic.');
  }

  onPhase?.('Parsing response...');
  const parsed = parseModelJson(data, 'subject');
  parsed.sections = normalizeSections(parsed.sections);
  if (signal?.aborted) throw new Error('Cancelled');

  const sources = subjectSources(extractTextAndCitations(data).sources, validRefs);
  const record = stub
    ? {
      ...stub,
      ...parsed,
      slug: stubSlug,
      software_slug: courseSlug,
      is_stub: false,
      sources,
      updated_at: new Date().toISOString(),
    }
    : {
      slug: slugify(parsed.title || topic),
      title: parsed.title || topic,
      software_slug: courseSlug,
      description: parsed.description || '',
      skill_level: parsed.skill_level || skillLevel,
      estimated_hours: parsed.estimated_hours || 1,
      is_stub: false,
      sections: parsed.sections,
      prerequisites: parsed.prerequisites || [],
      sources,
      original_prompt: topic,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  return { parsed, record };
}

/**
 * Merge what a generated subject documents into its course: hotkeys (a flat
 * list grouped by its context), functions, nodes, in that order. onHotkeys and
 * onNodes receive the course's merged documents as each merge answers; a
 * refused merge calls neither (a refusal is not drawn as the documents).
 */
export async function mergeSubjectDocuments(fetchImpl, courseSlug, parsed, { onHotkeys, onNodes } = {}) {
  if (parsed.hotkeys?.length > 0) {
    let categories = parsed.hotkeys;
    const first = categories[0];
    if (first && !first.shortcuts) {
      // A flat list: group it by its context or category.
      const grouped = {};
      categories.forEach(h => {
        const cat = h.context || h.category || 'General';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({ action: h.action || h.description || '', windows: h.windows || h.key || '', mac: h.mac || h.key || '', notes: h.notes || '' });
      });
      categories = Object.entries(grouped).map(([category, shortcuts]) => ({ category, shortcuts }));
    }
    const hkRes = await fetchImpl(`/api/software/${courseSlug}/hotkeys/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories })
    });
    const updatedHk = await okBody(hkRes);
    if (updatedHk) onHotkeys?.(updatedHk);
  }

  if (parsed.functions?.length > 0) {
    const categories = parsed.functions.map(cat => ({
      category: functionCategoryName(cat), // S2b round 2: a category the generator keyed `name` keeps its name
      functions: (cat.functions || []).map(f => ({
        name: f.name || '', syntax: f.syntax || f.name || '',
        parameters: f.parameters || '', returns: f.returns || f.returnType || '',
        description: f.description || '', example: f.example || ''
      }))
    })).filter(cat => cat.functions.length > 0);
    if (categories.length > 0) {
      await fetchImpl(`/api/software/${courseSlug}/functions/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories })
      });
    }
  }

  if (parsed.nodes?.length > 0) {
    const nodesRes = await fetchImpl(`/api/software/${courseSlug}/nodes/merge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: parsed.nodes })
    });
    const updatedNodes = await okBody(nodesRes);
    if (updatedNodes) onNodes?.(updatedNodes);
  }
}
