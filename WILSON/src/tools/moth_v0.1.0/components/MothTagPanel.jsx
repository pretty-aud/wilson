// MothTagPanel.jsx — MO3 (0126): typed tags, in M.O.T.H.'s drawer.
//
// What a person sees here is what moth_tags' read policy gives them: the company's tags and their own, never
// anyone else's. They tag the selected thing (a company tag as the company's where they may change the thing, else
// theirs alone; their own tag theirs alone), make a tag of their own (Moth says first if they have it already, if the
// company has those words, or if near words exist), make a type of their own (a shape and a colour), and put one
// of their own forward for the company: the admins see its words and its type's name, never where it is used.
// A live admin also decides what is put forward (approving folds every person's exact match into the company's
// tag, each person's use kept private), and renames, retires and merges the company's tags; a rename shows
// everywhere at once, since every use names the tag, not its words.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Banner, Button, Input, Select } from '../../../ui'
import ItemTags from '../../rabbit_v0.1.0/components/mentions/ItemTags'
import { tagAdvice } from '../state/mothTagWords.js'
import { MTAG_SHAPES } from '../engine/model.js'

const COLOURS = ['mist', 'amber', 'rose', 'violet', 'sky', 'teal', 'lime', 'sand']
const SHAPE_WORDS = { circle: 'Circle', square: 'Square', diamond: 'Diamond', triangle: 'Triangle', hexagon: 'Hexagon', star: 'Star' }
const COLOUR_WORDS = { mist: 'Mist', amber: 'Amber', rose: 'Rose', violet: 'Violet', sky: 'Sky', teal: 'Teal', lime: 'Lime', sand: 'Sand' }
const TAGGABLE = new Set(['project', 'folder', 'file', 'phase', 'asset', 'task', 'scene', 'shot', 'level', 'experience', 'note'])
const live = (t) => t && !t.canonical_id && !t.retired_at

// The database's refusals, in plain words: a raw constraint or policy message is never shown, while words the
// adapter already chose for a refusal are kept.
const rawWords = (m) => !m || /violates|row-level security|permission denied/i.test(m)
function words(err, fallback) {
  if (err?.code === '23505') return 'That is there already.'
  if (err?.code === 'moth_absent') return 'Typed tags are not on this database yet.'
  if (err?.code === '23503' && rawWords(err?.message)) return 'That type cannot be used for this tag.'
  if (err?.code === '42501' && rawWords(err?.message)) return 'You may not change that here.'
  return err?.message || fallback
}
// A change the database made nowhere (no row came back) says so, never 'done'.
const NOT_YOURS = 'Nothing changed: that tag is not one you can change.'
const changed = (row) => {
  if (!row) throw new Error(NOT_YOURS)
  return row
}

