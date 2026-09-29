// =============================================================================
// petKnowledgeWiring.test.js — Phase 6, 2026-08-14.
//
// 🚨 NINE FEATURES IN THIS REPO HAVE SHIPPED COMPLETE AND BEEN CALLED BY
// NOTHING: the folder tree (S27), task templates (S28), quiz history (S30),
// `setOtterAdapterMode`, `workspaces.storage_mode`, POST /api/pet/reset, S31's
// settings half, S37's `storageSecretClear` — and `otterContext`, declared at
// App.jsx:314, written at App.jsx:1696 via `onContextChange={setOtterContext}`,
// and READ NOWHERE. Quiz history is the one to remember: a column, two adapter
// ops, a route mapping AND A PASSING UNIT TEST, for twenty sessions, over a
// path nothing reached.
//
// petKnowledge.test.js next door is a behaviour test of the mechanism. It would
// pass in full with App.jsx never importing the module. This file is the other
// half: it asserts the CALL SITE exists, and that the three placement rules
// that make it correct are actually honoured.
//
// A source scan is the fallback, not the first choice — vitest.config.js pins
// `environment: 'node'` and there is no jsdom or @testing-library anywhere, so
// driving a 2,200-line component with a live Supabase client and four timers is
// not on offer. Every assertion therefore names the exact symbol it needs, so a
// rename fails loudly rather than silently passing over a moved target.
//
// 🚨 AND EVERY ASSERTION IS PAIRED WITH A FAILING CONTROL, because the last
//    test of this kind pinned the EXISTENCE OF A STRING LITERAL and stayed
//    green while the button did nothing for two days.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '../../')
const app = readFileSync(join(SRC, 'App.jsx'), 'utf8')
const petKnowledge = readFileSync(join(HERE, 'petKnowledge.js'), 'utf8')

// Strip comments LINE-ANCHORED, not character-wise.
//
// 🚨 A character-wise stripper is wrong in a JSX repo: `'https://x'` loses its
//    tail to the double slash, and a regex or JSX attribute containing an
//    open-block-comment sequence eats the rest of the file. Anchoring to the
//    start of a line, plus fenced block comments, is the form that survives
//    this codebase — and the reason it matters is that a `not.toMatch`
//    assertion run over source WITH comments happily matches its own
//    explanatory comment and passes for the wrong reason.
//
//    (This very comment had to be de-blocked to write it: the line describing
//    the anchor pattern contained a star-slash and silently closed its own
//    block comment. The trap is not hypothetical.)
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*\/\//.test(l))
    .join('\n')
}

const appCode = stripComments(app)

describe('the comment stripper itself', () => {
  // Without this, every `not.toMatch` below is worthless.
  it('🚨 removes a whole-line comment but keeps a URL in a string', () => {
    const out = stripComments("// gone\nconst u = 'https://example.com/x'\n")
    expect(out).not.toMatch(/gone/)
    expect(out).toContain('https://example.com/x')
  })

  it('🚨 the stripped App.jsx still contains real code', () => {
    expect(appCode).toMatch(/const sendChat = useCallback/)
    expect(appCode.length).toBeGreaterThan(20000)
  })
})

