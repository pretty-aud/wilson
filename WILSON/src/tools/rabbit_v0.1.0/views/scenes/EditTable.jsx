// ============================================================
// RABBIT — an edit's cut, in the shots-by-scene table's form
// (post-overhaul S3c, steps 3, 4 and 6)
// ============================================================
//
// What an EDIT is on screen (D6): its items in cut order. A repeated shot is
// two rows; a shot deleted from the project is "Missing shot: <name>" (D17);
// the scene bands follow the cut — a scene that comes back later in the cut
// is a second band. The kit Table and the shot table's band row, so a cut
// reads as the list's own table does (Similarity); its first figure is the
// CUT position — 1, 2, 3, as an editor's event list numbers its events
// (Jakob) — which is what tells an edit from a list at a glance.
//
// The shot's own fields stay the shot's: its status and frame count are
// live, as everywhere (D3: one row, every list); its NAME is not edited here
// (Audrey: "the name of the shot/scene will not change in an edit"). Only
// the ORDER is the edit's, and that is a draft until Save edit (steps 4, 5).
//
// Row and band verbs come in as menus (`menuFor`, `bandMenuFor`) from the
// edit session (useEditSession), which decides what each does: on a saved
// edit the first change asks (D13), on a draft it changes the draft.
//
// Step 6 (D16): a row is dragged by its CUT cell — the grip at the cell's
// left, the position at its right — and a scene block by the grip before
// its name; only the grips are draggable, so the inline editors stay
// clickable. The list tables take a row by its number cell the same way
// (useCutDrag says what may land where). A row's `data-drop` draws the line.
// ============================================================

import { Fragment, useMemo } from 'react'
import { Film, Eye, Clapperboard, GripVertical } from 'lucide-react'
import { Table, Th, Td, Row, IconButton, CellSelect, StatusDot, EmptyState } from '../../../../ui'
import MenuButton from './MenuButton'
import { framesToTimecode } from './timecode'
import { blockLine } from './useCutDrag'
import '../rabbitScenes.css'

/** Every column: what a band row spans. */
const SPAN = 8

/** The grip a row or a block is dragged by (decorative to a screen reader: Move up / Move down are the keyboard's way, D16). */
export function Grip({ drag, kind, id, name }) {
  return (
    <span
      className="rb-scene-grip"
      draggable="true"
      aria-hidden="true"
      title={`Drag ${name} to move it`}
      onDragStart={drag.start(kind, id)}
      onDragEnd={drag.end}
    >
      <GripVertical />
    </span>
  )
}

/**
 * rows / bands   editModel.cutRows / cutBands
 * fps            the project's
 * ctx            useRabbit() — the shot's live writes, the thumbnail route
 * canWrite       whether this seat writes scenes and shots (status, frames)
 * statusOptions  the status words, in ScenesView's order
 * search         the toolbar's search: rows whose name matches; a band with none is left out
 * menuFor(row)   the row's ⋯ items (none: no ⋯)
 * bandMenuFor(band)   the band's ⋯ items
 * onOpenShot(id) View details
 * drag           step 6: useCutDrag's handlers, or null (nothing can be dragged here)
 * empty          what an empty cut says, and offers ({ body, action })
 */