export default function MothTagPanel({ adapter, store, workspace, absent, readFailed, readOnly, isAdmin, userId, selectedNode, onChanged }) {
  const [message, setMessage] = useState(null)
  const [busyState, setBusy] = useState(false)
  // Looking back, nothing here changes anything: every part is shut, with the page's own sentence.
  const busy = busyState || !!readOnly
  const [nominations, setNominations] = useState([])
  const tags = useMemo(() => workspace?.mtags || [], [workspace])
  const getAdapter = useCallback(() => adapter, [adapter])
  const types = useMemo(() => workspace?.types || [], [workspace])
  const typeName = useCallback((id) => types.find((ty) => ty.id === id)?.name ?? '', [types])
  const tagsRef = useRef(null)

  const reload = useCallback(async () => {
    await store?.readWorkspace?.()
    // The selected thing's own list is read again too, so a tag just put on shows under it.
    tagsRef.current?.reload?.()
    try { setNominations((await adapter?.listMothTagNominations?.()) || []) } catch { setNominations([]) }
    onChanged?.()
  }, [adapter, onChanged, store])
  useEffect(() => { reload() }, [reload])

  const run = useCallback(async (fn, done) => {
    setBusy(true)
    setMessage(null)
    try {
      await fn()
      if (done) setMessage({ tone: 'success', text: done })
      await reload()
    } catch (err) {
      setMessage({ tone: 'danger', text: words(err, 'That could not be done.') })
    } finally {
      setBusy(false)
    }
  }, [reload])

  // ── Tag the selected thing ──
  const target = selectedNode && TAGGABLE.has(selectedNode.kind) ? { kind: selectedNode.kind, id: selectedNode.rowId } : null
  const [pick, setPick] = useState('')
  const usable = tags.filter(live)
  const tagIt = () => run(async () => {
    const tag = usable.find((t) => t.id === pick)
    if (!tag || !target) return
    if (tag.tier === 'company') {
      try {
        await adapter.assignMothTag({ tagId: tag.id, tier: 'company', targetKind: target.kind, targetId: target.id })
        return
      } catch (err) {
        if (err?.code !== '42501') throw err
      }
    }
    await adapter.assignMothTag({ tagId: tag.id, tier: 'personal', targetKind: target.kind, targetId: target.id })
  }, 'Tagged.')

  // ── A new tag ──
  const [label, setLabel] = useState('')
  const [typeId, setTypeId] = useState('')
  const [forCompany, setForCompany] = useState(false)
  const tagForCompany = isAdmin && forCompany
  // A company tag takes only a company type (0126), so the admin's own types are not offered for one.
  const mineTypes = types.filter((ty) => !ty.retired_at && (ty.tier === 'company' || (!tagForCompany && ty.owner_id === userId)))
  // A type that no longer fits counts as none picked (a type just made fits once the next read brings it).
  const chosenType = mineTypes.some((ty) => ty.id === typeId) ? typeId : ''
  const advice = useMemo(() => tagAdvice(label, { tags, typeId: chosenType || null, userId }), [label, tags, chosenType, userId])
  const forTheCompany = async (fn) => {
    try {
      return await fn()
    } catch (err) {
      if (err?.code === '42501' && rawWords(err?.message)) throw new Error('You may not make that for the company.')
      throw err
    }
  }
  const makeTag = () => run(async () => {
    const make = () => adapter.createMothTag({ typeId: chosenType, tier: tagForCompany ? 'company' : 'personal', label: label.trim() })
    await (tagForCompany ? forTheCompany(make) : make())
    setLabel('')
  }, tagForCompany ? 'The company has a new tag.' : 'You have a new tag, yours alone.')

  // ── A new type ──
  // The type has its own tick, off until ticked: the tag's tick never makes a type the company's. The two ticks read
  // alike and are told apart by their fieldsets' legends (no aria-label: one holding "company" would be one more
  // match for the sign-up page's getByLabel('Company'), which authSelectors.test.js pins).
  const [typeNameDraft, setTypeNameDraft] = useState('')
  const [shape, setShape] = useState('circle')
  const [colour, setColour] = useState('mist')
  const [typeForCompany, setTypeForCompany] = useState(false)
  const typeIsCompany = isAdmin && typeForCompany
  const makeType = () => run(async () => {
    const make = () => adapter.createMothTagType({ tier: typeIsCompany ? 'company' : 'personal', name: typeNameDraft.trim(), shape, colour })
    const row = await (typeIsCompany ? forTheCompany(make) : make())
    setTypeNameDraft('')
    if (row?.id) setTypeId(row.id)
  }, typeIsCompany ? 'The company has a new type.' : 'You have a new type, yours alone.')

  // ── One's own tags, and putting them forward ──
  const mine = tags.filter((t) => t.tier === 'personal' && t.owner_id === userId && !t.canonical_id)
  const openOf = (tagId) => nominations.find((n) => n.tag_id === tagId && n.status === 'open' && n.proposer_id === userId)
  const company = tags.filter((t) => t.tier === 'company' && !t.canonical_id)
  const queue = nominations.filter((n) => n.status === 'open')
  const [renaming, setRenaming] = useState(null)
  const [mergeInto, setMergeInto] = useState({})

  if (absent) {
    return <p className="moth-quiet">Typed tags are not on this database yet.</p>
  }

  return (
    <div className="moth-settings moth-tag-panel">
      {message && <Banner tone={message.tone}>{message.text}</Banner>}
      {readOnly && <p className="moth-quiet" data-moth-tags-read-only>{readOnly}</p>}
      {readFailed && <p className="moth-quiet" data-moth-tags-read-failed>Could not read every tag just now: what was shown before is kept, and these lists may be missing some.</p>}

      <fieldset className="moth-fieldset" disabled={busy}>
        <legend className="moth-tag-legend">The selected thing</legend>
        {target ? (
          <>
            <p className="moth-quiet">{selectedNode.label || 'Untitled'}</p>
            <ItemTags ref={tagsRef} getAdapter={getAdapter} kind={target.kind} id={target.id} onChanged={reload} />
            <div className="moth-tag-row">
              <Select size="sm" value={pick} onChange={(v) => setPick(v ?? '')} placeholder="A tag…" aria-label="A tag for the selected thing"
                options={usable.map((t) => ({ value: t.id, label: `${t.label} · ${typeName(t.type_id)}${t.tier === 'personal' ? ' (yours)' : ''}` }))} />
              <Button size="sm" onClick={tagIt} disabled={!pick}>Tag it</Button>
            </div>
          </>
        ) : <p className="moth-quiet">Select a dot to tag it.</p>}
      </fieldset>

      <fieldset className="moth-fieldset" disabled={busy}>
        <legend className="moth-tag-legend">A new tag</legend>
        <Input size="sm" value={label} onChange={setLabel} placeholder="Its words" aria-label="The new tag's words" />
        <Select size="sm" value={chosenType} onChange={(v) => setTypeId(v ?? '')} placeholder="Its type…" aria-label="The new tag's type"
          options={mineTypes.map((ty) => ({ value: ty.id, label: `${ty.name}${ty.tier === 'personal' ? ' (yours)' : ''}` }))} />
        {isAdmin && (
          <label className="moth-tag-check">
            <input type="checkbox" checked={forCompany} onChange={(e) => setForCompany(e.target.checked)} /> For the company
          </label>
        )}
        {advice.duplicate && <p className="moth-tag-advice" role="status">You have &ldquo;{advice.duplicate.label}&rdquo; already, of this type.</p>}
        {advice.company && !tagForCompany && (
          <p className="moth-tag-advice" role="status">
            The company has &ldquo;{advice.company.label}&rdquo; ({typeName(advice.company.type_id)}).{' '}
            {target
              ? <Button size="sm" variant="ghost" onClick={() => setPick(advice.company.id)}>Use the company&rsquo;s</Button>
              : 'Use it instead of a tag of your own.'}
          </p>
        )}
        {advice.similar.length > 0 && (
          <p className="moth-tag-advice" role="status">Near: {advice.similar.map((t) => `“${t.label}”`).join(', ')}.</p>
        )}
        <Button size="sm" variant="primary" onClick={makeTag} disabled={!label.trim() || !chosenType || !!advice.duplicate}>Make the tag</Button>
      </fieldset>

      <fieldset className="moth-fieldset" disabled={busy}>
        <legend className="moth-tag-legend">A new type</legend>
        <Input size="sm" value={typeNameDraft} onChange={setTypeNameDraft} placeholder="Its name (Character, Location…)" aria-label="The new type's name" />
        <div className="moth-tag-row">
          <Select size="sm" value={shape} onChange={(v) => setShape(v ?? 'circle')} aria-label="The new type's shape"
            options={MTAG_SHAPES.map((s) => ({ value: s, label: SHAPE_WORDS[s] }))} />
          <Select size="sm" value={colour} onChange={(v) => setColour(v ?? 'mist')} aria-label="The new type's colour"
            options={COLOURS.map((c) => ({ value: c, label: COLOUR_WORDS[c] }))} />
        </div>
        {isAdmin && (
          <label className="moth-tag-check">
            <input type="checkbox" checked={typeForCompany} onChange={(e) => setTypeForCompany(e.target.checked)} /> For the company
          </label>
        )}
        <Button size="sm" onClick={makeType} disabled={!typeNameDraft.trim()}>Make the type</Button>
      </fieldset>

      <fieldset className="moth-fieldset" disabled={busy}>
        <legend className="moth-tag-legend">Your own tags</legend>
        {mine.length === 0 ? <p className="moth-quiet">None yet. Only you see the tags you make.</p> : (
          <ul className="moth-tag-list">
            {mine.map((t) => {
              const open = openOf(t.id)
              return (
                <li key={t.id} className="moth-tag-item">
                  <span>{t.label} <span className="moth-quiet">· {typeName(t.type_id)}</span></span>
                  {open ? (
                    <Button size="sm" variant="ghost" onClick={() => run(() => adapter.withdrawMothTagNomination(open.id), 'Withdrawn.')}>Withdraw</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => run(() => adapter.nominateMothTag(t.id), 'Put forward: the admins see its words and its type, never where you use it.')}>
                      Put forward
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => run(async () => {
                    const res = await adapter.deleteMothTag(t.id)
                    if (!res || res.removed === false) throw new Error('Nothing was deleted: that tag is gone already, or not yours to delete.')
                  }, 'Deleted.')}>Delete</Button>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      {isAdmin && (
        <fieldset className="moth-fieldset" disabled={busy}>
          <legend className="moth-tag-legend">Put forward to the company</legend>
          {queue.length === 0 ? <p className="moth-quiet">Nothing waits.</p> : (
            <ul className="moth-tag-list">
              {queue.map((n) => (
                <li key={n.id} className="moth-tag-item">
                  <span>{n.label} <span className="moth-quiet">· {n.type_name}</span>{n.note ? <span className="moth-quiet"> — {n.note}</span> : null}</span>
                  <Button size="sm" variant="primary" onClick={() => run(() => adapter.decideMothTagNomination(n.id, true), 'Approved: it is the company’s now, and each person’s use of their own stays theirs.')}>Approve</Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => adapter.decideMothTagNomination(n.id, false), 'Turned down.')}>Turn down</Button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      <fieldset className="moth-fieldset" disabled={busy}>
        <legend className="moth-tag-legend">The company&rsquo;s tags</legend>
        {company.length === 0 ? <p className="moth-quiet">None yet.</p> : (
          <ul className="moth-tag-list">
            {company.map((t) => (
              <li key={t.id} className="moth-tag-item" data-retired={t.retired_at ? 'true' : 'false'}>
                {isAdmin && renaming?.id === t.id ? (
                  <>
                    <Input size="sm" value={renaming.label} onChange={(v) => setRenaming({ id: t.id, label: v })} aria-label={`A new name for ${t.label}`} />
                    <Button size="sm" variant="primary" onClick={() => run(async () => { changed(await adapter.updateMothTag(t.id, { label: renaming.label.trim() })); setRenaming(null) }, 'Renamed everywhere it is used.')}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </>
                ) : (
                  <span>{t.label} <span className="moth-quiet">· {typeName(t.type_id)}{t.retired_at ? ' · retired' : ''}</span></span>
                )}
                {isAdmin && renaming?.id !== t.id && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: t.id, label: t.label })}>Rename</Button>
                    <Button size="sm" variant="ghost" onClick={() => run(async () => { changed(await adapter.updateMothTag(t.id, { retired: !t.retired_at })) }, t.retired_at ? 'In use again.' : 'Retired: it stays where it is, and is offered no more.')}>
                      {t.retired_at ? 'Bring back' : 'Retire'}
                    </Button>
                    <Select size="sm" value={mergeInto[t.id] ?? ''} onChange={(v) => setMergeInto((m) => ({ ...m, [t.id]: v ?? '' }))} placeholder="Merge into…" aria-label={`Merge ${t.label} into`}
                      options={company.filter((o) => o.id !== t.id && !o.retired_at).map((o) => ({ value: o.id, label: o.label }))} />
                    <Button size="sm" variant="ghost" disabled={!mergeInto[t.id]} onClick={() => run(() => adapter.mergeMothTags(t.id, mergeInto[t.id]), 'Merged: every use now names the one tag.')}>Merge</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </fieldset>
    </div>
  )
}
