// =============================================================================
// aiModels — the single source of truth for which Claude model runs which
// WILSON function. Pure: no I/O, no React. Unit-tested in aiModels.test.js.
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// -----------------------------------------------------------------------------
// Session 19. Model IDs were string literals scattered across 28 call sites in
// six files. On 2026-06-15 Anthropic retired `claude-sonnet-4-20250514`, and
// because "requests to retired models will fail", 17 of those 28 call sites
// stopped working that day — every D.O.G. deck generation, six of O.T.T.E.R.'s
// seven AI paths, RABBIT's intake for the six heavyweight document types, and
// the agent chat.
//
// Nobody noticed for 47 days. Not because anyone was careless: there was no
// place to look. No inventory of which model ran what, no surface that showed
// it, and the failure reached the user as a generic "try again".
//
// So the point of this module is not tidiness. Three properties, in order:
//
//   1. A model change is ONE edit, not a hunt through six files.
//   2. Every function's model is nameable and inspectable — the settings panel
//      renders straight off REGISTRY, so it cannot drift from reality.
//   3. A dead model degrades loudly, not silently. See resolveModel().
//
// -----------------------------------------------------------------------------
// RESOLUTION ORDER
// -----------------------------------------------------------------------------
//   user override  →  workspace override  →  platform default  →  built-in
//
// Built-in is the floor and lives here in code, so the app still runs with no
// database, no settings, and no network — which is exactly the state a fresh
// install and every unit test are in.
// =============================================================================

/**
 * Built-in floor models.
 *
 * `REASONING` replaces the retired `claude-sonnet-4-20250514`. Chosen as the
 * current Sonnet rather than Opus: Sonnet 4 was the incumbent, so this is the
 * like-for-like successor and the least behavioural change per call site.
 * Anthropic's deprecation table nominates `claude-sonnet-4-6`; the migration
 * guide points at `claude-sonnet-5`, which is the newer of the two, so that is
 * what we take. Either way it is now a one-line change here, or zero lines and
 * a settings edit.
 *
 * `FAST` is unchanged — Haiku 4.5 is active (retirement not before
 * 2026-10-15) and every call site already on it kept working through the
 * outage. Do not "modernise" it without a reason; it is the reason D.O.G.'s
 * theme generator and text rewrite still worked while the rest was dark.
 */
export const BUILTIN = {
  REASONING: 'claude-sonnet-5',
  FAST: 'claude-haiku-4-5-20251001',
}

/**
 * Every AI call site in WILSON, keyed by a stable id.
 *
 * The key is a contract: it is what gets persisted in user settings, workspace
 * overrides and platform defaults. **Renaming a key silently discards whatever
 * anyone had configured for it** — add a new one and migrate instead.
 *
 * `label` and `hint` are user-facing; they are the whole reason the settings
 * panel is honest rather than a list of identifiers. Write them for someone who
 * knows the tool but not the code.
 *
 * `tier` selects the built-in floor. It is NOT the model — it is which default
 * this function follows when nobody has chosen anything.
 */
