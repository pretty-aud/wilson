// =============================================================================
// rewritePrompts.test.js — F6 (A5): one rewrite request for both buttons.
//
// The rewrite and its Regenerate built the same body in two 60-line copies.
// F6 proved, before replacing them, that rewriteRequest builds what both
// copies sent: a temporary harness evaluated the committed handlers with faked
// closures over 49 selections (four modes, bullets, bold headers, numbered
// lists, plain lines, with and without a deck context and uploads) and compared
// the bodies, byte for byte, 99 of 99 (the hand-off records it). The bodies
// below are two of those recordings, pinned as literals.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rewriteRequest, deckExcerpt } from './rewritePrompts.js'

const DOG = readFileSync(fileURLToPath(new URL('../DeckOutlineGenerator.jsx', import.meta.url)), 'utf8')

/** The body of a `const <name> = useCallback(` declaration, to its deps. */
function callbackBody(name) {
  const start = DOG.indexOf(`const ${name} = useCallback(`)
  if (start < 0) return null
  return DOG.slice(start, DOG.indexOf('  }, [', start))
}

const CONTENT = 'Intro line\n- one\n- two\nOutro line'
const AT = CONTENT.indexOf('- one')
const BULLETS = { text: '- one\n- two', start: AT, end: AT + '- one\n- two'.length, content: CONTENT }
const UPLOADS = [
  { type: 'text', content: 'A'.repeat(410) },
  { type: 'pdf', content: 'x' },
  { type: 'text', content: 'second' },
  { type: 'text', content: 'third is never sent' },
]

describe('rewriteRequest: the body both buttons send', () => {
  it('extend, on bullets, with a deck context and text uploads (a recorded body)', () => {
    const body = rewriteRequest(BULLETS, 'extend', { deckPrompt: 'D'.repeat(610), uploads: UPLOADS, system: 'SYS', model: 'm' })
    expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'system', 'messages', 'tool'])
    expect(body).toMatchObject({ model: 'm', max_tokens: 1000, system: 'SYS', tool: 'dog' })
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].content).toBe(
      'Selected text to rewrite:\n"""- one\n- two"""\n\nSTRICT LINE COUNT: The input has exactly 2 non-empty line(s). Your output MUST have exactly 2 non-empty line(s). Do NOT add extra lines, blank lines, or remove lines. Expand the text WITHIN each existing line — make each line longer and more detailed. Do NOT add new lines or bullet points.\nFORMATTING DETECTED: Bullet points (2 bullets) — output exactly 2 bullets, same style.\n\nSurrounding markdown context (for formatting reference only, do NOT rewrite this):\nBEFORE: """Intro line"""\nAFTER: """Outro line"""\n\nDeck context: '
      + 'D'.repeat(600)
      + '\n\nSource document excerpts:\n'
      + 'A'.repeat(400) + '\nsecond',
    )
  })

  it('shorten, a plain line with nothing around it (a recorded body)', () => {
    const body = rewriteRequest({ text: 'A plain line.', start: 0, end: 13, content: 'A plain line.' }, 'shorten',
      { deckPrompt: '', uploads: [], system: 'S2', model: 'm2' })
    expect(JSON.stringify(body)).toBe(JSON.stringify({
      model: 'm2', max_tokens: 1000, system: 'S2',
      messages: [{ role: 'user', content: 'Selected text to rewrite:\n"""A plain line."""\n\nSTRICT LINE COUNT: The input has exactly 1 non-empty line(s). Your output MUST have exactly 1 non-empty line(s). Do NOT add extra lines, blank lines, or remove lines. Condense the text WITHIN each existing line — make each line shorter. Do NOT remove lines.' }],
      tool: 'dog',
    }))
  })

  it('only extend carries the deck context and the excerpts', () => {
    const relaxed = rewriteRequest(BULLETS, 'relaxed', { deckPrompt: 'D'.repeat(610), uploads: UPLOADS, system: 'S', model: 'm' })
    expect(relaxed.messages[0].content).not.toContain('Deck context')
    expect(relaxed.messages[0].content).not.toContain('Source document excerpts')
  })
})

describe('deckExcerpt: the deck context and the first two text uploads, cut to length', () => {
  it('the rewrite\'s 600 and 400, and the theme generator\'s 800 and 500', () => {
    expect(deckExcerpt('D'.repeat(900), UPLOADS, 600, 400)).toEqual({ context: 'D'.repeat(600), excerpts: 'A'.repeat(400) + '\nsecond' })
    expect(deckExcerpt(null, UPLOADS, 800, 500)).toEqual({ context: '', excerpts: 'A'.repeat(410) + '\nsecond' })
    expect(deckExcerpt('x', [], 800, 500)).toEqual({ context: 'x', excerpts: '' })
  })
})

describe('both buttons and the theme generator use them (DeckOutlineGenerator.jsx)', () => {
  it('finds both handlers at all — the instrument works', () => {
    expect(callbackBody('handleRewriteRequest')).not.toBeNull()
    expect(callbackBody('handleRewriteRedo')).not.toBeNull()
  })

  it('each sends rewriteRequest under its own model key', () => {
    expect(callbackBody('handleRewriteRequest')).toMatch(/callAI\(rewriteRequest\([\s\S]*modelFor\('dog\.rewrite'\)/)
    expect(callbackBody('handleRewriteRedo')).toMatch(/callAI\(rewriteRequest\([\s\S]*modelFor\('dog\.rewriteRedo'\)/)
  })

  it('no copy of the request or of the excerpt is left in the component', () => {
    expect(DOG).not.toContain('STRICT LINE COUNT')
    expect(DOG).not.toContain('FORMATTING DETECTED')
    expect(DOG).not.toMatch(/\.filter\(f => f\.type === 'text'\)\s*\.slice\(0, 2\)/)
    expect(DOG).toContain('deckExcerpt(systemPrompt, uploadedFiles, 800, 500)')
  })
})
