// =============================================================================
// promptBoxes.test.js — F6 (REV-04): D.O.G.'s prompt boxes are what is sent.
//
// Her answer of 2026-11-18, typed in F6's chat: "Make them work". The two
// Generation Rules boxes and the Single Page and Full Deck Export Schema boxes
// changed nothing that was sent: D.O.G. sent instruction text written into its
// own code, and the boxes held an older, drifted copy. Now the requests compose
// from the boxes, and the boxes start from exactly the text sent before F6:
// the fingerprints below were recorded from that inline text, evaluated, before
// it was replaced. (The Image Prompt Export Schema is the layout of a file
// D.O.G. writes itself, so it is read-only now, as the Visual Deck one.)
// =============================================================================

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SINGLE_PAGE_INSTRUCTIONS, DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT, composeSinglePageInstructions,
  EXPORT_SCHEMA_MARK, SLIDE_NUMBER_MARK, LAYOUT_NAME_MARK,
} from './singlePagePrompts.js'
import { DEFAULT_FULL_DECK_SYSTEM, DEFAULT_FULL_DECK_INSTRUCTIONS, DEFAULT_FULL_DECK_OUTPUT_FORMAT, composeFullDeckInstructions } from './fullDeckPrompts.js'

const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex')
const DOG = readFileSync(fileURLToPath(new URL('../DeckOutlineGenerator.jsx', import.meta.url)), 'utf8')
const single = (slideNumber, layoutName) =>
  composeSinglePageInstructions(DEFAULT_SINGLE_PAGE_INSTRUCTIONS, DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT, { slideNumber, layoutName })

