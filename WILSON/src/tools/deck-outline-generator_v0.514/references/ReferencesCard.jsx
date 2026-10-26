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
// =============================================================================

import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight, Plus, Eye, X, Boxes, Film, Clapperboard, Gamepad2,
  Sparkles, ListChecks, CalendarRange, Flag, FileText, Image as ImageIcon, Video, StickyNote,
} from 'lucide-react';
import { Card, Button, IconButton, Badge, Dialog, Spinner } from '../../../ui';
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

/**
 * @param {object} props
 * @param {ReturnType<import('./useReferences').useReferences>} props.refs
 * @param {boolean} props.projectChosen
 * @param {number}  props.extraTokens   what else goes: uploads, the deck text, the project's text
 * @param {number}  props.extraUncounted uploaded PDFs whose pages are not known yet
 * @param {() => void} props.onAdd      opens the window
 * @param {(s) => void} props.onPreview opens one reference's preview
 */
export default function ReferencesCard({ refs, projectChosen, extraTokens = 0, extraUncounted = 0, onAdd, onPreview }) {
  const [collapsed, setCollapsed] = useState(false);
  const rows = refs.chosenList;
  const count = rows.length;
  const m = meterState(refs.chosenTokens + extraTokens, undefined, refs.chosenUncounted + extraUncounted);
  // Folded, the card still says when the meter needs a look (review round 2, 9).
  const headWarn = m.over ? 'over the limit' : m.uncounted ? `${m.uncounted} PDF${m.uncounted === 1 ? '' : 's'} not counted` : '';

  return (
    <Card pad={false} className="dog-card dog-refs">
      <header
        className="ui-panel-head dog-card-head"
        data-collapsible="true"
        data-collapsed={collapsed}
        onClick={() => setCollapsed(c => !c)}
      >
        <h2 className="ui-panel-title dog-card-title dog-step-title">
          <span className="dog-step">2</span>
          <span id="dog-refs-title">References</span>
        </h2>
        <div className="ui-panel-actions">
          <span className="dog-card-note dog-refs-count">
            {count ? `${count} chosen` : 'None chosen'}
            {headWarn && <span className="dog-refs-head-warn">{` · ${headWarn}`}</span>}
          </span>
          {/* FX14 (FX13-01): the fold from the keyboard, as D.O.G.'s cards 1
              and 3 have it. No handler of its own: Enter and Space click it
              and the click reaches the bar's one handler, as a pointer's
              does. */}
          <IconButton
            size="sm"
            icon={collapsed ? ChevronRight : ChevronDown}
            aria-labelledby="dog-refs-title"
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : 'dog-refs-body'}
          />
        </div>
      </header>

      {!collapsed && (
        <div className="dog-card-body" id="dog-refs-body">
          {refs.notice && (
            <p className="dog-details-note dog-refs-notice" role="status">
              {refs.notice}
              {refs.undoable && (
                <button type="button" className="dog-refs-dismiss" onClick={refs.undoRemoveAll}>Undo</button>
              )}
              <button type="button" className="dog-refs-dismiss" onClick={refs.clearNotice}>Dismiss</button>
            </p>
          )}
          {/* The sentence names everything that goes, so it is true; the
              meter beside it counts the same. PDFs and pictures are stored in
              the AI's file store to be read (the hover says so). */}
          <p className="ui-field-hint dog-refs-contract"
            title="PDFs and pictures are placed in the AI's file store to be read. Your notes always travel in the request itself.">
            What goes to the AI: your uploads, what is listed here, and the project&rsquo;s title and description, with what you write below.
          </p>
          {!projectChosen && (
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
                        <IconButton size="sm" icon={X} title={`Remove ${s.name}`} className="dog-refs-remove"
                          onClick={() => refs.untick([s.key])} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          <ReferencesMeter tokens={refs.chosenTokens + extraTokens} uncounted={refs.chosenUncounted + extraUncounted}
            bytes={refs.chosenBytes} />

          <div className="dog-refs-actions">
            <Button variant="secondary" onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add references
            </Button>
            {count > 1 && (
              <Button variant="ghost" onClick={refs.removeAll}>Remove all</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
