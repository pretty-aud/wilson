// MO3 (0126, 0127): the one picker behind `[[` and `#` in R.A.B.B.I.T.'s text and in a note.
//
// The field tells it the text before the caret, and may tell it the text after (update); it says whether a list is
// open, what is in it and which is lit; a key it takes (keyDown) moves the light, picks or closes. A pick answers
// { start, text }: the field replaces what was typed from `start` to the caret with `text`. A caret inside a saved
// token's words asks nothing, so a pick never cuts a link in two.
//   `[[` words   offers the things the person sees, by name (moth_mention_candidates); picking one reserves a key
//                for it (moth_mention_reserve) and answers the token [[name|m:key]]. The words are saved with the
//                field, and the server makes the link then.
//   `#` word     offers the company's tags and the person's own (moth_tags' read policy); picking one tags the thing
//                being written (`target`) at once and answers '' — a tag is the thing's chip, never prose, and a
//                person's own tag never reaches a shared text. A company tag on something the person may not change
//                is kept as theirs alone, and the picker says so (`notice`, which outlives the list).
// Enter picks the lit row: in a link list the first is lit, in a tag list none until an arrow lights one, so a `#12`
// typed and Entered stays text. Escape closes. Nothing is asked of a database before 0126 or 0127: the list says so.

import { useCallback, useEffect, useRef, useState } from 'react'
import { mentionTrigger, mentionToken, insideMention } from '../../state/mentionTokens'

const ABSENT = 'moth_absent'
export const FALLBACK_NOTICE = "You can't tag this for everyone, so this tag is only yours here."
const LINK_LIMIT = 8
const TAG_LIMIT = 8

function tagMatches(tags, query) {
  const q = String(query || '').trim().toLowerCase()
  const live = (tags || []).filter(t => !t.canonical_id && !t.retired_at)
  const scored = live
    .map(t => ({ t, l: String(t.label || '').toLowerCase() }))
    .filter(({ l }) => !q || l.includes(q))
    .sort((a, b) => (a.l === q ? 0 : a.l.startsWith(q) ? 1 : 2) - (b.l === q ? 0 : b.l.startsWith(q) ? 1 : 2)
      || (a.t.tier === b.t.tier ? 0 : a.t.tier === 'company' ? -1 : 1)
      || a.l.localeCompare(b.l))
  return scored.slice(0, TAG_LIMIT).map(({ t }) => t)
}