describe('untouched, the boxes compose exactly the text D.O.G. sent before F6', () => {
  it('a single slide, for two slides and layouts', () => {
    expect(sha(single(3, 'Title Slide'))).toBe('cdace55ca365de0a5dec49a7b740790c0f29ceac42dd0cba796c7d0c18833092')
    expect(sha(single('X', 'One column text'))).toBe('52098e91ca3c41447baa56134aee4cb3bc8ab4fb692b2fffde54385e5dc30974')
  })

  it('the full deck', () => {
    expect(sha(composeFullDeckInstructions(DEFAULT_FULL_DECK_INSTRUCTIONS, DEFAULT_FULL_DECK_OUTPUT_FORMAT)))
      .toBe('869b49a9f5f5f6ea47c6f1d69ad226cbf93f1f23aab32fea05d3edbe58e44b2c')
  })

  it('the boxes read as before F6\'s sent text: the rules, then the format where it stood', () => {
    expect(DEFAULT_SINGLE_PAGE_INSTRUCTIONS).toMatch(/^Generate a slide outline based on the project documentation/)
    expect(DEFAULT_SINGLE_PAGE_INSTRUCTIONS).toContain(`REQUIRED FORMAT (copy this structure exactly):\n\n${EXPORT_SCHEMA_MARK}\n\nEXAMPLE OF CORRECT OUTPUT:`)
    expect(DEFAULT_SINGLE_PAGE_INSTRUCTIONS).toMatch(/Generate the outline now:$/)
    expect(DEFAULT_SINGLE_PAGE_OUTPUT_FORMAT).toMatch(new RegExp(`^SLIDE #${SLIDE_NUMBER_MARK.replace(/[{}]/g, '\$&')} — `))
    expect(DEFAULT_FULL_DECK_INSTRUCTIONS).toMatch(/Generate the complete deck now:$/)
    expect(DEFAULT_FULL_DECK_OUTPUT_FORMAT).toMatch(/^SLIDE #\[NUMBER\] — \[Layout Name\]\n/)
  })
})

describe('an edit in a box reaches what is sent', () => {
  it('the rules box\'s words are sent, the format where its mark is, the slide filled in', () => {
    const rules = `My own rule.\n${EXPORT_SCHEMA_MARK}\nThe end.`
    const schema = `SLIDE #${SLIDE_NUMBER_MARK} — ${LAYOUT_NAME_MARK}\n▸ TITLE:`
    expect(composeSinglePageInstructions(rules, schema, { slideNumber: 4, layoutName: 'Caption' }))
      .toBe('My own rule.\nSLIDE #4 — Caption\n▸ TITLE:\nThe end.')
    expect(composeFullDeckInstructions(`A\n${EXPORT_SCHEMA_MARK}\nB`, 'FORMAT')).toBe('A\nFORMAT\nB')
  })

  it('a layout name holding "$&" is sent as written; without the mark, no format is sent', () => {
    expect(composeSinglePageInstructions(EXPORT_SCHEMA_MARK, LAYOUT_NAME_MARK, { slideNumber: 1, layoutName: 'A $& B' })).toBe('A $& B')
    expect(composeFullDeckInstructions('Only rules.', 'FORMAT')).toBe('Only rules.')
  })
})

describe('the requests read the boxes (DeckOutlineGenerator.jsx)', () => {
  it('a single slide and the full deck compose from the drawer, and their callbacks list its values', () => {
    expect(DOG).toContain('composeSinglePageInstructions(singlePageInstructions, singlePageOutputFormat, { slideNumber, layoutName: layoutInfo.name })')
    expect(DOG).toContain('composeFullDeckInstructions(fullDeckInstructions, fullDeckOutputFormat)')
    expect(DOG).toContain('singlePageSystemPrompt, singlePageInstructions, singlePageOutputFormat, ')
    expect(DOG).toContain('fullDeckSystemPrompt, fullDeckInstructions, fullDeckOutputFormat, ')
    // No copy of the sent text is left in the component.
    expect(DOG).not.toContain('Generate the outline now:')
    expect(DOG).not.toContain('Generate the complete deck now:')
  })

  it('the image prompts schema is the file\'s layout, read-only', () => {
    expect(DOG).toMatch(/<textarea readOnly value=\{DEFAULT_IMG_PROMPT_OUTPUT_FORMAT\}/)
    expect(DOG).not.toMatch(/imgPromptOutputFormat/)
  })
})

// ── F12 (OUTSTANDING F6-17): the two probes send D.O.G.'s system prompt and instructions ───
// scripts/probes/deck-latency.mjs and generation-e2e.mjs measured a prompt D.O.G. never sends: the
// export format glued onto the SYSTEM prompt, and the rules in the user turn with {{EXPORT SCHEMA}}
// left as written. They send those two parts as the app does now: the system prompt alone, and the
// rules with the format in the mark's place, after the source text.
//
// That is ALL this compares (review round 1). The rest of the user turn is each side's own: the
// app's lead-in, project context and file framing against the probe's made-up brief; and so are
// max_tokens and the thinking settings. A probe's reading is of the app's prompt PARTS, not of a
// deck the app would generate.
//
// 🚨 The probes are NEVER imported or run here. Each reads an env file, signs in and calls the one
// AI key the moment it is loaded. Only the request's object literal is lifted from the script's
// TEXT and evaluated, with the app's own constants and a made-up brief; the literal makes no call
// but composeFullDeckInstructions and modelFor (a comment beside each says to keep it so).
const PROBES = {
  'deck-latency.mjs': (text) => literalAfter(text, 'const body = '),
  'generation-e2e.mjs': (text) => literalAfter(text, 'body: ', text.indexOf("name: 'D.O.G. full deck'")),
}
const probeText = (name) => readFileSync(fileURLToPath(new URL(`../../../../scripts/probes/${name}`, import.meta.url)), 'utf8')

/** The object literal that follows `marker` (searched from `from`), by brace matching. */
function literalAfter(text, marker, from = 0) {
  const at = from < 0 ? -1 : text.indexOf(marker, from)
  if (at < 0) throw new Error(`the probe no longer has "${marker}"`)
  const open = text.indexOf('{', at)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(open, i + 1) }
  }
  throw new Error(`unbalanced braces after "${marker}"`)
}

const BRIEF = 'PROJECT: a made-up brief, two lines.\nIts second line.'
const COMPOSED = composeFullDeckInstructions(DEFAULT_FULL_DECK_INSTRUCTIONS, DEFAULT_FULL_DECK_OUTPUT_FORMAT)
const count = (hay, needle) => hay.split(needle).length - 1

