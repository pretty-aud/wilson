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
// edit the first change asks (D13), on a draft it changes the draft. The
// drag handle (step 6) is the first cell, on its own, so the row's inline
// editors stay clickable.
// ============================================================

import { Fragment, useMemo } from 'react'
import { Film, Eye, Clapperboard } from 'lucide-react'
import { Table, Th, Td, Row, IconButton, CellSelect, StatusDot, EmptyState } from '../../../../ui'
import MenuButton from './MenuButton'
import { framesToTimecode } from './timecode'
import '../rabbitScenes.css'

/** Every column: what a band row and an empty cut span. */
const SPAN = 9

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
 * grip(kind, target)  step 6: the drag handle for a row or a band, or null
 * dropAt(kind, target)  step 6: 'before' | 'after' | undefined — where a drop would land
 * drop           step 6: { over(kind, target), leave(kind, target), drop(kind, target) }, or null
 * empty          what an empty cut says, and offers ({ body, action })
 */
export default function EditTable({ rows, bands, fps, ctx, canWrite = false, statusOptions = [], search = '', menuFor, bandMenuFor, onOpenShot, grip = null, dropAt = null, drop = null, empty = null }) {
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
            <Th width="var(--rb-scene-col-grip)"><span className="sr-only">Move</span></Th>
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
          return (
            <Fragment key={band.key}>
              <Row
                className="rb-scene-group-row"
                onDragOver={drop ? drop.over('band', band) : undefined}
                onDragLeave={drop ? drop.leave('band', band) : undefined}
                onDrop={drop ? drop.drop('band', band) : undefined}
              >
                <Td className="rb-scene-cut-grip-cell">{grip?.('band', band) || null}</Td>
                <Td colSpan={SPAN - 2} className="rb-scene-group-cell">
                  <span className="rb-scene-group-head">
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
                return (
                  <Row
                    key={r.item.id}
                    className="rb-scene-row rb-scene-cut-row"
                    data-missing={r.missing ? 'true' : undefined}
                    onDragOver={drop ? drop.over('item', r) : undefined}
                    onDragLeave={drop ? drop.leave('item', r) : undefined}
                    onDrop={drop ? drop.drop('item', r) : undefined}
                  >
                    <Td className="rb-scene-cut-grip-cell">{grip?.('item', r) || null}</Td>
                    <Td numeric className="rb-scene-cut-pos">{r.index + 1}</Td>
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
