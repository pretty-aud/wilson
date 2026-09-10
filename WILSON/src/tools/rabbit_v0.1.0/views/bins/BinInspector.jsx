// ============================================================
// RABBIT — Bins: the inspector (preview + logging fields)
// ============================================================
//
// The right rail. One row selected: its preview (a <video> through the stream
// route for what Chromium plays, an <img> for stills, an <audio> for sound,
// the poster and an honest sentence for everything else) and every field.
// Several rows: bulk editing — a field that differs across the selection
// says "mixed" and typing sets it on all of them.
//
// 🚨 Never a spinner that never ends: every preview kind is decided from the
// row's extension before anything is fetched (previewKindFor), and the
// element's own onError names the failure.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, RefreshCw, Check, Ban, Circle, Trash2, Unplug, ChevronDown, ChevronRight, Clapperboard, Plus, X, Star } from 'lucide-react'
import { C, Btn, IconBtn, Field, TextInput, TextArea, Select, ColorPicker, MediaTag } from './binUi'
import BinPoster from './BinPoster'
import { MEDIA_TYPES, MEDIA_TYPE_META, TAKE_MODIFIERS, previewKindFor, formatDuration, formatBytes, secondsToTimecode } from '../../bins/binMedia'
import { mixedValue } from '../../bins/binSelectors'
import { TAKE_ROLE_META } from '../../bins/shotTakeSelectors'
import { navigateTo } from '../../state/rabbitNavigate'

function useDraft(value, key) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value, key])
  return [draft, setDraft]
}

function Section({ title, children, open = true, onToggle, right = null }) {
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-1.5 px-3 py-2 text-left">
        {onToggle ? (open ? <ChevronDown className="w-3 h-3" style={{ color: C.dim }} /> : <ChevronRight className="w-3 h-3" style={{ color: C.dim }} />) : null}
        <span className="text-[9.5px] font-mono uppercase tracking-wider flex-1" style={{ color: C.dim }}>{title}</span>
        {right}
      </button>
      {open && <div className="px-3 pb-3 flex flex-col gap-2">{children}</div>}
    </div>
  )
}