export const REGISTRY = [
  // ── D.O.G. ────────────────────────────────────────────────────────────────
  // `effort` is set here, and MEASURED (S19, staging, same prompt and budget):
  //
  //   no effort field     137.9s  15194 tok  14 slides
  //   thinking disabled    51.8s   5443 tok  11 slides
  //   effort low           57.5s   6549 tok  12 slides
  //   effort medium        69.1s   7642 tok  13 slides   <- chosen
  //
  // ai-proxy streams through an Edge Function with a ~150s deadline, and a
  // call that overruns loses its stream rather than degrading. The unset case
  // ran 137.9s — inside the limit, but not by enough to rely on. It also used
  // 15194 of 16384 tokens, so it was one long deck away from triggering the
  // continuation loop and spending that 137.9s up to four times over.
  //
  // `medium` halves the wall-clock for one fewer slide, and leaves so much
  // budget spare that a deck finishes in a single call. Disabling thinking
  // outright was faster still but cost three slides, and Anthropic's guidance
  // for this model prefers lowering effort over switching thinking off.
  { key: 'dog.fullDeck',        tool: 'D.O.G.', tier: 'REASONING', fn: 'generateFullDeck', effort: 'medium',
    label: 'Full deck outline',        hint: 'Generates a complete multi-slide deck. The heaviest call in D.O.G. — it can run up to 3 continuation requests for a long deck.' },
  { key: 'dog.pageOutline',     tool: 'D.O.G.', tier: 'REASONING', fn: 'generatePageOutline',
    label: 'Single page outline',      hint: 'Generates one slide from the project documentation.' },
  { key: 'dog.regeneratePage',  tool: 'D.O.G.', tier: 'REASONING', fn: 'regeneratePage',
    label: 'Regenerate a page',        hint: 'Revises an existing slide against your notes.' },
  { key: 'dog.imagePrompts',    tool: 'D.O.G.', tier: 'REASONING', fn: 'generateImagePrompts',
    label: 'Image prompts',            hint: 'Writes prompts for the target image model. Output feeds IMG_PROMPTS.md.' },
  { key: 'dog.themes',          tool: 'D.O.G.', tier: 'FAST',      fn: 'generateAIThemes',
    label: 'Theme generator',          hint: 'Suggests colour and type themes for the deck.' },
  { key: 'dog.rewrite',         tool: 'D.O.G.', tier: 'FAST',      fn: 'handleRewriteRequest',
    label: 'Text rewrite',             hint: 'The inline text editor — shorten, expand, reword.' },
  { key: 'dog.rewriteRedo',     tool: 'D.O.G.', tier: 'FAST',      fn: 'handleRewriteRedo',
    label: 'Text rewrite — redo',      hint: 'Re-runs the last rewrite for a different result.' },
  { key: 'dog.visualDesc',      tool: 'D.O.G.', tier: 'FAST',      fn: 'generateDeckVisualDesc',
    label: 'Deck visual description',  hint: 'Summarises the deck’s look for VIS_DECKOUTLINE.md.' },

  // ── O.T.T.E.R. ────────────────────────────────────────────────────────────
  { key: 'otter.course',        tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'generateCourse',
    label: 'Course generation',        hint: 'Builds a whole course from your brief.' },
  { key: 'otter.subjectContent', tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'generateSubjectContent',
    label: 'Subject content',          hint: 'Writes the teaching content for a subject.' },
  { key: 'otter.singleSubject', tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'generateSingleSubject',
    label: 'Single subject',           hint: 'Generates one subject on its own.' },
  { key: 'otter.agentCourse',   tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'agentGenerateCourse',
    label: 'Course generation (agent)', hint: 'Same as course generation, when the pet companion runs it for you.' },
  { key: 'otter.agentSubject',  tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'agentGenerateSingleSubject',
    label: 'Single subject (agent)',   hint: 'Same as single subject, run by the pet companion.' },
  { key: 'otter.validator',     tool: 'O.T.T.E.R.', tier: 'REASONING', fn: 'callValidatorAPI',
    label: 'Validator',                hint: 'Checks a course for gaps and errors. Findings are not saved (Known #2).' },
  { key: 'otter.quiz',          tool: 'O.T.T.E.R.', tier: 'FAST',      fn: 'generateQuiz',
    label: 'Quiz generation',          hint: 'Writes quiz questions for a subject. Scores are not saved (Known #2).' },

  // ── R.A.B.B.I.T. ──────────────────────────────────────────────────────────
  // Intake is per document type because the old MODEL_MATRIX always was. A script and
  // a page of notes are not the same job; collapsing them into one setting
  // would remove a capability that already exists.
  { key: 'rabbit.classify',     tool: 'R.A.B.B.I.T.', tier: 'FAST',      fn: 'haikuClassify',
    label: 'Document classifier',      hint: 'Decides what kind of document you uploaded, which picks the model below.' },
  { key: 'rabbit.intake.script',      tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.script',
    label: 'Intake — Script',          hint: 'Parses assets and scenes out of a screenplay.' },
  { key: 'rabbit.intake.treatment',   tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.treatment',
    label: 'Intake — Treatment',       hint: '' },
  { key: 'rabbit.intake.gdd',         tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.gdd',
    label: 'Intake — Game design doc', hint: '' },
  { key: 'rabbit.intake.brief',       tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.brief',
    label: 'Intake — Brief',           hint: '' },
  { key: 'rabbit.intake.pitch_bible', tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.pitch_bible',
    label: 'Intake — Pitch bible',     hint: '' },
  { key: 'rabbit.intake.lookbook',    tool: 'R.A.B.B.I.T.', tier: 'REASONING', fn: 'MODEL_KEYS.lookbook',
    label: 'Intake — Lookbook',        hint: '' },
  { key: 'rabbit.intake.deck',        tool: 'R.A.B.B.I.T.', tier: 'FAST',      fn: 'MODEL_KEYS.deck',
    label: 'Intake — Deck',            hint: '' },
  { key: 'rabbit.intake.outline',     tool: 'R.A.B.B.I.T.', tier: 'FAST',      fn: 'MODEL_KEYS.outline',
    label: 'Intake — Outline',         hint: '' },
  { key: 'rabbit.intake.notes',       tool: 'R.A.B.B.I.T.', tier: 'FAST',      fn: 'MODEL_KEYS.notes',
    label: 'Intake — Notes',           hint: '' },
  { key: 'rabbit.intake.other',       tool: 'R.A.B.B.I.T.', tier: 'FAST',      fn: 'MODEL_KEYS.other',
    label: 'Intake — Anything else',   hint: 'The fallback when the classifier can’t place a document.' },

  // ── Shared ────────────────────────────────────────────────────────────────
  { key: 'agent.chat',          tool: 'Assistant', tier: 'REASONING', fn: 'sendAgentMessage',
    label: 'Agent chat',               hint: 'The assistant that can act on your projects.' },
  { key: 'pet.chat',            tool: 'Assistant', tier: 'FAST',      fn: 'sendChat',
    label: 'Pet companion chat',       hint: 'The small talk companion. Kept fast and cheap on purpose.' },
]

