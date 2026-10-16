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
import { KIND_LABEL, meterState, PDF_PAGE_LIMIT } from './referenceModel';

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

/** The warning a PDF's row carries once its pages are known. */
export function pdfWarning(pages) {
  return pages && pages > PDF_PAGE_LIMIT
    ? `${pages} pages: the AI may refuse a PDF over ${PDF_PAGE_LIMIT}`
    : null;
}

/** The bar, in the card and in the window's footer. */
export function ReferencesMeter({ tokens, uncounted = 0 }) {
  const m = meterState(tokens, undefined, uncounted);
  const fill = Math.min(100, m.percent);
  const rest = m.uncounted
    ? ` · ${m.uncounted} PDF${m.uncounted === 1 ? '' : 's'} not counted until read`
    : '';
  return (
    <div className="dog-refs-meter" data-over={m.over}
      title={`An estimate: about ${m.tokens.toLocaleString()} of ${m.limit.toLocaleString()} tokens`}>
      <div className="dog-refs-meter-track" role="meter" aria-label="How much of what D.O.G. can read for one deck"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(m.percent, 999)}>
        <span className="dog-refs-meter-fill" style={{ width: `${fill}%` }} />
      </div>
      <p className="dog-refs-meter-words">
        {m.over
          ? `Past what D.O.G. can read for one deck: generating may be slow, cost more, or fail.${rest}`
          : `${m.tokens > 0 && m.percent === 0 ? 'Less than 1%' : `About ${m.percent}%`} of what D.O.G. can read for one deck${rest}`}
      </p>
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
    ? 'What D.O.G. sends for it · counted once it is read'
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
          References
        </h2>
        <div className="ui-panel-actions">
          <span className="dog-card-note dog-refs-count">{count ? `${count} chosen` : 'None chosen'}</span>
          {collapsed
            ? <ChevronRight className="dog-chevron" aria-hidden="true" />
            : <ChevronDown className="dog-chevron" aria-hidden="true" />}
        </div>
      </header>

      {!collapsed && (
        <div className="dog-card-body">
          {refs.notice && (
            <p className="dog-details-note dog-refs-notice" role="status">
              {refs.notice}
              <button type="button" className="dog-refs-dismiss" onClick={refs.clearNotice}>Dismiss</button>
            </p>
          )}
          {/* Design review round 1, finding 3: the sentence names everything
              that goes, so it is true; the meter beside it counts the same. */}
          <p className="ui-field-hint dog-refs-contract">
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
                    const warn = s.dogType === 'pdf' ? pdfWarning(refs.pdfPages?.get(s.id)) : null;
                    return (
                      <li key={s.key} className="dog-refs-row" data-unavailable={gone || undefined}>
                        <Glyph className="dog-file-icon" aria-hidden="true" />
                        <span className="dog-refs-name" title={label}>{label}</span>
                        {s.isCore && <Badge className="dog-refs-core">Core</Badge>}
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

          <ReferencesMeter tokens={refs.chosenTokens + extraTokens} uncounted={refs.chosenUncounted + extraUncounted} />

          <div>
            <Button variant="secondary" onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add references
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