export default function BinInspector({
  rows, scenes, shots, fps, canWrite, ffmpeg, thumbUrlFor, streamUrlFor,
  onPatch, onOpen, onProbe, onRemove, binPathFor, width = 320,
  // Shot takes (milestone 2): usage is Map fileId → [{ take, shot, scene }].
  usage = null, onAssign = null, onUnassign = null,
}) {
  const single = rows.length === 1 ? rows[0] : null
  const key = rows.map(r => r.id).join(',')
  const [previewOpen, setPreviewOpen] = useState(true)
  const [techOpen, setTechOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)
  const [usedOpen, setUsedOpen] = useState(true)
  const uses = single ? (usage?.get(single.id) || []) : []
  const usedRows = usage ? rows.filter(r => (usage.get(r.id) || []).length > 0).length : 0

  const mv = (k) => mixedValue(rows, k)
  const [name, setName] = useDraft(single?.display_name, key)
  const [slate, setSlate] = useDraft(mv('slate').value, key)
  const [take, setTake] = useDraft(mv('take_number').value, key)
  const [camera, setCamera] = useDraft(mv('camera').value, key)
  const [roll, setRoll] = useDraft(mv('roll').value, key)
  const [day, setDay] = useDraft(mv('shoot_day').value, key)
  const [tags, setTags] = useDraft((mv('tags').value || []).join(', '), key)
  const [description, setDescription] = useDraft(mv('description').value, key)
  const [notes, setNotes] = useDraft(mv('notes').value, key)

  const sceneOptions = useMemo(() => (scenes || []).slice().sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled scene' })), [scenes])
  const sceneVal = mv('scene_id')
  const shotOptions = useMemo(() => (shots || []).filter(s => !sceneVal.value || s.scene_id === sceneVal.value).sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled shot' })), [shots, sceneVal.value])

  const commit = (k, draft, current) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    const cur = current ?? ''
    if ((v || '') === (cur || '')) return
    onPatch({ [k]: v === '' ? null : v })
  }
  const commitTake = () => {
    const n = String(take).trim() === '' ? null : Number(take)
    const cur = mv('take_number').value ?? null
    if (n === cur) return
    if (n != null && !(Number.isFinite(n) && n > 0)) { setTake(cur ?? ''); return }
    onPatch({ take_number: n })
  }
  const commitTags = () => {
    const list = String(tags).split(',').map(t => t.trim()).filter(Boolean)
    const cur = mv('tags').value || []
    if (JSON.stringify(list) === JSON.stringify(cur)) return
    onPatch({ tags: list })
  }

  if (!rows.length) {
    return (
      <div className="flex-shrink-0 h-full flex flex-col" style={{ width, borderLeft: `1px solid ${C.line}`, backgroundColor: C.bg }}>
        <div className="px-3 py-2 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim, borderBottom: `1px solid ${C.line}` }}>Inspector</div>
        <div className="flex-1 flex items-center justify-center px-6 text-center text-[10.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>
          Select a file to preview it and log it. Shift-click or drag to select several and edit them together.
        </div>
      </div>
    )
  }

  const flag = mv('review_flag')
  const circled = mv('circled')
  const color = mv('color')
  const mediaType = mv('media_type')

  return (
    <div className="flex-shrink-0 h-full flex flex-col overflow-hidden" style={{ width, borderLeft: `1px solid ${C.line}`, backgroundColor: C.bg }}>
      <div className="px-3 py-2 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="text-[9.5px] font-mono uppercase tracking-wider flex-1 truncate" style={{ color: C.dim }}>
          {single ? 'Inspector' : `${rows.length} files selected`}
        </span>
        {canWrite && <IconBtn Icon={Trash2} title={single ? 'Remove from bin (Delete)' : `Remove ${rows.length} from bin (Delete)`} onClick={() => onRemove?.(rows.map(r => r.id))} danger size={3} />}
      </div>
      <div className="flex-1 overflow-y-auto">
        {single && (
          <Section title="Preview" open={previewOpen} onToggle={() => setPreviewOpen(o => !o)}>
            <Preview row={single} thumbUrl={thumbUrlFor?.(single.id)} streamUrl={streamUrlFor?.(single.id)} ffmpeg={ffmpeg} onOpen={onOpen} />
          </Section>
        )}

        <Section title="Marks" >
          <div className="flex items-center gap-1.5 flex-wrap">
            <MarkBtn active={flag.value === 'select' && !flag.mixed} onClick={() => onPatch({ review_flag: flag.value === 'select' ? 'unflagged' : 'select' })} disabled={!canWrite} Icon={Check} color={C.green} label="Select" hint="S" />
            <MarkBtn active={flag.value === 'reject' && !flag.mixed} onClick={() => onPatch({ review_flag: flag.value === 'reject' ? 'unflagged' : 'reject' })} disabled={!canWrite} Icon={Ban} color={C.red} label="Reject" hint="R" />
            <MarkBtn active={!!circled.value && !circled.mixed} onClick={() => onPatch({ circled: !circled.value })} disabled={!canWrite} Icon={Circle} color={C.accentText} label="Circled" hint="C" />
            {(flag.mixed || circled.mixed) && <span className="text-[9.5px] font-mono" style={{ color: C.amber }}>mixed</span>}
          </div>
          <Field label="Colour" inline mixed={color.mixed}>
            <ColorPicker value={color.mixed ? null : color.value} onChange={c => canWrite && onPatch({ color: c })} />
          </Field>
        </Section>

        {usage && (
          <Section title={single ? `Used in shots (${uses.length})` : `Used in shots`} open={usedOpen} onToggle={() => setUsedOpen(o => !o)}
            right={canWrite && onAssign ? <IconBtn Icon={Plus} title="Assign to shot… (A)" size={3} onClick={e => { e.stopPropagation(); onAssign(rows.map(r => r.id)) }} /> : null}>
            {single ? (
              uses.length === 0
                ? <div className="text-[10.5px] font-mono" style={{ color: C.dimmer }}>Not assigned to any shot yet.</div>
                : uses.map(({ take, shot, scene }) => {
                  const meta = TAKE_ROLE_META[take.role] || TAKE_ROLE_META.alt
                  return (
                    <div key={take.id} className="flex items-center gap-1.5 text-[10.5px] font-mono min-w-0">
                      <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: C.dim }} />
                      <span className="truncate flex-1" style={{ color: C.text }} title={`${scene?.name ? scene.name + ' · ' : ''}#${shot.shot_number ?? '—'} ${shot.name || 'Untitled shot'}${take.notes ? ' — ' + take.notes : ''}`}>
                        {scene?.name ? <span style={{ color: C.dim }}>{scene.name} · </span> : null}#{shot.shot_number ?? '—'} {shot.name || 'Untitled shot'}
                      </span>
                      <span className="px-1 rounded-sm text-[8.5px] uppercase tracking-wider flex-shrink-0 inline-flex items-center gap-0.5" style={{ color: meta.color, border: `1px solid ${meta.color}55` }} title={meta.help}>
                        {take.role === 'primary' && <Star className="w-2 h-2" style={{ fill: meta.color }} />}{meta.label}
                      </span>
                      <IconBtn Icon={ExternalLink} title="Open the shot in Scenes" size={3} onClick={() => navigateTo({ view: 'scenes', shotId: shot.id })} />
                      {canWrite && onUnassign && <IconBtn Icon={X} title="Unassign from this shot" size={3} danger onClick={() => onUnassign([take.id])} />}
                    </div>
                  )
                })
            ) : (
              <div className="text-[10.5px] font-mono" style={{ color: C.muted }}>
                {usedRows === 0 ? 'None of these is assigned to a shot yet.' : `${usedRows} of ${rows.length} are assigned to shots. Select one file to see where.`}
              </div>
            )}
            {canWrite && onAssign && (
              <div><Btn small onClick={() => onAssign(rows.map(r => r.id))} title="Pick the shot (or shots) these takes are used in"><Clapperboard className="w-3 h-3" style={{ color: C.accentText }} /> Assign to shot…</Btn></div>
            )}
          </Section>
        )}

        <Section title="Logging" open={logOpen} onToggle={() => setLogOpen(o => !o)}>
          {single && (
            <Field label="Name">
              <TextInput value={name} onChange={setName} onCommit={() => commit('display_name', name || single.display_name, single.display_name)} disabled={!canWrite} placeholder={single.original_name} />
            </Field>
          )}
          <Field label="Type" mixed={mediaType.mixed}>
            <div className="flex items-center gap-2">
              <Select value={mediaType.mixed ? '' : mediaType.value} placeholder={mediaType.mixed ? 'mixed' : null} disabled={!canWrite}
                options={MEDIA_TYPES.map(t => ({ value: t, label: MEDIA_TYPE_META[t].label }))}
                onChange={v => v && onPatch({ media_type: v })} />
              {!mediaType.mixed && <MediaTag type={mediaType.value} small />}
            </div>
          </Field>
          <Field label="Tags" mixed={mv('tags').mixed} hint="comma separated">
            <TextInput value={tags} onChange={setTags} onCommit={commitTags} disabled={!canWrite} placeholder="hero, b-roll, interview" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Slate" mixed={mv('slate').mixed}>
              <TextInput value={slate} onChange={setSlate} onCommit={() => commit('slate', slate, mv('slate').value)} disabled={!canWrite} placeholder="24A" />
            </Field>
            <Field label="Take" mixed={mv('take_number').mixed}>
              <TextInput value={take} onChange={setTake} onCommit={commitTake} disabled={!canWrite} placeholder="3" type="number" min={1} />
            </Field>
            <Field label="Modifier" mixed={mv('take_modifier').mixed}>
              <Select value={mv('take_modifier').mixed ? '' : (mv('take_modifier').value || '')} placeholder={mv('take_modifier').mixed ? 'mixed' : '—'} disabled={!canWrite}
                options={TAKE_MODIFIERS.map(m => ({ value: m, label: m }))} onChange={v => onPatch({ take_modifier: v })} />
            </Field>
            <Field label="Camera" mixed={mv('camera').mixed}>
              <TextInput value={camera} onChange={v => setCamera(v.toUpperCase())} onCommit={() => commit('camera', camera, mv('camera').value)} disabled={!canWrite} placeholder="A" maxLength={4} />
            </Field>
            <Field label="Roll / card" mixed={mv('roll').mixed}>
              <TextInput value={roll} onChange={v => setRoll(v.toUpperCase())} onCommit={() => commit('roll', roll, mv('roll').value)} disabled={!canWrite} placeholder="A001" />
            </Field>
            <Field label="Shoot day" mixed={mv('shoot_day').mixed}>
              <TextInput value={day} onChange={setDay} onCommit={() => commit('shoot_day', day, mv('shoot_day').value)} disabled={!canWrite} type="date" />
            </Field>
          </div>
          <Field label="Scene" mixed={sceneVal.mixed}>
            <Select value={sceneVal.mixed ? '' : sceneVal.value} placeholder={sceneVal.mixed ? 'mixed' : '— none —'} disabled={!canWrite}
              options={sceneOptions} onChange={v => onPatch({ scene_id: v, ...(v !== sceneVal.value ? { shot_id: null } : {}) })} />
          </Field>
          <Field label="Shot (intended)" mixed={mv('shot_id').mixed} hint={sceneVal.value ? null : 'pick a scene to narrow the list'}>
            <Select value={mv('shot_id').mixed ? '' : mv('shot_id').value} placeholder={mv('shot_id').mixed ? 'mixed' : '— none —'} disabled={!canWrite}
              options={shotOptions} onChange={v => onPatch({ shot_id: v })} />
          </Field>
        </Section>

        <Section title="Notes" open={notesOpen} onToggle={() => setNotesOpen(o => !o)}>
          <Field label="Description" mixed={mv('description').mixed}>
            <TextInput value={description} onChange={setDescription} onCommit={() => commit('description', description, mv('description').value)} disabled={!canWrite} placeholder="What is in it" />
          </Field>
          <Field label="Notes" mixed={mv('notes').mixed}>
            <TextArea value={notes} onChange={setNotes} onCommit={() => commit('notes', notes, mv('notes').value)} disabled={!canWrite} placeholder="NG sound, false start, boom in shot…" rows={3} />
          </Field>
        </Section>

        {single && (
          <Section title="File" open={techOpen} onToggle={() => setTechOpen(o => !o)}
            right={single.online !== false && canWrite ? <IconBtn Icon={RefreshCw} title="Read the technical columns again" size={3} onClick={e => { e.stopPropagation(); onProbe?.(single.id) }} /> : null}>
            <TechRows row={single} fps={fps} binPath={binPathFor?.(single.bin_id)} ffmpeg={ffmpeg} />
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <Btn small onClick={() => onOpen?.(single.id, false)} disabled={single.online === false} title="Open with the default app"><ExternalLink className="w-3 h-3" /> Open</Btn>
              <Btn small onClick={() => onOpen?.(single.id, true)} disabled={single.online === false} title="Show the file in Explorer"><FolderOpen className="w-3 h-3" /> Reveal</Btn>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}

function MarkBtn({ active, onClick, disabled, Icon, color, label, hint }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={`${label} (${hint})`}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm transition-colors hover:bg-stone-700 disabled:opacity-40"
      style={{ color: active ? C.bright : C.muted, backgroundColor: active ? color : 'transparent', border: `1px solid ${active ? color : C.line}` }}>
      <Icon className="w-3 h-3" /> {label}
    </button>
  )
}

function TechRows({ row, fps, binPath, ffmpeg }) {
  const R = ({ k, v, title }) => v == null || v === '' ? null : (
    <div className="flex items-baseline gap-2 text-[10.5px] font-mono min-w-0">
      <span className="flex-shrink-0" style={{ color: C.dimmer, minWidth: 70 }}>{k}</span>
      <span className="truncate" style={{ color: C.text }} title={title || String(v)}>{v}</span>
    </div>
  )
  const probeNote = row.probe_status === 'pending' ? 'reading…'
    : row.probe_status === 'unavailable' ? (ffmpeg === false ? 'no decoder on this machine (ffmpeg missing)' : 'not readable without a decoder')
      : row.probe_status === 'failed' ? 'could not be read' : null
  return (
    <div className="flex flex-col gap-1">
      <R k="Bin" v={binPath} />
      <R k="File" v={row.original_name} />
      <R k="Path" v={row.source_path} />
      {row.online === false && <div className="flex items-center gap-1.5 text-[10.5px] font-mono" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> offline — the file is not at this path</div>}
      <R k="Size" v={formatBytes(row.size_bytes)} />
      {row.is_sequence && <R k="Frames" v={`${row.frame_count ?? '?'}${row.sequence_pattern ? ` · ${row.sequence_pattern}` : ''}`} />}
      <R k="Duration" v={row.duration_sec ? `${formatDuration(row.duration_sec)} · ${secondsToTimecode(row.duration_sec, row.fps || fps)}` : null} />
      <R k="Start TC" v={row.timecode_start} />
      <R k="Frame" v={row.width && row.height ? `${row.width} × ${row.height}` : null} />
      <R k="fps" v={row.fps} />
      <R k="Codec" v={row.codec ? String(row.codec).toUpperCase() : null} />
      <R k="Audio" v={row.sample_rate ? `${row.sample_rate} Hz${row.channels ? ` · ${row.channels}` : ''}` : null} />
      <R k="Added" v={row.added_at ? new Date(row.added_at).toLocaleString() : null} />
      {probeNote && <R k="Columns" v={probeNote} />}
    </div>
  )
}

function Preview({ row, thumbUrl, streamUrl, ffmpeg, onOpen }) {
  const kind = previewKindFor(row)
  const [failed, setFailed] = useState(null)
  const [playing, setPlaying] = useState(false)
  const mediaRef = useRef(null)
  useEffect(() => { setFailed(null); setPlaying(false) }, [row.id, streamUrl])

  // Space toggles play/pause when the preview is a video or audio.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const m = mediaRef.current
      if (!m) return
      e.preventDefault()
      if (m.paused) m.play().catch(() => {}); else m.pause()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (row.online === false) {
    return (
      <div className="rounded-sm flex flex-col items-center justify-center gap-1 py-6 text-center" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}` }}>
        <Unplug className="w-5 h-5" style={{ color: C.amber }} />
        <div className="text-[10.5px] font-mono" style={{ color: C.amber }}>Offline</div>
        <div className="text-[9.5px] font-mono px-4" style={{ color: C.dim }}>The file is not at its recorded path. Plug the drive in, or use Relink.</div>
      </div>
    )
  }
  const notice = (text) => (
    <div className="text-[9.5px] font-mono leading-relaxed px-1" style={{ color: C.dim }}>{text}</div>
  )
  if (kind === 'video' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <video ref={mediaRef} key={streamUrl} src={streamUrl} controls preload="metadata" playsInline
          poster={thumbUrl || undefined}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setFailed('Chromium could not decode this file. The poster frame stands in.')}
          className="w-full rounded-sm" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, maxHeight: 240 }} />
        {notice(playing ? 'Playing · Space pauses' : 'Space plays · hover a tile in the grid to scrub')}
      </div>
    )
  }
  if (kind === 'audio' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="rounded-sm flex items-center justify-center py-4" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}` }}>
          <BinPoster row={row} src={null} width={64} height={64} iconSize={28} style={{ border: 'none', backgroundColor: 'transparent' }} />
        </div>
        <audio ref={mediaRef} key={streamUrl} src={streamUrl} controls preload="metadata" className="w-full"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setFailed('Chromium could not decode this audio format.')} />
        {notice('Space plays and pauses')}
      </div>
    )
  }
  if (kind === 'image' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <img key={streamUrl} src={streamUrl} alt="" onError={() => setFailed('The image could not be decoded by the browser; the poster stands in.')}
          className="w-full rounded-sm object-contain" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, maxHeight: 240 }} />
      </div>
    )
  }
  // poster / frame / none, or a failed element above
  const posterNotice = kind === 'frame'
    ? `A frame sequence: ${row.frame_count ?? '?'} frames. The poster is the middle frame; open the folder to step through them.`
    : kind === 'poster'
      ? (failed || `Preview is not available for this format in the app${ffmpeg === false ? ' and there is no decoder to make a poster' : ''}. Open it in its default app.`)
      : kind === 'none'
        ? (failed || 'No preview for this type. Open it in its default app.')
        : failed
  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-sm flex items-center justify-center overflow-hidden" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, minHeight: 120 }}>
        <BinPoster row={row} src={thumbUrl} width="100%" height={180} radius={0} style={{ border: 'none' }} iconSize={40} />
      </div>
      {notice(posterNotice)}
      <div><Btn small onClick={() => onOpen?.(row.id, false)}><ExternalLink className="w-3 h-3" /> Open in default app</Btn></div>
    </div>
  )
}