/** REGISTRY indexed by key, for O(1) lookup. */
export const BY_KEY = Object.freeze(
  Object.fromEntries(REGISTRY.map((e) => [e.key, e])),
)

/** Registry grouped by tool, preserving declaration order — the settings panel renders from this. */
export function registryByTool() {
  const out = new Map()
  for (const entry of REGISTRY) {
    if (!out.has(entry.tool)) out.set(entry.tool, [])
    out.get(entry.tool).push(entry)
  }
  return out
}

/**
 * Models known to be retired. A configured model in this set is refused at
 * save time and falls back at call time.
 *
 * This list is deliberately short and hand-maintained: it is not an allow-list
 * and it is not a substitute for validating against Anthropic. It exists so
 * the *specific* IDs we know are dead produce an accurate message ("Anthropic
 * retired this on 2026-06-15") rather than a generic failure, and so an app
 * carrying a stale setting recovers with no network round trip.
 */
export const RETIRED = Object.freeze({
  'claude-sonnet-4-20250514': '2026-06-15',
  'claude-opus-4-20250514': '2026-06-15',
  'claude-3-7-sonnet-20250219': '2026-02-19',
  'claude-3-5-haiku-20241022': '2026-02-19',
  'claude-3-opus-20240229': '2026-01-05',
  'claude-3-haiku-20240307': '2026-04-20',
})

/** Shape check only. Anthropic is the authority on whether an ID resolves. */
export function isWellFormedModelId(id) {
  return typeof id === 'string' && /^claude-[a-z0-9][a-z0-9.-]{2,63}$/.test(id.trim())
}

