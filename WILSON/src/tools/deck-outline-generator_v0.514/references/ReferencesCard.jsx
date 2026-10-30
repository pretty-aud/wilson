// =============================================================================
// ReferencesCard — D.O.G.'s second card: what the deck reads (DG1, 2026-10-16)
//
// Audrey: its own card between the project and uploads card and the deck card
// (Q9), folding away (Q2), names only with a preview on demand (Q4), a meter
// that warns and never blocks (Q8). The design is
// docs/design/DOG_REFERENCES_DESIGN.md §2.2.
//
// The preview window is not drawn here: D.O.G. mounts its windows outside its
// scrolling column (the History and duplicate windows do), so the card hands
// a reference to `onPreview` and useReferencePreview holds the window's state.
//
// DG2 (2026-10-26, Audrey's ask: "lets move the upload documents section in
// dog tool to the 2 References card"): the uploads are the card's first
// group, rows like the other references, with Choose file at the group's
// foot, so the card reads as one list of what the AI reads. The uploads'
// state and handlers stay in D.O.G. (uploadedFiles, isFileLoading,
// handleFileUpload, removeFile) and arrive as one `uploads` prop: the card
// only draws them. What is read, sent, counted and let go of is D.O.G.'s, as
// before. Card 1 is "1 Project".
//
// DG4 (2026-10-28, Audrey: "lets consolidates cards 1 (project) and 2
// (References) into one card"): there is no References card any more. This
// is the lower part of card 1, "1 Project and references", under the
// project's dropdown, in her order (the contract line, Uploads, Items, Files,
// Notes, the meter, Add references); D.O.G. draws the card, its fold
// (`section1Collapsed`) and, in its header, ReferencesCount. Beside Add
// references, Core files only (her note 4): while it is ticked the rows are
// the project's readable Core files and the set chosen in the window steps
// aside (useReferences.js says how).
// =============================================================================

import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  Plus, Eye, X, Boxes, Film, Clapperboard, Gamepad2, Check,
  Sparkles, ListChecks, CalendarRange, Flag, FileText, Image as ImageIcon, Video, StickyNote,
  Upload, Loader2,
} from 'lucide-react';
import { Button, IconButton, Badge, Dialog, Spinner } from '../../../ui';
import { KIND_LABEL, meterState, sizeWarning } from './referenceModel';

export const KIND_GLYPH = {
  asset: Boxes, scene: Film, shot: Clapperboard, level: Gamepad2, experience: Sparkles,
  task: ListChecks, phase: CalendarRange, milestone: Flag, note: StickyNote,
};

export function fileGlyph(dogType) {
  return dogType === 'image' ? ImageIcon : dogType === 'video' ? Video : FileText;
}

/** A chosen row's words: an item says its kind (Scene · The storm). */
export function rowLabel(s) {
  if (!s) return '';
  return s.kind === 'file' || s.kind === 'note' ? s.name : `${KIND_LABEL[s.kind]} · ${s.name}`;
}

