// =============================================================================
// runAttachmentMigration — move a project's LEGACY attachment arrays into the
// project's file store (Track C, bundle C3; MASTER_PLAN §6 #31).
//
// WHAT IT MOVES. Before C3, D.O.G. attachments were base64 data URLs inside
// `project.documents[]` and `project.visualAssets[]` on the project row —
// written only on Local Server, because the cloud `projects` table has no such
// columns and the adapter refuses a patch carrying them (ATTACHMENTS_MSG).
// After C3 every new attachment is an ordinary file: a row in `public.files` /
// `bundle.files` and a body in rabbit-files / the project's files directory.
// This runner moves the old ones across, once, on Audrey's command.
//
// 🚨 §6 #31 TRAP (b), THE POLARITY, AND THIS IS WHERE IT WOULD ACTUALLY BITE.
// D.O.G. reads a legacy entry's flag as `isCore !== false` — DEFAULT TRUE — and
// `files.is_core_definer` is NOT NULL DEFAULT false. Letting the column take
// its default here would demote every attachment nobody had explicitly marked
// from CORE to REF, and CORE/REF is injected into the prompt as "primary
// sources of truth" versus "supporting reference material only". The outline
// would change, quietly, for every project that had ever been migrated. So the
// flag is carried EXPLICITLY, with the legacy default applied at the moment of
// the move:
//
//     isCoreDefiner: entry.isCore !== false
//
// The commit for this bundle records the measured diff: a deck generated from
// a legacy-array project before the move, and the same inputs after, produce
// the same outline. That is the trap made measurable rather than argued about.
//
// 🚨 STREAMING, NOT BATCHING (the brief's own trap). `project.documents` is
// base64 — a 6 MB PDF is an 8 MB string on the project row. Loading every
// project's bundle and holding every blob would be the same defect the row's
// 8-MB-class JSON already is. So: ONE project's bundle at a time, ONE
// attachment converted to a Blob at a time, and no reference kept to either
// after it has been uploaded. The dry run does not decode anything at all —
// it measures the base64 length, which is what makes it cheap enough to run on
// a whole install.
//
// PER-FILE CEILING. An attachment larger than MAX_ATTACHMENT_BYTES is REPORTED
// AND LEFT WHERE IT IS, never moved and never truncated: a half-moved document
// is worse than an unmoved one, because the row would then say the file is in
// the store. The dry run names each one so nothing is a surprise at the real
// run. (The 50 GiB bucket cap is not the concern here, as §6 #31 says — the
// concern is the JSON row that has to be read to reach the bytes.)
//
// IDEMPOTENT AND RESUMABLE. Each attachment is cleared from the array only
// after its upload has returned, and the arrays are written back per project.
// A crash mid-project leaves the uploaded ones out of the array and the rest
// in it, so a re-run moves exactly what is left. A re-run after a clean run
// finds nothing and reports zero.
// =============================================================================

import { documentKindFor } from '../../tools/rabbit_v0.1.0/deckAttachments';

/**
 * Per-file ceiling. Stated in the panel and in the report.
 *
 * 🚨 32 MiB, NOT 64 — review round 1. THE BACKEND THAT WILL ACTUALLY RUN THIS
 * IS LOCAL SERVER, because it is the only one whose projects can hold legacy
 * arrays at all, and `localServerAdapter.uploadFile` base64-encodes the body
 * into a JSON request that `express.json({ limit: '50mb' })` caps. base64
 * inflates by 4/3, so the real refusal is at roughly 36 MiB decoded — and a
 * 64 MiB ceiling meant every file between 36 and 64 MiB failed with a raw
 * `[localServer] HTTP 413`, counted under `failed` rather than under
 * `oversize` where the panel explains it. A ceiling that never binds on the
 * one backend that runs the tool is worse than no ceiling: it makes the panel
 * promise something it cannot do.
 *
 * 32 MiB encodes to about 42.7 MB, comfortably inside the 50 MB body limit
 * with room for the JSON envelope, and it is the same number D.O.G. spends on
 * a whole project — so nothing this tool moves can be a file D.O.G. could
 * never read back anyway.
 */
export const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;