/**
 * Resolve the model for one function.
 *
 * @param {string} key                 a REGISTRY key
 * @param {object} [sources]
 * @param {Record<string,string>} [sources.user]      per-user overrides
 * @param {Record<string,string>} [sources.workspace] per-workspace overrides
 * @param {Record<string,string>} [sources.platform]  operator-set defaults
 * @returns {{model:string, source:string, warning:string|null, entry:object}}
 *
 * `warning` is non-null when a configured model was rejected and something else
 * was substituted. Callers MUST surface it — a silent fallback is how a dead
 * model goes unnoticed for 47 days, which is the whole reason this module
 * exists. Returning it rather than logging it keeps this function pure and
 * makes the behaviour testable.
 */
export function resolveModel(key, sources = {}) {
  const entry = BY_KEY[key]
  if (!entry) {
    // An unknown key is a programming error, not a user misconfiguration.
    // Fail towards a working model rather than throwing mid-generation.
    return {
      model: BUILTIN.REASONING,
      source: 'builtin',
      warning: `Unknown AI function "${key}" — using the default model. This is a bug; the key is not in the registry.`,
      entry: null,
    }
  }

  const builtin = BUILTIN[entry.tier] ?? BUILTIN.REASONING
  const candidates = [
    ['user', sources.user?.[key]],
    ['workspace', sources.workspace?.[key]],
    ['platform', sources.platform?.[key]],
  ]

  for (const [source, value] of candidates) {
    if (!value) continue
    const model = String(value).trim()

    if (RETIRED[model]) {
      return {
        model: builtin,
        source: 'builtin',
        warning: `“${entry.label}” is set to ${model}, which Anthropic retired on ${RETIRED[model]}. Using ${builtin} instead — update it in settings.`,
        entry,
      }
    }
    if (!isWellFormedModelId(model)) {
      return {
        model: builtin,
        source: 'builtin',
        warning: `“${entry.label}” is set to “${model}”, which is not a valid Claude model ID. Using ${builtin} instead.`,
        entry,
      }
    }
    return { model, source, warning: null, entry }
  }

  return { model: builtin, source: 'builtin', warning: null, entry }
}

/**
 * Every distinct model the current configuration would use, with the functions
 * that use it. Drives the "which models are working" view.
 */
export function modelsInUse(sources = {}) {
  const out = new Map()
  for (const entry of REGISTRY) {
    const { model } = resolveModel(entry.key, sources)
    if (!out.has(model)) out.set(model, [])
    out.get(model).push(entry)
  }
  return out
}

/** The five effort levels Anthropic accepts. Anything else is a typo. */
export const EFFORT_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * Request tuning for one function — the fields beyond `model` that shape how
 * hard the model works. Spread into the request body alongside `model`.
 *
 * Only `dog.fullDeck` sets this today, and only because it was measured
 * against a hard limit (see its REGISTRY entry). Everything else is nowhere
 * near ai-proxy's Edge deadline, and guessing at effort for a call site that
 * is comfortably fast trades output quality for nothing.
 *
 * Returns `{}` when a function has no tuning, so spreading it is always safe.
 *
 * NOTE: ai-proxy must forward these. It gained that in S19 and is deployed to
 * STAGING only — dev and prod still drop both fields, so this degrades to
 * today's behaviour there rather than breaking.
 */
export function tuningFor(key) {
  const entry = BY_KEY[key]
  if (!entry?.effort || !EFFORT_LEVELS.includes(entry.effort)) return {}
  return {
    thinking: { type: 'adaptive' },
    output_config: { effort: entry.effort },
  }
}

/** Every warning the current configuration would produce. Empty means healthy. */
export function configWarnings(sources = {}) {
  return REGISTRY
    .map((e) => resolveModel(e.key, sources).warning)
    .filter(Boolean)
}