export default function EditTable({ rows, bands, fps, ctx, canWrite = false, statusOptions = [], search = '', menuFor, bandMenuFor, onOpenShot, drag = null, empty = null }) {
  const needle = String(search || '').trim().toLowerCase()
  const shown = useMemo(() => {
    if (!needle) return bands
    return bands
      .map(b => ({ ...b, rows: b.rows.filter(r => r.name.toLowerCase().includes(needle)) }))
      .filter(b => b.rows.length || b.label.toLowerCase().includes(needle))
  }, [bands, needle])

  if (!rows.length) {
    return (
      <EmptyState Icon={Clapperboard} title="No shots in this edit" body={empty?.body}>
        {empty?.action || null}
      </EmptyState>
    )
  }

  return (
    <div className="rb-scene-table-wrap rb-scene-cut">
      <Table
        className="rb-scene-table rb-scene-table-cut"
        head={(
          <Row>
            <Th width="var(--rb-scene-col-cut)" numeric title="The shot's place in the cut">Cut</Th>
            <Th width="var(--rb-scene-col-thumb)" className="rb-scene-thumb-cell"><span className="sr-only">Thumbnail</span></Th>
            <Th width="var(--rb-scene-col-num)" numeric>#</Th>
            <Th>Shot</Th>
            <Th width="var(--rb-scene-col-status)">Status</Th>
            <Th width="var(--rb-scene-col-runtime)" numeric>Duration</Th>
            <Th width="var(--rb-scene-col-frames)" numeric>Frames</Th>
            <Th width="var(--rb-scene-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
          </Row>
        )}
      >
        {shown.map(band => {
          const bandFrames = band.rows.reduce((n, r) => n + r.frames, 0)
          const bandItems = bandMenuFor?.(band) || []
          // A block is named by its first item (stable while the block is).
          const bandId = rows[band.start]?.item.id
          // A block dropped after this one lands after its last row: the line
          // is that row's (review round 1, R1-07).
          const { head: bandAt, lastRow: afterLast } = blockLine(drag?.lineOf?.('band', bandId), 'band', band.rows.length > 0)
          const lastRowId = band.rows[band.rows.length - 1]?.item.id
          // Its rows take a block dropped on them as after it: the line
          // above is where it lands (review round 2, R2-06); the heading and
          // its rows carry the block's mark (`blockRow`), so that line holds while the
          // pointer moves among them.
          const inBand = { block: { kind: 'band', id: bandId } }
          const blockRef = drag?.blockRow?.(inBand.block)
          return (
            <Fragment key={band.key}>
              <Row
                className="rb-scene-group-row"
                data-drop={bandAt === 'before' ? 'before' : bandAt === 'after' ? 'after' : undefined}
                ref={blockRef}
                onDragOver={drag ? drag.over('band', bandId) : undefined}
                onDragLeave={drag ? drag.leave('band', bandId, inBand) : undefined}
                onDrop={drag ? drag.drop('band', bandId) : undefined}
              >
                <Td colSpan={SPAN - 1} className="rb-scene-group-cell">
                  <span className="rb-scene-group-head">
                    {drag && <Grip drag={drag} kind="band" id={bandId} name={`the ${band.label} block`} />}
                    <span className="rb-scene-cut-band-name">
                      {band.scene && <StatusDot status={band.scene.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />}
                      <Film className="rb-scene-group-icon" aria-hidden="true" />
                      <span className="rb-scene-group-label">{band.label}</span>
                      <span className="rb-scene-group-count">({band.rows.length} shot{band.rows.length !== 1 ? 's' : ''})</span>
                      {bandFrames > 0 && (
                        <span className="rb-scene-group-frames">{framesToTimecode(bandFrames, fps)} · {bandFrames.toLocaleString()} frames</span>
                      )}
                    </span>
                  </span>
                </Td>
                <Td align="right" className="rb-scene-acts-cell">
                  {bandItems.length > 0 && <MenuButton title={`Edit actions for the ${band.label} block`} items={bandItems} minWidth={220} />}
                </Td>
              </Row>
              {band.rows.map(r => {
                const shot = r.shot
                const items = menuFor?.(r) || []
                const at = drag?.at('item', r.item.id) || (r.item.id === lastRowId ? afterLast : undefined)
                return (
                  <Row
                    key={r.item.id}
                    className="rb-scene-row rb-scene-cut-row"
                    data-missing={r.missing ? 'true' : undefined}
                    data-drop={at === 'before' ? 'before' : at === 'after' ? 'after' : undefined}
                    ref={blockRef}
                    onDragOver={drag ? drag.over('item', r.item.id, inBand) : undefined}
                    onDragLeave={drag ? drag.leave('item', r.item.id, inBand) : undefined}
                    onDrop={drag ? drag.drop('item', r.item.id, inBand) : undefined}
                  >
                    <Td numeric className="rb-scene-cut-pos" data-grip={drag ? 'true' : undefined}>
                      {drag && <Grip drag={drag} kind="item" id={r.item.id} name={`${r.name} (cut ${r.index + 1})`} />}
                      {r.index + 1}
                    </Td>
                    <Td className="rb-scene-thumb-cell">
                      <div className="rb-scene-thumb" data-static="true">
                        {shot?.thumbnail_image
                          ? <img className="rb-scene-thumb-img" src={`/api/rabbit/projects/${ctx?.project?.id}/shots/${shot.id}/thumbnail`} alt="" />
                          : <Clapperboard className="rb-scene-thumb-mark" aria-hidden="true" />}
                      </div>
                    </Td>
                    <Td numeric className="rb-scene-num-cell" data-empty={shot?.shot_number == null ? 'true' : undefined}>
                      {shot?.shot_number ?? '—'}
                    </Td>
                    <Td>
                      <span className="rb-scene-cut-name" title={r.name}>{r.name}</span>
                    </Td>
                    <Td className="rb-scene-status-cell">
                      {shot ? (
                        <span className="rb-scene-status">
                          <StatusDot status={shot.status || 'not_started'} aria-hidden="true" role={undefined} aria-label={undefined} title="" />
                          <CellSelect
                            className="rb-scene-status-select"
                            value={shot.status || 'not_started'}
                            onChange={v => { if (canWrite) ctx?.updateShot?.(shot.id, { status: v }) }}
                            options={statusOptions}
                            disabled={!canWrite}
                            aria-label={`Status for ${r.name} (cut ${r.index + 1})`}
                          />
                        </span>
                      ) : <span className="rb-scene-cut-none">—</span>}
                    </Td>
                    <Td numeric className="rb-scene-dur-cell" data-empty={r.frames > 0 ? undefined : 'true'}>
                      {shot ? framesToTimecode(r.frames, fps) : '—'}
                    </Td>
                    <Td numeric className="rb-scene-frames-cell">
                      {shot ? (
                        <input
                          type="number"
                          min={0}
                          value={shot.frame_count ?? ''}
                          onChange={e => {
                            if (!canWrite) return
                            const n = parseInt(e.target.value, 10)
                            ctx?.updateShot?.(shot.id, { frame_count: Number.isFinite(n) && n >= 0 ? n : 0 })
                          }}
                          disabled={!canWrite}
                          aria-label={`Frames for ${r.name} (cut ${r.index + 1})`}
                          className="ui-input rb-scene-frames"
                          data-size="sm"
                          placeholder="0"
                        />
                      ) : <span className="rb-scene-cut-none">—</span>}
                    </Td>
                    <Td align="right" className="rb-scene-acts-cell">
                      <span className="rb-scene-cut-acts">
                        {shot && <IconButton size="sm" Icon={Eye} title={`View details of ${r.name}`} onClick={() => onOpenShot?.(shot.id)} />}
                        {items.length > 0 && <MenuButton title={`Edit actions for ${r.name} (cut ${r.index + 1})`} items={items} minWidth={220} />}
                      </span>
                    </Td>
                  </Row>
                )
              })}
            </Fragment>
          )
        })}
      </Table>
    </div>
  )
}