const mbOf = (bytes) => `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;

/** The meter's sentence, for the bar, the folded header and screen readers. */
export function meterSentence(m, bytes = 0) {
  const pct = m.tokens > 0 && m.percent === 0 ? 'Less than 1%' : `About ${m.percent}%`;
  const head = m.over
    ? 'Past what D.O.G. can read for one deck: generating may be slow, cost more, or fail.'
    : `${pct} of what D.O.G. can read for one deck`;
  const extra = [];
  if (m.uncounted) extra.push(`${m.uncounted} PDF${m.uncounted === 1 ? '' : 's'} not counted until read`);
  // What Generate will download, once it matters (review round 2, finding 3).
  if (bytes > 25 * 1024 * 1024) extra.push(`about ${mbOf(bytes)} to download`);
  return [head, ...extra].join(' · ');
}

/** The bar, in the card and in the window's footer. */
export function ReferencesMeter({ tokens, uncounted = 0, bytes = 0 }) {
  const m = meterState(tokens, undefined, uncounted);
  const sentence = meterSentence(m, bytes);
  return (
    <div className="dog-refs-meter" data-over={m.over}
      title={`An estimate: about ${m.tokens.toLocaleString()} of ${m.limit.toLocaleString()} tokens`}>
      <div className="dog-refs-meter-track" role="meter" aria-label="How much of what D.O.G. can read for one deck"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(m.percent, 100)} aria-valuetext={sentence}>
        <span className="dog-refs-meter-fill" style={{ width: `${Math.min(100, m.percent)}%` }} />
      </div>
      <p className="dog-refs-meter-words">{sentence}</p>
    </div>
  );
}

/** One reference's preview, opened from the card or the window (R6). */
export function useReferencePreview(refs) {
  const [preview, setPreview] = useState(null);
  const open = async (s) => {
    setPreview({ key: s.key, title: s.name, busy: true, error: '', data: null });
    try {
      const data = await refs.preview(s.key);
      setPreview(p => (p && p.key === s.key ? { ...p, busy: false, data } : p));
    } catch (err) {
      setPreview(p => (p && p.key === s.key ? { ...p, busy: false, error: `It could not be read: ${err?.message || err}` } : p));
    }
  };
  return { preview, open, close: () => setPreview(null) };
}

/** What a preview shows: exactly the words sent, or what is sent instead. */
export function PreviewBody({ preview }) {
  const { busy, error, data, title } = preview;
  return (
    <>
      {busy && <div className="dog-refs-preview-busy"><Spinner /> Reading…</div>}
      {error && <p className="dog-details-note" data-tone="danger" role="alert">{error}</p>}
      {data?.line && <p className="dog-refs-preview-line">{data.line}</p>}
      {data?.image && <img className="dog-refs-preview-image" src={data.image} alt={title} />}
      {data?.text != null && <pre className="dog-refs-preview-text">{data.text}</pre>}
    </>
  );
}

export function previewSubtitle(data) {
  if (!data) return null;
  return data.tokens == null
    ? 'What D.O.G. sends for it · its size could not be counted'
    : `What D.O.G. sends for it · about ${data.tokens.toLocaleString()} tokens`;
}

export function ReferencePreviewDialog({ preview, onClose }) {
  return (
    <Dialog
      title={preview.title || 'Preview'}
      subtitle={previewSubtitle(preview.data)}
      width="reading"
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <PreviewBody preview={preview} />
    </Dialog>
  );
}

const GROUPS = [
  { id: 'items', label: 'Items', test: (s) => s.kind !== 'file' && s.kind !== 'note' },
  { id: 'files', label: 'Files', test: (s) => s.kind === 'file' },
  { id: 'notes', label: 'Notes', test: (s) => s.kind === 'note' },
];

/** The kinds an upload's picker offers, exactly as the upload block had them. */
export const UPLOAD_ACCEPT = '.pdf,.md,.txt,text/plain,text/markdown,application/pdf,image/*,video/*';
/** The uploads' ceiling: Choose file goes at it. D.O.G.'s handleFileUpload
    refuses past it too ("Maximum 20 files allowed"), as before. */
export const UPLOAD_LIMIT = 20;

/** An upload's size, as the upload block's chip showed it. */
export const uploadSize = (bytes) => `(${(bytes / 1024).toFixed(1)} KB)`;

/**
 * Where keyboard focus goes when a control in the card takes itself away (DG2
 * review round 1, finding 1): a row's Remove goes to the next row's Remove,
 * else the previous row's, else Add references; Remove all references and the
 * notice's Undo and Dismiss (round 2, finding 1) go to Add references. Never
 * to <body>, where D.O.G.'s Enter would start a deck with
 * whatever is left. Only keyboard focus moves (`:focus-visible`, decided when
 * focus arrived, as the kit toast's FX14 rule): after a click, focus is left
 * as it was before DG2. DG4: while Core files only holds Add references off,
 * Choose file instead; never the checkbox, a D.O.G. tick box, where Enter
 * makes a deck (enterGenerates.js).
 * @param {HTMLElement} button the control being pressed, still in the page
 * @returns {HTMLElement|null}
 */
export function focusAfterRemove(button) {
  const doc = button?.ownerDocument;
  if (!doc || doc.activeElement !== button) return null;
  let keyboard = true;
  try { keyboard = button.matches(':focus-visible'); } catch { /* no :focus-visible: the keyboard's */ }
  if (!keyboard) return null;
  const body = button.closest('.dog-refs');
  if (!body) return null;
  const add = body.querySelector('.dog-refs-actions .ui-btn:not(:disabled)')
    || body.querySelector('.dog-refs-uploads button.dog-upload');
  // DG4 review round 1, finding 2 (MEASURED): with Core files only holding
  // Add references off and the 20th upload taking Choose file away, the
  // notice's Undo and Dismiss found nothing; a row's Remove is what is left.
  if (!button.classList.contains('dog-refs-remove')) return add === button ? null : (add || body.querySelector('.dog-refs-remove'));
  const all = [...body.querySelectorAll('.dog-refs-remove')];
  const i = all.indexOf(button);
  return all[i + 1] || all[i - 1] || add || null;
}

/** Press a control that takes itself away, keeping keyboard focus in the list. */
function removing(e, remove) {
  const next = focusAfterRemove(e.currentTarget);
  next?.focus();
  remove();
}

/** Whether `el` holds focus from the keyboard (`:focus-visible`, decided when
    focus arrived, as focusAfterRemove reads it). */
function keyboardHeld(el) {
  if (!el || el.ownerDocument.activeElement !== el) return false;
  try { return el.matches(':focus-visible'); } catch { return true; }
}

/**
 * One number for card 1's header: the uploads and what is listed (DG2; DG4:
 * the Core files while Core files only is ticked), and, folded, whether the
 * meter needs a look (review round 2, 9).
 */
export function referencesCount({ refs, uploads = 0, extraTokens = 0, extraUncounted = 0 }) {
  const count = uploads + refs.chosenList.length;
  const m = meterState(refs.chosenTokens + extraTokens, undefined, refs.chosenUncounted + extraUncounted);
  const warn = m.over ? 'over the limit' : m.uncounted ? `${m.uncounted} PDF${m.uncounted === 1 ? '' : 's'} not counted` : '';
  return { text: count ? `${count} chosen` : 'None chosen', warn };
}

/** Card 1's header count (DG4: the card is D.O.G.'s, the words are these). */
export function ReferencesCount(props) {
  const { text, warn } = referencesCount(props);
  return (
    <span className="dog-card-note dog-refs-count">
      {text}
      {warn && <span className="dog-refs-head-warn">{` · ${warn}`}</span>}
    </span>
  );
}

/** Core files only (DG4, Audrey's note 4): its words and its hover. */
export const CORE_LABEL = 'Core files only';
export const CORE_TITLE = 'The deck reads the project’s files marked Core in R.A.B.B.I.T.’s Files tab, instead of what you choose. Your uploads still go.';

/**
 * The one sentence under Core files only, or '' (DG4): why it is off, or,
 * ticked, where the window's choices went. A legacy project on the Local
 * Server counts an older attachment as Core unless it was marked Ref
 * (referenceModel.legacyPoolFiles), so a ticked box says so there.
 */
export function coreLine({ projectChosen, core, coreOnly, setAside = 0 }) {
  const said = [];
  if (!projectChosen) said.push('Core files come from a project: choose one above.');
  else if (core?.state === 'listing') said.push('Looking for the project’s Core files…');
  else if (core?.state === 'failed') said.push('The project’s files could not be listed.');
  else if (core?.state === 'none') said.push('This project has no Core files D.O.G. can read.');
  // Ticked, it also says where the window's choices went, whatever the state
  // (review round 1, finding 6): `setAside` counts only those not listed.
  if (coreOnly) {
    said.push(setAside
      ? `Your ${setAside} chosen reference${setAside === 1 ? ' is' : 's are'} set aside while this is ticked; ${setAside === 1 ? 'it comes' : 'they come'} back when you clear it.`
      : 'Clear this to choose references yourself.');
    if (core?.legacy) said.push('Older attachments count as Core unless marked Ref.');
  }
  return said.join(' ');
}

/**
 * @param {object} props
 * @param {ReturnType<import('./useReferences').useReferences>} props.refs
 * @param {boolean} props.projectChosen
 * @param {number}  props.extraTokens   what else goes: uploads, the deck text, the project's text
 * @param {number}  props.extraUncounted uploaded PDFs whose pages are not known yet
 * @param {() => void} props.onAdd      opens the window
 * @param {(s) => void} props.onPreview opens one reference's preview
 * @param {{ files: Array<{id, file: File, type: string}>, busy: boolean,
 *           add: (e) => void, remove: (id) => void }} props.uploads
 *        D.O.G.'s uploads (DG2): its `uploadedFiles`, `isFileLoading`,
 *        `handleFileUpload` and `removeFile`, drawn here as the first group
 * @param {boolean} [props.offline] a sign-in held at an offline launch (S2):
 *        card 1 says so in its one sentence, so Core files only is off and
 *        says nothing of its own
 */
export default function ReferencesCard({ refs, projectChosen, extraTokens = 0, extraUncounted = 0, onAdd, onPreview, uploads, offline = false }) {
  const fileInput = useRef(null);
  const uploadsGroup = useRef(null);
  const rows = refs.chosenList;
  const uploadFiles = uploads?.files || [];
  // Choose file goes at the 20th upload. Pressed from the keyboard, it took
  // focus to the page with it, and the next Enter there made a deck (DG3,
  // MEASURED); so focus goes to the upload it added, that row's Remove, just
  // above where it was. Only when its last press found it holding keyboard
  // focus (`:focus-visible`, as focusAfterRemove reads it): a click that gave
  // it focus leaves focus as before, while a click on it with the keyboard's
  // ring still on it (a picker closed unused, a file refused) counts as the
  // keyboard's, as the ring does (DG3 review round 1, note 2).
  const keyboardChoose = useRef(false);
  const atLimit = uploadFiles.length >= UPLOAD_LIMIT;
  useLayoutEffect(() => {
    if (!atLimit || !keyboardChoose.current) return;
    keyboardChoose.current = false;
    const doc = uploadsGroup.current?.ownerDocument;
    if (!doc || (doc.activeElement && doc.activeElement !== doc.body)) return;
    const removes = uploadsGroup.current.querySelectorAll('.dog-refs-remove');
    removes[removes.length - 1]?.focus();
  }, [atLimit]);
  // DG4: Core files only goes on only when the chosen project has Core files
  // D.O.G. can read; ticked, it always comes off, so a project changed under
  // it never leaves it stuck. While it is on, the rows are the Core files with
  // no Remove (the Files tab marks them), Add references and Remove all
  // references are off, and the sentence under it says where the window's
  // choices went.
  // S2's rule, merged into this card (her ruling of 2026-10-27, "One offline
  // sentence on each screen"): while a sign-in is held offline the box is off
  // and silent; card 1's offline sentence says why.
  const coreOnly = !!refs.coreOnly;
  const coreOff = !coreOnly && (offline || !projectChosen || refs.core?.state !== 'ready');
  const setAside = coreOnly ? [...(refs.chosen || [])].filter(k => !refs.listedKeys?.has(k)).length : 0;
  const coreSaid = offline && !coreOnly ? '' : coreLine({ projectChosen, core: refs.core, coreOnly, setAside });

  return (
    <div className="dog-refs">
      {refs.notice && (
        <p className="dog-details-note dog-refs-notice" role="status">
          {refs.notice}
          {/* Both take the notice, and themselves, away: from the
              keyboard, focus goes to Add references, never the page
              (review round 2, finding 1). */}
          {refs.undoable && (
            <button type="button" className="dog-refs-dismiss" onClick={(e) => removing(e, refs.undoRemoveAll)}>Undo</button>
          )}
          <button type="button" className="dog-refs-dismiss" onClick={(e) => removing(e, refs.clearNotice)}>Dismiss</button>
        </p>
      )}
      {/* The sentence names everything that goes, so it is true; the
          meter beside it counts the same. PDFs and pictures are stored in
          the AI's file store to be read (the hover says so). DG2: the
          uploads are listed here now, so they are not named apart. DG5:
          "in step 2", not "below", since from a 1280 window the Generate
          outline card sits beside this one (dog.css, THE INPUTS ROW). */}
      <p className="ui-field-hint dog-refs-contract"
        title="PDFs and pictures are placed in the AI's file store to be read. Your notes always travel in the request itself.">
        What goes to the AI: what is listed here, the project&rsquo;s title and description, and what you write in step 2.
      </p>

      {/* DG2 (Audrey, 2026-10-26: "Uploads (n) is the first group, with
          its Choose file button"; "each upload is a row with its glyph,
          name, size and Remove"). Always drawn, so the card is never
          empty. No Preview: an upload is the person's own file, in
          memory, and the eye opens a chosen reference's read. Choose file
          is a kit button (DG3, OUTSTANDING DG2-01: it was a <label> round
          the hidden input, which Tab never reached): Tab stops on it,
          Enter and Space press it, a screen reader hears "Choose file",
          and its press clicks the input, which stays hidden. */}
      <div ref={uploadsGroup} className="dog-refs-group dog-refs-uploads" role="group" aria-label="Uploads">
        <p className="ui-field-label dog-refs-group-label">{`Uploads (${uploadFiles.length})`}</p>
        <p className="ui-field-hint dog-field-hint">Source material for generating slide content (max 20 files)</p>
        {uploadFiles.length > 0 && (
          <ul className="dog-refs-rows">
            {uploadFiles.map(f => {
              const Glyph = fileGlyph(f.type);
              const name = f.file.name;
              return (
                <li key={f.id} className="dog-refs-row">
                  <Glyph className="dog-file-icon" aria-hidden="true" />
                  <span className="dog-refs-name" title={name}>{name}</span>
                  <span className="dog-file-size">{uploadSize(f.file.size)}</span>
                  {f.type === 'video' && <span className="dog-refs-sub">placed only, not read</span>}
                  <IconButton size="sm" icon={X} title={`Remove ${name}`} className="dog-refs-remove"
                    onClick={(e) => removing(e, () => uploads.remove(f.id))} />
                </li>
              );
            })}
          </ul>
        )}
        {uploadFiles.length < UPLOAD_LIMIT && (
          <>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              accept={UPLOAD_ACCEPT}
              onChange={uploads?.add}
            />
            {/* Named by its words; the kinds in brackets are its
                description, so they are still heard. */}
            <Button variant="secondary" className="dog-upload" aria-label="Choose file" aria-describedby="dog-upload-hint"
              onClick={(e) => { keyboardChoose.current = keyboardHeld(e.currentTarget); fileInput.current?.click(); }}>
              {uploads?.busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              <span>Choose file</span>
              <span className="dog-upload-hint" id="dog-upload-hint">(PDF, MD, TXT, images)</span>
            </Button>
          </>
        )}
        {/* The upload's own refusal or read failure, beside Choose file
            (review round 1, finding 2). A new node per refusal
            (`errorKey`), so the same words twice are announced twice
            (review round 2, finding 3). */}
        {uploads?.error && (
          <p key={uploads.errorKey} className="dog-details-note dog-refs-upload-error" data-tone="danger" role="alert">{uploads.error}</p>
        )}
      </div>

      {/* Under the uploads: a project is needed for items and files, not
          for uploads (DG2). Not while a sign-in is held offline (DG4 review
          round 2, finding 2: S2's one sentence is card 1's only words then,
          and notes are a cloud read the hold refuses). */}
      {!projectChosen && !offline && (
        <p className="dog-details-note">
          Choose a project to reference its items and files. Your notes can be referenced without one.
        </p>
      )}

      {GROUPS.map(g => {
        const list = rows.filter(g.test);
        if (!list.length) return null;
        return (
          <div key={g.id} className="dog-refs-group" role="group" aria-label={g.label}>
            <p className="ui-field-label dog-refs-group-label">{`${g.label} (${list.length})`}</p>
            <ul className="dog-refs-rows">
              {list.map(s => {
                const Glyph = s.kind === 'file' ? fileGlyph(s.dogType) : KIND_GLYPH[s.kind];
                const gone = refs.unavailable.has(s.key);
                const label = rowLabel(s);
                const warn = s.kind === 'file' ? sizeWarning(s.dogType, s.size, refs.pdfPages?.get(s.id) || null) : null;
                return (
                  <li key={s.key} className="dog-refs-row" data-unavailable={gone || undefined}>
                    <Glyph className="dog-file-icon" aria-hidden="true" />
                    <span className="dog-refs-name" title={s.trail ? `${s.trail} › ${label}` : label}>{label}</span>
                    {s.isCore && <Badge className="dog-refs-core">Core</Badge>}
                    {!gone && s.dogType === 'video' && <span className="dog-refs-sub">placed only, not read</span>}
                    {gone && <span className="dog-refs-gone">No longer available; it will not be sent</span>}
                    {!gone && warn && <span className="dog-refs-warn">{warn}</span>}
                    <IconButton size="sm" icon={Eye} title={`Preview ${s.name}`} disabled={gone}
                      onClick={() => onPreview?.(s)} />
                    {!coreOnly && (
                      <IconButton size="sm" icon={X} title={`Remove ${s.name}`} className="dog-refs-remove"
                        onClick={(e) => removing(e, () => refs.untick([s.key]))} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <ReferencesMeter tokens={refs.chosenTokens + extraTokens} uncounted={refs.chosenUncounted + extraUncounted}
        bytes={refs.chosenBytes} />

      {/* DG4: the two ways to say what the deck reads, side by side
          (proximity; Fitts: one short reach from Add references). */}
      <div className="dog-refs-actions">
        <Button variant="secondary" onClick={onAdd} disabled={coreOnly}>
          <Plus aria-hidden="true" />
          Add references
        </Button>
        {/* Off is `aria-disabled`, never `disabled` (review rounds 1 and 2,
            finding 1, MEASURED in Chromium): a clear, or a list at Generate
            that finds no Core file or fails, turned the box off under the
            keyboard's focus, which Chromium then dropped on <body>, where
            D.O.G.'s next Enter makes a deck. Off, it keeps focus and stays a
            Tab stop that says why it is off (its sentence); a press does
            nothing. */}
        <span className="dog-check-row">
          <button
            type="button"
            onClick={() => {
              if (coreOff) return;
              if (!coreOnly) refs.loadPool?.();
              refs.setCoreOnly?.(!coreOnly);
            }}
            className="dog-check" data-checked={coreOnly} role="checkbox" aria-checked={coreOnly} aria-label="Core files only"
            aria-describedby={coreSaid ? 'dog-refs-core-said' : undefined}
            aria-disabled={coreOff || undefined}
            title={CORE_TITLE}
          >
            {coreOnly && <Check className="dog-check-glyph" aria-hidden="true" />}
          </button>
          <span className="dog-check-label" title={CORE_TITLE}>Core files only</span>
        </span>
        {/* The chosen references only, with its Undo; an upload goes by
            its own Remove (DG2). Named so, beside Add references, since
            the card now lists uploads it leaves (review round 1, finding
            3). Off with Core files only: the rows are not chosen ones. */}
        {!coreOnly && rows.length > 1 && (
          <Button variant="ghost" title="Removes the chosen items, files and notes. Your uploads stay."
            onClick={(e) => removing(e, refs.removeAll)}>Remove all references</Button>
        )}
      </div>
      {coreSaid && <p id="dog-refs-core-said" className="dog-details-note dog-refs-core-said">{coreSaid}</p>}
    </div>
  );
}