export function useMentionPicker({ getAdapter, target = null, onTagged = null } = {}) {
  const [trigger, setTrigger] = useState(null)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(-1)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  // What a pick did that the person would not guess, said after the list has closed (close leaves it).
  const [notice, setNotice] = useState(null)
  // A pick in flight: a second press (a double-click, a held Enter) waits for it instead of reserving another key
  // and splicing at a caret the first answer has moved.
  const busyRef = useRef(false)
  // The list's closings, counted: a link pick whose list was closed while its key was being reserved (Escape, or
  // the asking typed away) puts nothing in.
  const closedRef = useRef(0)
  const seqRef = useRef(0)
  const timerRef = useRef(null)
  const tagsRef = useRef(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  const adapter = useCallback(() => (typeof getAdapter === 'function' ? getAdapter() : null), [getAdapter])

  const close = useCallback(() => {
    seqRef.current += 1
    closedRef.current += 1
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    busyRef.current = false
    setTrigger(null); setItems([]); setActive(-1); setMessage(null); setBusy(false)
  }, [])

  const update = useCallback((textBefore, textAfter = '') => {
    const before = typeof textBefore === 'string' ? textBefore : ''
    if (textAfter && insideMention(before + String(textAfter), before.length)) { if (trigger) close(); return }
    const next = mentionTrigger(before)
    if (!next || (next.mode === 'tag' && !target)) { if (trigger) close(); return }
    // A new search lights nothing until its own rows land, so an Enter typed meanwhile never picks an old row.
    if (!trigger || trigger.mode !== next.mode || trigger.query !== next.query || trigger.start !== next.start) setActive(-1)
    if (!trigger) setNotice(null)
    setTrigger(next)
    const seq = ++seqRef.current
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      timerRef.current = null
      const a = adapter()
      try {
        let rows = []
        if (next.mode === 'link') {
          if (typeof a?.listMothMentionCandidates !== 'function') throw Object.assign(new Error(''), { code: ABSENT })
          rows = await a.listMothMentionCandidates(next.query, LINK_LIMIT)
        } else {
          if (typeof a?.listMothTags !== 'function') throw Object.assign(new Error(''), { code: ABSENT })
          if (!tagsRef.current) tagsRef.current = await a.listMothTags()
          rows = tagMatches(tagsRef.current, next.query)
        }
        if (!mountedRef.current || seq !== seqRef.current) return
        setItems(Array.isArray(rows) ? rows : [])
        setActive(next.mode === 'link' && rows.length ? 0 : -1)
        setMessage(rows.length ? null : (next.mode === 'link' ? 'Nothing you can see is called that.' : 'No tag of that name.'))
      } catch (err) {
        if (!mountedRef.current || seq !== seqRef.current) return
        setItems([]); setActive(-1)
        setMessage(err?.code === ABSENT
          ? (next.mode === 'link' ? 'Links are not on this database yet.' : 'Typed tags are not on this database yet.')
          : (err?.message || 'The list could not be read.'))
      }
    }, 150)
  }, [adapter, close, target, trigger])

  const pick = useCallback(async (index = active) => {
    if (busyRef.current) return null
    const item = items[index]
    if (!trigger || !item) return null
    const a = adapter()
    busyRef.current = true
    setBusy(true)
    setNotice(null)
    try {
      if (trigger.mode === 'link') {
        const shut = closedRef.current
        const key = await a.reserveMothMention(item.kind, item.id)
        if (closedRef.current !== shut) return null
        const text = mentionToken(item.name, key)
        close()
        return text ? { start: trigger.start, text: `${text} ` } : null
      }
      const company = item.tier === 'company'
      let row = null
      let mine = !company
      try {
        row = await a.assignMothTag({ tagId: item.id, tier: company ? 'company' : 'personal', targetKind: target.kind, targetId: target.id })
      } catch (err) {
        // A company tag on something this person may not change is theirs alone; anything else is said as it is.
        if (!company || err?.code !== '42501') throw err
        row = await a.assignMothTag({ tagId: item.id, tier: 'personal', targetKind: target.kind, targetId: target.id })
        mine = true
      }
      close()
      // A refused company tag kept as the person's own is said in words: the chip's "yours" alone would let them
      // believe everyone sees it.
      if (company && mine && mountedRef.current) setNotice(FALLBACK_NOTICE)
      onTagged?.(row, item, { mine, fallback: company && mine })
      return { start: trigger.start, text: '' }
    } catch (err) {
      busyRef.current = false
      if (mountedRef.current) {
        setBusy(false)
        setMessage(err?.code === '23505' ? 'It has that tag already.' : (err?.message || 'That could not be done.'))
      }
      return null
    }
  }, [active, adapter, close, items, onTagged, target, trigger])

  // A key the open list takes. 'pick' means the field should await pick(); 'handled' that it took the key.
  const keyDown = useCallback((e) => {
    if (!trigger) return null
    // Keys an input method is using to choose its word (Japanese, Chinese, Korean) are its own, not the list's.
    if (e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229) return null
    // While a pick is in flight, a second Enter or Tab neither picks again nor reaches the field as a new line.
    if (busyRef.current && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); e.stopPropagation(); return 'handled' }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return 'handled' }
    if (!items.length) return null
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % items.length); return 'handled' }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? items.length - 1 : i - 1)); return 'handled' }
    if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) { e.preventDefault(); e.stopPropagation(); return 'pick' }
    return null
  }, [active, close, items.length, trigger])

  return { open: !!trigger, mode: trigger?.mode ?? null, query: trigger?.query ?? '', items, active, setActive, message, notice, busy, update, pick, keyDown, close }
}
