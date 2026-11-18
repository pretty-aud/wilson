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
import { DEFAULT_FULL_DECK_INSTRUCTIONS, DEFAULT_FULL_DECK_OUTPUT_FORMAT, composeFullDeckInstructions } from './fullDeckPrompts.js'

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
