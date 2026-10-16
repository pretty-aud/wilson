// =============================================================================
// ReferencesPicker — the "Add references" window (DG1, 2026-10-16)
//
// Audrey's Q10: "A window with ticks": one search, Items / Files / Notes down
// the left, tick boxes to choose many, the quick choices (all Core files,
// today's, a range of dates: Q2, Q18), a folder's tick (Q11), an item's files
// listed under it (Q3), and a Preview on each row (Q4). Ticks apply at once;
// Done and Escape both close and keep them. The design is
// docs/design/DOG_REFERENCES_DESIGN.md §2.3.
//
// Everything listed comes from the pool (referenceModel.buildPool), which has
// already removed what may never be offered (Legal, money, trashed files), so
// no control here (a folder's tick, a quick choice, a search) can reach one.
// =============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Minus, Eye, X, ChevronRight, ChevronDown, Folder, Search } from 'lucide-react';
import { Dialog, Button, IconButton, Badge, EmptyState, Spinner, StatusDot } from '../../../ui';
import {
  KIND_LABEL_PLURAL, shownKinds, childFolders, filesInFolder, fileKeysUnderFolder,
  tickState, folderTrail, filesOfItem, coreFileKeys, fileKeysAddedBetween,
  noteKeysDatedBetween, localDay,
} from './referenceModel';
import { KIND_GLYPH, fileGlyph, ReferencesMeter, PreviewBody, previewSubtitle, pdfWarning } from './ReferencesCard';

function CheckBox({ state }) {
  return (
    <span className="dog-check" data-checked={state !== 'none'} aria-hidden="true">
      {state === 'all' && <Check className="dog-check-glyph" />}
      {state === 'some' && <Minus className="dog-check-glyph" />}
    </span>
  );
}

/** One choosable row: the tick and the words are one target (Fitts). */
function PickRow({ entry, checked, onToggle, onPreview, sub, warn = null, trailing = null, nested = null, depth = 0 }) {
  const Glyph = entry.kind === 'file' ? fileGlyph(entry.dogType) : KIND_GLYPH[entry.kind];
  return (
    <li className="dog-refs-pick-item">
      <div className="dog-refs-pick-row" data-depth={depth || undefined}>
        <button type="button" role="checkbox" aria-checked={checked} aria-label={entry.name}
          className="dog-refs-pick-main" onClick={onToggle}>
          <CheckBox state={checked ? 'all' : 'none'} />
          <Glyph className="dog-file-icon" aria-hidden="true" />
          {entry.status && <StatusDot status={entry.status} />}
          <span className="dog-refs-name">{entry.name}</span>
          {entry.kind === 'file' && entry.isCore && <Badge className="dog-refs-core">Core</Badge>}
          {sub && <span className="dog-refs-sub">{sub}</span>}
          {warn && <span className="dog-refs-warn">{warn}</span>}
        </button>
        {trailing}
        <IconButton size="sm" icon={Eye} title={`Preview ${entry.name}`} onClick={onPreview} />
      </div>
      {nested}
    </li>
  );
}

const today = () => localDay(new Date().toISOString());

/**
 * @param {object} props
 * @param {ReturnType<import('./useReferences').useReferences>} props.refs
 * @param {string}  props.projectTitle  '' when no project is chosen
 * @param {number}  props.extraTokens
 * @param {number}  props.extraUncounted
 * @param {boolean} props.localServer   the Local Server: an item's files are not linked to it there
 * @param {() => void} props.onClose
 */