/** What is wrong with a probe's full-deck request, as its text builds it. */
function probeProblems(name, text) {
  const problems = []
  if (!/import \{[^}]*\bcomposeFullDeckInstructions\b[^}]*\} from '\.\.\/\.\.\/src\/tools\/deck-outline-generator_v0\.514\/prompts\/fullDeckPrompts\.js'/.test(text)) {
    problems.push('does not import composeFullDeckInstructions from the app\'s own prompts module')
  }
  // eslint-disable-next-line no-new-func
  const body = new Function(
    'DEFAULT_FULL_DECK_SYSTEM', 'DEFAULT_FULL_DECK_INSTRUCTIONS', 'DEFAULT_FULL_DECK_OUTPUT_FORMAT', 'composeFullDeckInstructions', 'modelFor', 'BRIEF', 'extra',
    `return (${PROBES[name](text)})`,
  )(DEFAULT_FULL_DECK_SYSTEM, DEFAULT_FULL_DECK_INSTRUCTIONS, DEFAULT_FULL_DECK_OUTPUT_FORMAT, composeFullDeckInstructions, () => 'a-model', BRIEF, {})
  if (body.system !== DEFAULT_FULL_DECK_SYSTEM) problems.push('system is not the app\'s system prompt alone')
  const turns = body.messages || []
  const said = turns.length === 1 && turns[0].role === 'user' && typeof turns[0].content === 'string' ? turns[0].content : null
  if (said === null) problems.push('the request is not one user turn of text')
  else {
    if (!said.endsWith(COMPOSED) || count(said, COMPOSED) !== 1) problems.push('the user turn does not end with the composed instructions, once')
    if (!said.startsWith(BRIEF)) problems.push('the source text does not come before the instructions')
  }
  const whole = JSON.stringify(body)
  if (whole.includes(EXPORT_SCHEMA_MARK)) problems.push('{{EXPORT SCHEMA}} is sent as written')
  if (count(whole, JSON.stringify(DEFAULT_FULL_DECK_OUTPUT_FORMAT).slice(1, -1)) !== 1) problems.push('the export format is not sent exactly once')
  if (body.tool !== 'dog') problems.push('tool is not dog')
  return problems
}

describe('F12: the probes send the full deck\'s system prompt and composed instructions as D.O.G. does (OUTSTANDING F6-17)', () => {
  it('the app\'s side, read from the component: the three boxes start from the defaults, the system box alone is system, the composed boxes end the user turn', () => {
    expect(DOG).toContain('useState(DEFAULT_FULL_DECK_SYSTEM)')
    expect(DOG).toContain('useState(DEFAULT_FULL_DECK_INSTRUCTIONS)')
    expect(DOG).toContain('useState(DEFAULT_FULL_DECK_OUTPUT_FORMAT)')
    expect(DOG).toContain('system: fullDeckSystemPrompt,')
    expect(DOG).toContain('const outputInstructions = composeFullDeckInstructions(fullDeckInstructions, fullDeckOutputFormat);')
    expect(DOG).toMatch(/\$\{fullDeckPlacementPrompt\.instructions\}\$\{outputInstructions\}\$\{fullDeckPlacementPrompt\.rules\}`;/)
    // …and with no placed asset the FULL DECK's own placement prompt is two empty strings, so the
    // turn ends with the instructions (the same words stand at two other sites: this is its own).
    expect(DOG).toMatch(/const fullDeckPlacementPrompt = srcPlacement\.length > 0\s*\? buildAssetPlacementPrompt\(srcPlacement\)\s*: \{ instructions: '', rules: '' \};/)
  })

  for (const name of Object.keys(PROBES)) {
    it(`${name}: its system prompt and its instructions are the app's (the instructions by the fingerprint above), after its source text`, () => {
      expect(probeProblems(name, probeText(name))).toEqual([])
      expect(sha(COMPOSED)).toBe('869b49a9f5f5f6ea47c6f1d69ad226cbf93f1f23aab32fea05d3edbe58e44b2c')
    })
  }

  it('CONTROL: the request as both probes built it before F12 is named for each thing wrong with it', () => {
    const before = [
      "import { composeFullDeckInstructions } from '../../src/tools/deck-outline-generator_v0.514/prompts/fullDeckPrompts.js'",
      'const body = {',
      "  model: modelFor('dog.fullDeck'),",
      '  system: `${DEFAULT_FULL_DECK_SYSTEM}\\n\\n${DEFAULT_FULL_DECK_OUTPUT_FORMAT}`,',
      "  messages: [{ role: 'user', content: `${DEFAULT_FULL_DECK_INSTRUCTIONS}\\n\\n${BRIEF}` }],",
      "  tool: 'dog',",
      '  ...extra,',
      '}',
    ].join('\n')
    expect(probeProblems('deck-latency.mjs', before)).toEqual([
      'system is not the app\'s system prompt alone',
      'the user turn does not end with the composed instructions, once',
      'the source text does not come before the instructions',
      '{{EXPORT SCHEMA}} is sent as written',
    ])
    // …and one that never took the app's function is named for that too.
    expect(probeProblems('deck-latency.mjs', before.replace('composeFullDeckInstructions', 'somethingElse'))[0])
      .toBe('does not import composeFullDeckInstructions from the app\'s own prompts module')
  })
})