/**
 * Decode ONE `data:<mime>;base64,<payload>` string into a File.
 *
 * atob + a byte loop rather than `fetch(dataUrl)`: fetch on a data URL is
 * asynchronous, allocates a second copy, and — on the desktop, where the
 * renderer is served from 127.0.0.1 — is one more thing that can be refused by
 * a policy for no useful reason. The name and type come from the entry, so the
 * storage path and mime_type match what the person originally uploaded.
 */
function entryToFile(entry) {
  const raw = String(entry.content || '');
  const comma = raw.indexOf(',');
  const payload = comma >= 0 ? raw.slice(comma + 1) : raw;
  const declared = comma >= 0 ? /data:([^;,]+)/.exec(raw.slice(0, comma)) : null;
  const type = entry.type || (declared && declared[1]) || 'application/octet-stream';
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], entry.name || 'attachment', { type });
}

/**
 * Approximate decoded size from the base64 length, WITHOUT decoding.
 *
 * base64 is 4 characters per 3 bytes; the padding is at most 2. Used by the
 * dry run and by the ceiling check, so neither has to allocate the blob to
 * find out it is too big — which is the whole point of the ceiling.
 */
export function approxBytes(entry) {
  if (typeof entry.size === 'number' && entry.size > 0) return entry.size;
  const raw = String(entry.content || '');
  const comma = raw.indexOf(',');
  const payload = comma >= 0 ? raw.length - comma - 1 : raw.length;
  return Math.max(0, Math.floor(payload * 3 / 4));
}