describe('App.jsx actually reaches petKnowledge', () => {
  it('imports the module', () => {
    expect(appCode).toMatch(/import\s*\{[^}]*retrieveOtterKnowledge[^}]*\}\s*from\s*'\.\/tools\/otter_v0\.3\.1\/petKnowledge'/)
  })

  it('🚨 CALLS retrieveOtterKnowledge — a retriever nothing calls looks identical to one that works', () => {
    expect(appCode).toMatch(/\bretrieveOtterKnowledge\(\{/)
    expect(appCode).toMatch(/await\s+withTimeout\(\s*\n?\s*retrieveOtterKnowledge\(/)
  })

  it('🚨 the call is BOUNDED — otterFetch awaits a bare getSession() with no ceiling of its own', () => {
    // callAI wraps that same getSession() in withTimeout because an abandoned
    // one holds auth-js's global per-storageKey lock and every later call
    // queues behind it. An unbounded session read added in front of the chat
    // spinner re-opens, in the pet, the hang that ceiling was built to close.
    expect(appCode).toMatch(/import\s*\{\s*withTimeout\s*\}\s*from\s*'\.\/cloud\/auth\/withTimeout'/)
    expect(appCode).toMatch(/KNOWLEDGE_TIMEOUT_MS\s*=\s*\d+/)
  })

  it('🚨 feeds it the message the user just typed, not the page or the history', () => {
    expect(appCode).toMatch(/retrieveOtterKnowledge\(\{[\s\S]{0,200}question:\s*currentInput/)
  })

  it('🚨 passes otterFetch — the ONE seam, not a bare fetch and not a forked adapter', () => {
    expect(appCode).toMatch(/retrieveOtterKnowledge\(\{[\s\S]{0,200}fetchImpl:\s*otterFetch/)
    // A4 widened the CLAUSE, not the target: App.jsx now also imports
    // subscribeOtterAdapterMode from this same module (the library switch has
    // to invalidate the pet index). The identifier is still matched exactly,
    // with word boundaries, so dropping otterFetch or importing it from
    // somewhere else still fails.
    expect(appCode).toMatch(/import\s*\{[^}]*\botterFetch\b[^}]*\}\s*from\s*'\.\/tools\/otter_v0\.3\.1\/adapters'/)
  })

  it('🚨 the result reaches `context` — retrieving and then dropping it is the whole bug again', () => {
    expect(appCode).toMatch(/context\s*\+=\s*knowledgeBlock/)
  })

  it('🚨 …and `context` reaches the MODEL — one hop further than the obvious assertion', () => {
    // Stopping at `context` proves the block reaches a local string, not that
    // the string reaches Anthropic. A refactor that extracted the legacy
    // context blocks and passed `system: companionPrompt` would leave the
    // import, the call and the `context +=` all intact and green, with the
    // retrieved courses going nowhere — the original defect, restored, under a
    // passing wiring test. That is the shape that cost this repo nine features.
    expect(appCode).toMatch(/system:\s*companionPrompt\s*\+\s*context/)
  })
})

describe('the three placement rules', () => {
  // sendChat spans from its declaration to the closing of its dep array.
  const sendChat = appCode.slice(
    appCode.indexOf('const sendChat = useCallback'),
    appCode.indexOf('}, [chatMessages, authed, currentPage, petData]'),
  )

  it('the slice actually found sendChat', () => {
    expect(sendChat.length).toBeGreaterThan(500)
    expect(sendChat).toContain('retrieveOtterKnowledge')
  })

  it('🚨 retrieval happens BEFORE callAI — after it, it could not inform anything', () => {
    expect(sendChat.indexOf('retrieveOtterKnowledge'))
      .toBeLessThan(sendChat.indexOf('await callAI('))
  })

  it('🚨 retrieval sits OUTSIDE the retry loop — inside, a retried overload re-runs every read', () => {
    const retryLoop = sendChat.indexOf('for (let attempt = 0; attempt < 3; attempt++)')
    expect(retryLoop).toBeGreaterThan(-1)
    expect(sendChat.indexOf('retrieveOtterKnowledge')).toBeLessThan(retryLoop)
  })

  it('🚨 retrieval sits INSIDE the try — the finally is the only thing that lowers the spinner', () => {
    // setChatLoading(true) fires at the top of sendChat; `finally { setChatLoading(false) }`
    // is the only lowering. An await between them but OUTSIDE the try hangs the
    // pet's thinking dots forever on rejection.
    const tryAt = sendChat.indexOf('\n    try {')
    expect(tryAt).toBeGreaterThan(-1)
    expect(sendChat.indexOf('retrieveOtterKnowledge')).toBeGreaterThan(tryAt)
    expect(sendChat).toMatch(/finally\s*\{[\s\S]{0,120}setChatLoading\(false\)/)
  })

  // ── FAILING CONTROL ───────────────────────────────────────────────────────
  it('🚨 is NOT gated on the O.T.T.E.R. page — the Blender question is asked from anywhere', () => {
    // PetCompanionWithAgent scopes the AGENT that way (`onOtterPage`). Copying
    // that here would mean the pet only reads the courses while she is already
    // looking at them, which answers nothing she actually asked.
    const upToCall = sendChat.slice(0, sendChat.indexOf('retrieveOtterKnowledge'))
    expect(upToCall).not.toMatch(/currentPage\s*===\s*'otter'/)
  })
})

describe('the session index cache is torn down with the identity', () => {
  it('imports and calls clearPetKnowledgeCache', () => {
    expect(appCode).toMatch(/import\s*\{[^}]*clearPetKnowledgeCache[^}]*\}\s*from\s*'\.\/tools\/otter_v0\.3\.1\/petKnowledge'/)
    expect(appCode).toMatch(/clearPetKnowledgeCache\(\)/)
  })

  it('🚨 keyed on perms.userId — `authed` is a BOOLEAN and does not change when the identity under it does', () => {
    // App.jsx:744 documents exactly this for the pet itself. Audrey runs two
    // accounts in two browsers at once; a cache keyed on a boolean would serve
    // one account's library to the other.
    const effect = appCode.slice(appCode.indexOf('clearPetKnowledgeCache()'))
    expect(effect.slice(0, 200)).toMatch(/\[perms\.ready,\s*perms\.userId,\s*perms\.workspaceId\]/)
  })
})

describe('the permission guard is in the module, not improvised at the call site', () => {
  it('🚨 the REFUSAL is the hard guard and comes first; the admission is a narrow arm after it', () => {
    // This test used to assert `=== true` appeared NOWHERE, because an
    // `=== true` HARD guard hides every Local Server course (GET /api/software
    // on Express returns six fields, none of them a capability). Audrey's
    // 2026-08-14 ruling — allow a colleague's personal course while a review
    // window is open — needs exactly one `=== true`, as the LAST arm. So the
    // claim being pinned is now the ORDER, not the absence.
    const code = stripComments(petKnowledge)
    expect(code).toMatch(/can_read_content\s*===\s*false/)
    expect(code).toMatch(/visibility\s*==\s*null/)   // the Local Server passthrough
    expect(code.indexOf('can_read_content === false'))
      .toBeLessThan(code.indexOf('can_read_content === true'))
    // The semantics themselves are pinned behaviourally, with failing controls,
    // in petKnowledge.test.js → 'isRetrievableCourse — what the pet may read'.
  })

  it('🚨 the guard runs BEFORE any body fetch', () => {
    const code = stripComments(petKnowledge)
    expect(code.indexOf('isRetrievableCourse')).toBeLessThan(code.indexOf('/subjects/'))
  })

  it('🚨 every read checks status — otterFetch resolves for EVERY status', () => {
    const code = stripComments(petKnowledge)
    expect(code).toMatch(/if\s*\(!res\s*\|\|\s*!res\.ok\)\s*return/)
    // And nothing anywhere calls .json() without having checked first.
    expect(code).not.toMatch(/\.then\(r\s*=>\s*r\.json\(\)\)/)
  })

  it('🚨 the citation and empty-result rules live in the CONTEXT, not COMPANION_PROMPT', () => {
    // sendChat replaces the whole persona with otterSettings.prompts.companion
    // when the user customises it, so a guardrail written there is deleted for
    // anyone who edited theirs.
    const prompts = readFileSync(join(HERE, 'prompts.js'), 'utf8')
    expect(prompts).not.toMatch(/COURSE CONTENT/)
    expect(petKnowledge).toMatch(/plain prose/)
  })
})
