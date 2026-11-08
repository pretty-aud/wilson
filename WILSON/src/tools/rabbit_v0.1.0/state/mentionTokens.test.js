// MO3 (0127): the typed link's one rule on the client, read as rabbit_private.moth_mention_keys reads it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mentionKeys, splitMentions, mentionToken, mentionWords, mentionPlainText, isMentionKey } from './mentionTokens'

const KEY = 'a1b2c3d4e5f6'

describe('a typed link in the words', () => {
  it('is [[words|m:key]], its key twelve lower-case hex digits', () => {
    expect(mentionKeys(`See [[Grade it|m:${KEY}]] soon.`)).toEqual([KEY])
    expect(isMentionKey(KEY)).toBe(true)
    expect(isMentionKey('A1B2C3D4E5F6')).toBe(false)
    expect(isMentionKey('a1b2c3d4e5f')).toBe(false)
  })

  it('names each key once, in the order it first appears', () => {
    const b = 'ffffffffffff'
    expect(mentionKeys(`[[x|m:${b}]] and [[y|m:${KEY}]] and [[x|m:${b}]]`)).toEqual([b, KEY])
  })

  it('takes nothing that is not a whole token: no bracket or bar in the words, no capitals in the key', () => {
    expect(mentionKeys(`[[a]b|m:${KEY}]]`)).toEqual([])
    expect(mentionKeys(`[[a|b|m:${KEY}]]`)).toEqual([])
    expect(mentionKeys('[[words|m:A1B2C3D4E5F6]]')).toEqual([])
    expect(mentionKeys(`[[|m:${KEY}]]`)).toEqual([])
    expect(mentionKeys(`[[${'w'.repeat(201)}|m:${KEY}]]`)).toEqual([])
    expect(mentionKeys(`[[${'w'.repeat(200)}|m:${KEY}]]`)).toEqual([KEY])
    expect(mentionKeys(null)).toEqual([])
  })

  it('splits the words into plain runs and links, and reads back to the same text', () => {
    const text = `A [[Mira|m:${KEY}]] by the lamp.`
    const parts = splitMentions(text)
    expect(parts).toEqual([{ text: 'A ' }, { words: 'Mira', key: KEY, raw: `[[Mira|m:${KEY}]]` }, { text: ' by the lamp.' }])
    expect(parts.map(p => p.raw ?? p.text).join('')).toBe(text)
  })

  it('reads as its words alone to someone without the link: nothing points at it', () => {
    expect(mentionPlainText(`A [[Mira|m:${KEY}]] by the lamp.`)).toBe('A Mira by the lamp.')
  })

  it('makes a token only of words it may hold', () => {
    expect(mentionWords('  Grade | it  [now] ')).toBe('Grade it now')
    expect(mentionToken('Mira', KEY)).toBe(`[[Mira|m:${KEY}]]`)
    expect(mentionToken('', KEY)).toBeNull()
    expect(mentionToken('Mira', 'nope')).toBeNull()
    expect(mentionKeys(mentionToken('a]|b[', KEY))).toEqual([KEY])
  })

  it('is the database\'s rule: 0127 reads the same words and key', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/migrations/0127_moth_relationships.sql'), 'utf8')
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION rabbit_private.moth_mention_keys(')
    const body = sql.slice(start, sql.indexOf('$$;', start))
    expect(body).toContain('{1,200}')
    expect(body).toContain('m:([0-9a-f]{12})')
    expect(body).toContain('[:cntrl:]')
  })
})