function makeReport() {
  return {
    dryRun: false,
    projects:    { total: 0, withAttachments: 0, failed: 0 },
    attachments: { found: 0, moved: 0, tooBig: 0, empty: 0, failed: 0, bytes: 0 },
    oversize: [],   // [{ projectTitle, name, bytes }]
    errors: [],     // [{ projectId, name, message }]
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

/**
 * Move every project's legacy attachment arrays into the file store.
 *
 * @param {object}   opts
 * @param {object}   opts.adapter      the ACTIVE adapter (ctx.getAdapter()).
 * @param {boolean} [opts.dryRun]      enumerate and measure only; no writes.
 * @param {(m: string) => void} [opts.onProgress]
 * @param {(kind: string) => string|null} [opts.detectKind] name -> document_kind.
 * @returns {Promise<object>} the report.
 */
export async function runAttachmentMigration({
  adapter, dryRun = false, onProgress, detectKind,
} = {}) {
  const report = makeReport();
  report.dryRun = dryRun;
  const note = (m) => { try { onProgress?.(m) } catch { /* swallow */ } };

  // 🚨 §6 #31 trap (f) applies here too: a backend without a file store must
  // refuse LOUDLY rather than run and move nothing. Drive's uploadFile is a
  // function that throws, so `typeof` would say yes.
  if (!adapter?.listProjects || !adapter?.loadProject
      || !adapter?.uploadFile  || !adapter?.updateProject) {
    throw new Error('this backend cannot store files — switch to Supabase or '
      + 'Local Server before migrating attachments');
  }

  let list;
  try {
    list = await adapter.listProjects();
  } catch (err) {
    report.errors.push({ projectId: null, name: null, message: err.message || String(err) });
    report.finishedAt = new Date().toISOString();
    return report;
  }
  const projects = Array.isArray(list) ? list : [];
  report.projects.total = projects.length;
  note(`${projects.length} project${projects.length === 1 ? '' : 's'} to check.`);

  for (const p of projects) {
    const projectId = p?.id;
    if (!projectId) continue;

    // ONE bundle in memory at a time — see the header. `bundle` goes out of
    // scope at the end of this iteration and nothing outside it holds a
    // reference to the arrays.
    let bundle;
    try {
      bundle = await adapter.loadProject(projectId);
    } catch (err) {
      report.projects.failed++;
      report.errors.push({ projectId, name: null, message: err.message || String(err) });
      continue;
    }
    const project = bundle?.project || {};
    const title = project.title || p.title || projectId;

    const docs   = Array.isArray(project.documents)    ? [...project.documents]    : [];
    const assets = Array.isArray(project.visualAssets) ? [...project.visualAssets] : [];
    if (docs.length === 0 && assets.length === 0) continue;
    report.projects.withAttachments++;
    note(`• ${title} — ${docs.length + assets.length} attachment${docs.length + assets.length === 1 ? '' : 's'}`);

    // [array, the key it is written back under, whether it is media]
    const groups = [[docs, 'documents'], [assets, 'visualAssets']];
    let changed = false;

    for (const [list_, key] of groups) {
      // Backwards, so a splice cannot skip the next entry — and so a crash
      // leaves the UNMOVED ones contiguous at the front of the array.
      for (let i = list_.length - 1; i >= 0; i--) {
        const entry = list_[i];
        report.attachments.found++;

        if (!entry?.content) {
          // A row with no body has nothing to move. Left alone rather than
          // deleted: it may be a record someone still wants to see, and this
          // runner's job is to MOVE files, not to tidy the array.
          report.attachments.empty++;
          continue;
        }

        const bytes = approxBytes(entry);
        if (bytes > MAX_ATTACHMENT_BYTES) {
          report.attachments.tooBig++;
          report.oversize.push({ projectTitle: title, name: entry.name || '(unnamed)', bytes });
          continue;
        }

        if (dryRun) {
          report.attachments.moved++;      // "would move"
          report.attachments.bytes += bytes;
          continue;
        }

        try {
          const file = entryToFile(entry);
          await adapter.uploadFile(projectId, {
            // 🚨 EVERY MIGRATED ENTRY MUST STILL BE A DECK ATTACHMENT
            // AFTERWARDS, and that is what documentKindFor guarantees. D.O.G.
            // recognises a stored row by `document_kind`, or as media filed at
            // project level (deckAttachments.isDeckAttachmentRow — this runner
            // stamps no entity, so migrated media qualifies); a PDF whose name
            // matches none of
            // detectDocumentKind's heuristics ("legacy.pdf", "Nightjar_v3.pdf")
            // gets NULL from it, has a non-media mime type, and would vanish
            // from generation the moment it was migrated — uploaded
            // successfully, contributing nothing, which is §6 #31 trap (c)
            // exactly. MEASURED, not reasoned about: the round-trip diff in
            // this bundle's commit message caught it on `legacy.pdf`.
            documentKind: documentKindFor(file.type, entry.name, detectKind),
            // 🚨 THE POLARITY, carried across explicitly. See the header.
            isCoreDefiner: entry.isCore !== false,
            description: entry.description || null,
          }, file);
          // Cleared only AFTER the upload returned, so a failure leaves the
          // entry in place and a re-run moves it.
          list_.splice(i, 1);
          changed = true;
          report.attachments.moved++;
          report.attachments.bytes += bytes;
        } catch (err) {
          report.attachments.failed++;
          report.errors.push({
            projectId, name: entry.name || '(unnamed)',
            message: err.message || String(err),
          });
        }
      }
    }

    if (!dryRun && changed) {
      try {
        await adapter.updateProject(projectId, { documents: docs, visualAssets: assets });
      } catch (err) {
        // The files ARE in the store; only the array did not shrink. Reported
        // rather than swallowed, because the next run would move them again
        // and produce duplicates — which is exactly what the person needs to
        // know before they run it twice.
        //
        // 🚨 R1: supabaseAdapter.updateProject REFUSES this patch whenever
        // anything is left behind. mapDogProjectFields sets droppedAttachments,
        // hasRealAttachments sees the remaining entry, and it throws
        // ATTACHMENTS_MSG — whose text is advice about where to upload files,
        // which is nonsense as an explanation of a migration writeback. That
        // refusal is CORRECT (nothing should be writing those arrays to the
        // cloud) and unreachable today, because a cloud project cannot hold
        // legacy arrays in the first place; it is reported in words that
        // describe what actually happened rather than passed through.
        const raw = err?.message || String(err);
        const refused = /not saved|file records/i.test(raw);
        report.errors.push({
          projectId, name: null,
          message: refused
            ? 'the files were uploaded, but this backend does not store the old '
              + 'attachment arrays, so the project record could not be cleared — '
              + 're-running would upload them a second time'
            : `files were uploaded but the project row was not cleared — `
              + `re-running would duplicate them: ${raw}`,
        });
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}