export default function ReferencesPicker({ refs, projectTitle, extraTokens = 0, extraUncounted = 0, localServer = false, onClose }) {
  const { pool, poolBusy, chosen } = refs;
  const [query, setQuery] = useState('');
  const [section, setSection] = useState(projectTitle ? 'files' : 'notes');
  const [folderId, setFolderId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [range, setRange] = useState({ from: '', to: '' });
  const [noteRange, setNoteRange] = useState({ from: '', to: '' });
  const [preview, setPreview] = useState(null);
  const listRef = useRef(null);

  // Listed every time the window opens: a cheap list, never a body.
  useEffect(() => { refs.loadPool(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = useMemo(() => (pool && projectTitle ? shownKinds(pool) : []), [pool, projectTitle]);
  const errs = Object.values(pool?.errors || {});
  const signedOut = errs.length > 0 && errs.every(e => /no active session|sign in|not signed in|unauthori[sz]ed|jwt/i.test(String(e)));
  const warnOf = (f) => (f.dogType === 'pdf' ? pdfWarning(refs.pdfPages?.get(f.id)) : null);
  const q = query.trim().toLowerCase();
  const isChosen = (key) => chosen.has(key);
  const flip = (key) => refs.toggle(key);

  const openPreview = async (entry) => {
    setPreview({ key: entry.key, title: entry.name, busy: true, data: null, error: '' });
    try {
      const data = await refs.preview(entry.key);
      setPreview(p => (p && p.key === entry.key ? { ...p, busy: false, data } : p));
    } catch (err) {
      setPreview(p => (p && p.key === entry.key ? { ...p, busy: false, error: `It could not be read: ${err?.message || err}` } : p));
    }
  };

  // ── The rail ──────────────────────────────────────────────────────────────
  const railItem = (id, label, count, { disabled = false, note = '' } = {}) => (
    <li key={id}>
      <button type="button" className="dog-refs-rail-item" aria-current={section === id && !q ? 'true' : undefined}
        disabled={disabled} onClick={() => { setSection(id); setQuery(''); }}>
        <span className="dog-refs-rail-name">{label}</span>
        <span className="dog-refs-rail-count">{note || count}</span>
      </button>
    </li>
  );

  const rail = (
    <nav className="dog-refs-rail" aria-label="What to choose from">
      <p className="ui-field-label dog-refs-rail-head">Items</p>
      <ul>
        {projectTitle
          ? kinds.map(k => railItem(`items:${k}`, KIND_LABEL_PLURAL[k],
            pool?.errors?.[k] ? '—' : (pool?.items?.[k]?.length ?? 0)))
          : railItem('items:none', 'Choose a project first', '', { disabled: true })}
      </ul>
      <p className="ui-field-label dog-refs-rail-head">Files</p>
      <ul>
        {railItem('files', 'Files', pool?.errors?.files ? '—' : (pool?.files?.length ?? 0),
          { disabled: !projectTitle, note: projectTitle ? '' : '—' })}
      </ul>
      <p className="ui-field-label dog-refs-rail-head">Notes</p>
      <ul>
        {railItem('notes', 'Your notes', pool?.notes?.length ?? 0,
          { note: pool && pool.notes === null ? 'Cloud only' : '' })}
      </ul>
    </nav>
  );

  // ── Item rows, with their files under them (Q3) ───────────────────────────
  const itemRow = (entry) => {
    const own = filesOfItem(pool, entry.kind, entry.id);
    const open = expanded.has(entry.key);
    return (
      <PickRow key={entry.key} entry={entry} checked={isChosen(entry.key)} onToggle={() => flip(entry.key)}
        onPreview={() => openPreview(entry)}
        trailing={own.length > 0 && (
          <button type="button" className="dog-refs-pick-files" aria-expanded={open}
            onClick={() => setExpanded(cur => { const n = new Set(cur); if (n.has(entry.key)) n.delete(entry.key); else n.add(entry.key); return n; })}>
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {`${own.length} file${own.length === 1 ? '' : 's'}`}
          </button>
        )}
        nested={open && own.length > 0 && (
          <ul className="dog-refs-pick-nested">
            {own.map(f => (
              <PickRow key={f.key} entry={f} depth={1} checked={isChosen(f.key)} onToggle={() => flip(f.key)}
                onPreview={() => openPreview(f)} />
            ))}
          </ul>
        )} />
    );
  };

  // ── Files: one folder at a time, as the Files tab (Q11) ──────────────────
  const fileQuick = pool && (() => {
    const core = coreFileKeys(pool);
    const day = today();
    const todays = fileKeysAddedBetween(pool, day, day);
    const ranged = fileKeysAddedBetween(pool, range.from, range.to);
    const undated = (pool.files || []).filter(f => !f.uploadedAt).length;
    return (
      <div className="dog-refs-quick" role="group" aria-label="Quick choices for files">
        <Button size="sm" variant="secondary" disabled={!core.length} onClick={() => refs.tick(core)}>
          {`All Core files (${core.length})`}
        </Button>
        <Button size="sm" variant="secondary" disabled={!todays.length} onClick={() => refs.tick(todays)}>
          {`Added today (${todays.length})`}
        </Button>
        <span className="dog-refs-quick-dates">
          <label className="dog-refs-quick-date">Added from
            <input type="date" className="ui-input" data-size="sm" data-surface="dark" value={range.from}
              onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          </label>
          <label className="dog-refs-quick-date">to
            <input type="date" className="ui-input" data-size="sm" data-surface="dark" value={range.to}
              onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          </label>
          <Button size="sm" variant="secondary" disabled={!ranged.length} onClick={() => refs.tick(ranged)}>
            {`Tick these (${ranged.length})`}
          </Button>
        </span>
        {undated > 0 && <span className="dog-refs-sub">{`${undated} without a date ${undated === 1 ? 'is' : 'are'} not included`}</span>}
      </div>
    );
  })();

  const filesView = () => {
    if (pool?.errors?.files) return <div title={pool.errors.files}><EmptyState compact title="The project's files could not be listed" /></div>;
    const trail = folderTrail(pool, folderId);
    const parents = [];
    { // the folder chain for the path buttons
      const byId = new Map((pool?.folders || []).map(f => [f.id, f]));
      let f = folderId ? byId.get(folderId) : null;
      while (f) { parents.unshift(f); f = f.parentId ? byId.get(f.parentId) : null; }
    }
    const folders = childFolders(pool, folderId);
    const files = filesInFolder(pool, folderId);
    return (
      <>
        {fileQuick}
        <div className="dog-refs-path" aria-label="Folder path">
          <button type="button" className="dog-refs-path-step" onClick={() => setFolderId(null)}>Files</button>
          {parents.map((f, i) => (
            <React.Fragment key={f.id}>
              <ChevronRight className="dog-refs-path-sep" aria-hidden="true" />
              <button type="button" className="dog-refs-path-step" aria-current={i === parents.length - 1 ? 'true' : undefined}
                onClick={() => setFolderId(f.id)}>{trail[i]}</button>
            </React.Fragment>
          ))}
        </div>
        {folders.length === 0 && files.length === 0 && <EmptyState compact title="Nothing here D.O.G. can use" />}
        <ul className="dog-refs-pick-list">
          {folders.map(f => {
            const keys = fileKeysUnderFolder(pool, f.id);
            const state = tickState(keys, chosen);
            return (
              <li key={f.id} className="dog-refs-pick-item">
                <div className="dog-refs-pick-row">
                  <button type="button" role="checkbox" className="dog-refs-pick-check"
                    aria-checked={state === 'some' ? 'mixed' : state === 'all'}
                    aria-label={`Choose everything in ${f.name}`} disabled={!keys.length}
                    onClick={() => (state === 'all' ? refs.untick(keys) : refs.tick(keys))}>
                    <CheckBox state={state} />
                  </button>
                  <button type="button" className="dog-refs-pick-open" onClick={() => setFolderId(f.id)}>
                    <Folder className="dog-file-icon" aria-hidden="true" />
                    <span className="dog-refs-name">{f.name}</span>
                    <span className="dog-refs-sub">{`${keys.length} file${keys.length === 1 ? '' : 's'}`}</span>
                    <ChevronRight className="dog-refs-open-glyph" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
          {files.map(f => (
            <PickRow key={f.key} entry={f} checked={isChosen(f.key)} onToggle={() => flip(f.key)}
              onPreview={() => openPreview(f)} sub={f.source === 'legacy' ? 'Older attachment' : null} warn={warnOf(f)} />
          ))}
        </ul>
      </>
    );
  };

  // ── Notes (Q5, Q7, Q18) ───────────────────────────────────────────────────
  const notesView = () => {
    if (pool && pool.notes === null) {
      return <EmptyState compact title="Notes need the cloud"
        description="Your notes live in WILSON's cloud; on the Local Server there are none to choose." />;
    }
    if (pool?.errors?.notes) return <div title={pool.errors.notes}><EmptyState compact title="Your notes could not be listed" /></div>;
    const notes = pool?.notes || [];
    const day = today();
    const todays = noteKeysDatedBetween(pool, day, day);
    const ranged = noteKeysDatedBetween(pool, noteRange.from, noteRange.to);
    const undatedNotes = notes.filter(n => !n.noteDate).length;
    return (
      <>
        <div className="dog-refs-quick" role="group" aria-label="Quick choices for notes">
          <Button size="sm" variant="secondary" disabled={!todays.length} onClick={() => refs.tick(todays)}>
            {`Dated today (${todays.length})`}
          </Button>
          <span className="dog-refs-quick-dates">
            <label className="dog-refs-quick-date">Dated from
              <input type="date" className="ui-input" data-size="sm" data-surface="dark" value={noteRange.from}
                onChange={e => setNoteRange(r => ({ ...r, from: e.target.value }))} />
            </label>
            <label className="dog-refs-quick-date">to
              <input type="date" className="ui-input" data-size="sm" data-surface="dark" value={noteRange.to}
                onChange={e => setNoteRange(r => ({ ...r, to: e.target.value }))} />
            </label>
            <Button size="sm" variant="secondary" disabled={!ranged.length} onClick={() => refs.tick(ranged)}>
              {`Tick these (${ranged.length})`}
            </Button>
          </span>
          {undatedNotes > 0 && <span className="dog-refs-sub">{`${undatedNotes} without a date ${undatedNotes === 1 ? 'is' : 'are'} not included`}</span>}
        </div>
        {notes.length === 0
          ? <EmptyState compact title="You have no notes yet" />
          : (
            <ul className="dog-refs-pick-list">
              {notes.map(n => (
                <PickRow key={n.key} entry={n} checked={isChosen(n.key)} onToggle={() => flip(n.key)}
                  onPreview={() => openPreview(n)} sub={[n.subject, n.noteDate].filter(Boolean).join(' · ') || null} />
              ))}
            </ul>
          )}
      </>
    );
  };

  // ── Search: every group at once ───────────────────────────────────────────
  const searchView = () => {
    const groups = [];
    for (const k of kinds) {
      const hits = (pool?.items?.[k] || []).filter(e => e.name.toLowerCase().includes(q));
      if (hits.length) groups.push({ id: k, label: KIND_LABEL_PLURAL[k], rows: hits.map(itemRow) });
    }
    const fileHits = (pool?.files || []).filter(f => f.name.toLowerCase().includes(q));
    if (projectTitle && fileHits.length) {
      groups.push({ id: 'files', label: 'Files', rows: fileHits.map(f => (
        <PickRow key={f.key} entry={f} checked={isChosen(f.key)} onToggle={() => flip(f.key)}
          onPreview={() => openPreview(f)} sub={folderTrail(pool, f.folderId).join(' › ') || null} warn={warnOf(f)} />
      )) });
    }
    const noteHits = (pool?.notes || []).filter(n => `${n.name} ${n.subject || ''}`.toLowerCase().includes(q));
    if (noteHits.length) {
      groups.push({ id: 'notes', label: 'Your notes', rows: noteHits.map(n => (
        <PickRow key={n.key} entry={n} checked={isChosen(n.key)} onToggle={() => flip(n.key)}
          onPreview={() => openPreview(n)} sub={[n.subject, n.noteDate].filter(Boolean).join(' · ') || null} />
      )) });
    }
    if (!groups.length) return <EmptyState compact title="No matches" />;
    return groups.map(g => (
      <div key={g.id} className="dog-refs-group" role="group" aria-label={g.label}>
        <p className="ui-field-label dog-refs-group-label">{`${g.label} (${g.rows.length})`}</p>
        <ul className="dog-refs-pick-list">{g.rows}</ul>
      </div>
    ));
  };

  const body = () => {
    if (!pool) return <div className="dog-refs-preview-busy"><Spinner /> Listing what you can choose…</div>;
    if (signedOut) return <EmptyState compact title="Sign in to reference this project's items, files and your notes" />;
    if (q) return searchView();
    if (section === 'files') return filesView();
    if (section === 'notes') return notesView();
    const kind = section.slice('items:'.length);
    if (pool.errors?.[kind]) return <div title={pool.errors[kind]}><EmptyState compact title={`${KIND_LABEL_PLURAL[kind]} could not be listed`} /></div>;
    const rows = pool.items?.[kind] || [];
    if (!rows.length) return <EmptyState compact title={`No ${KIND_LABEL_PLURAL[kind].toLowerCase()} in this project`} />;
    return (
      <>
        {localServer && ['scene', 'shot', 'level', 'experience'].includes(kind) && (
          <p className="dog-details-note">On this computer a {KIND_LABEL_PLURAL[kind].toLowerCase().slice(0, -1)}&rsquo;s own files are not listed under it; find them under Files.</p>
        )}
        <ul className="dog-refs-pick-list">{rows.map(itemRow)}</ul>
      </>
    );
  };

  // Backspace goes up a folder, as in the Files tab (never from a text field).
  const onListKey = (e) => {
    if (e.key !== 'Backspace' || section !== 'files' || q || !folderId) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    const f = (pool?.folders || []).find(x => x.id === folderId);
    setFolderId(f?.parentId || null);
  };

  return (
    <Dialog
      title="Add references"
      subtitle={projectTitle ? `From ${projectTitle}, and your notes` : 'Your notes'}
      width="workbench"
      onClose={onClose}
      className="dog-refs-dialog"
      footer={(
        <div className="dog-refs-foot">
          <ReferencesMeter tokens={refs.chosenTokens + extraTokens} uncounted={refs.chosenUncounted + extraUncounted} />
          <span className="dog-refs-foot-count">{`${chosen.size} chosen`}</span>
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      )}
    >
      <div className="dog-refs-search">
        <Search className="dog-refs-search-icon" aria-hidden="true" />
        <input type="text" className="ui-input" data-size="md" data-surface="dark" value={query}
          onChange={e => setQuery(e.target.value)} placeholder="Search items, files and notes"
          aria-label="Search items, files and notes" />
        {poolBusy && <Spinner />}
      </div>
      <div className="dog-refs-layout" data-preview={preview ? 'true' : undefined}>
        {rail}
        <div className="dog-refs-list" ref={listRef} onKeyDown={onListKey}>{body()}</div>
        {preview && (
          <aside className="dog-refs-preview" aria-label={`Preview of ${preview.title}`}>
            <div className="dog-refs-preview-head">
              <span className="dog-refs-name">{preview.title}</span>
              <IconButton size="sm" icon={X} title="Close the preview" onClick={() => setPreview(null)} />
            </div>
            {preview.data && <p className="dog-refs-sub">{previewSubtitle(preview.data)}</p>}
            <PreviewBody preview={preview} />
          </aside>
        )}
      </div>
    </Dialog>
  );
}
