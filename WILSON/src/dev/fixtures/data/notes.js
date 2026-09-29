// =============================================================================
// notes.js — the Dashboard's notes, with real bodies.
//
// A note's body is a Yjs document (NotesView mounts Tiptap's Collaboration
// extension on `ydoc.getXmlFragment('default')`), stored as a base64 update
// in `ydoc_state`. A row with `ydoc_state: null` opens as an empty editor
// whatever its preview says, so the fixtures build a real update per note:
// one XmlElement('paragraph') per line, encoded the way noteSync.js encodes a
// save. yjs is already a dependency (the editor's), and this module is only
// ever loaded through the dev-only dynamic import.
// =============================================================================

import * as Y from 'yjs'
import { fid, day, stamp } from '../ids'
import { u8ToB64, toPreview } from '../../../components/Dashboard/noteSync'
import { WORKSPACE_ID, MEMBER_ID } from './workspace'

function ydocState(paragraphs) {
  const doc = new Y.Doc()
  const frag = doc.getXmlFragment('default')
  doc.transact(() => {
    for (const text of paragraphs) {
      const p = new Y.XmlElement('paragraph')
      const t = new Y.XmlText()
      frag.push([p])
      p.push([t])
      t.insert(0, text)
    }
  })
  const state = u8ToB64(Y.encodeStateAsUpdate(doc))
  doc.destroy()
  return state
}

export const NOTE_SUBJECTS = [
  { id: fid('noteSubject', 1), workspace_id: WORKSPACE_ID, owner_id: MEMBER_ID.mara, label: 'Production', position: 0, created_at: stamp(-20, 9), created_by: MEMBER_ID.mara, updated_at: stamp(-20, 9), updated_by: MEMBER_ID.mara },
  { id: fid('noteSubject', 2), workspace_id: WORKSPACE_ID, owner_id: MEMBER_ID.mara, label: 'Post',       position: 1, created_at: stamp(-20, 9, 1), created_by: MEMBER_ID.mara, updated_at: stamp(-20, 9, 1), updated_by: MEMBER_ID.mara },
  { id: fid('noteSubject', 3), workspace_id: WORKSPACE_ID, owner_id: MEMBER_ID.mara, label: 'Festivals',  position: 2, created_at: stamp(-20, 9, 2), created_by: MEMBER_ID.mara, updated_at: stamp(-20, 9, 2), updated_by: MEMBER_ID.mara },
]

const NOTE_ROWS = [
  // [n, title, subject, dayOffset, paragraphs]
  [1, 'Shoot week one — open questions', 'Production', 38, [
    'Cliff path permit: council needs two weeks. Sc 02 and sc 06 move to days 8–9; the storm scenes come forward.',
    'Weather cover: if day 8 is out, the café has agreed to a second afternoon. Dev has the owner\'s number.',
    'Lantern dimmer still buzzes below 30%. Jonah is trying a DC driver; decision by Monday.',
    'Priya wants to lose the stair handrail on the camera side for sh 040 — Jonah says yes if we add a temporary rail for the crew between takes.',
  ]],
  [2, 'Post schedule (draft)', 'Post', 33, [
    'Assembly by 12 Oct, then two weeks of cutting before Theo\'s notes. Picture lock 6 Nov.',
    'Kenji wants the spray element shoot in the first week of post, while the lamp room is still standing.',
    'Lena needs the locked cut ten working days before the mix. Temp score for the assembly only.',
  ]],
  [3, 'Festival list', 'Festivals', 25, [
    'First tier: Clermont-Ferrand (deadline late Oct), Sundance shorts (Sept — missed, next year), SXSW (Oct).',
    'Second tier: Encounters, London Short Film Festival, Aesthetica.',
    'The fund wants a festival plan with the delivery report. Two pages, no more.',
  ]],
  [4, 'Notes from the animatic review', 'Production', 39, [
    'Opening works better with the door shot first, the lamp insert second. Sofia to re-time.',
    'The café scene runs long in the animatic but it is scratch VO; hold judgement until the read-through.',
    'Theo: "the last shot should be the longest in the film." Sixteen seconds in the boards.',
  ]],
]

export const NOTES = NOTE_ROWS.map(([n, title, subject, d, paragraphs], i) => ({
  id: fid('note', n),
  workspace_id: WORKSPACE_ID,
  owner_id: MEMBER_ID.mara,
  title,
  subject,
  note_date: day(d),
  ydoc_state: ydocState(paragraphs),
  body_preview: toPreview(paragraphs.join('\n')),
  version: 3 + i,
  created_at: stamp(d, 9, i),
  created_by: MEMBER_ID.mara,
  updated_at: stamp(d, 17, i),
  updated_by: MEMBER_ID.mara,
}))
