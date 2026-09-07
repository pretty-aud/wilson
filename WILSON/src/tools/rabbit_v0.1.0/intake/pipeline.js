// ============================================================
// RABBIT intake — chunked-analysis orchestrator
// ============================================================
//
// `runIngestion(opts)` runs the full pipeline:
//
//   1. For each `is_core_definer` file:
//      a. Detect document_kind (extension + first-page Haiku
//         classifier when ambiguous).
//      b. Extract raw text (.pdf via main-process route, .docx
//         via mammoth, .md/.txt direct read, .pptx best-effort).
//      c. Run the matching chunker → array of raw chunks.
//      d. Hand each chunk to the worker pool (concurrency 3).
//   2. Worker:
//      a. Build prompt = personas + chunk context + schema.
//      b. POST to Anthropic with the model selection matrix.
//      c. Parse the JSON envelope.
//   3. Merge all parsed chunks via `reducers.merge`.
//   4. Return the breakdown bundle. Do NOT write to phases /
//      assets / tasks — that's `acceptIngestion(runId)` in the
//      provider, after the user reviews in IntakeWizardView.
//
// All Anthropic calls ride the ai-proxy Edge Function (Session 12,
// locked #21) — the key lives server-side, matching Otter / DOG.

import scriptChunker from './chunkers/script'
import { callAI } from '../../../cloud/aiProxy'
import { textFromMessage } from '../../../cloud/anthropicStream'
import { hasLocalServer } from '../../../lib/localData'
// Note on the S19 plan: it preferred injecting a resolved model map into
// `runIngestion` over importing the resolver here, on the grounds that a
// module-scope const cannot read React state and would "silently ignore every
// override in S20". That objection applies to the old `MODEL_MATRIX` const —
// it does not apply to `modelFor`, which is a function that reads the current
// override sources at call time. So intake resolves models the same way every
// other call site does, rather than via a second mechanism the provider has to
// remember to keep in sync. `pipeline.js` stays pure and testable: tests set
// overrides with `setModelSources` and no React is involved.
import { modelFor } from '../../../lib/activeModel'
import treatmentChunker from './chunkers/treatment'
import gddChunker from './chunkers/gdd'
import deckChunker from './chunkers/deck'
import outlineChunker from './chunkers/outline'
import notesChunker from './chunkers/notes'
import briefChunker from './chunkers/brief'
import pitchBibleChunker from './chunkers/pitchBible'
import lookbookChunker from './chunkers/lookbook'

import { PERSONAS, buildPersonaBlock } from './personas'
import reducers from './reducers'
// B3 (Track B): the desktop loopback API refuses /api without the per-launch
// token; localFetch attaches it (same-origin URLs only).
import { localFetch } from '../../../lib/localServerFetch.js'

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

// Document kind -> registry key. This replaces the old MODEL_MATRIX, which
// mapped each kind straight to a hardcoded model id and was six of the
// seventeen call sites that died when Sonnet 4 was retired.
//
// The values here are registry keys, not model ids, so this map cannot rot:
// a key is a stable contract, and the model behind it is resolved at call
// time by `modelFor`. Keep it exhaustive — `document_kind` values come from
// the classifier and the extension hints below, and an unlisted kind falls
// back to `other`.
export const MODEL_KEYS = {
  script:      'rabbit.intake.script',
  treatment:   'rabbit.intake.treatment',
  gdd:         'rabbit.intake.gdd',
  brief:       'rabbit.intake.brief',
  pitch_bible: 'rabbit.intake.pitch_bible',
  lookbook:    'rabbit.intake.lookbook',
  deck:        'rabbit.intake.deck',
  outline:     'rabbit.intake.outline',
  notes:       'rabbit.intake.notes',
  other:       'rabbit.intake.other',
}

export const CHUNKERS = {
  script:      scriptChunker,
  treatment:   treatmentChunker,
  gdd:         gddChunker,
  brief:       briefChunker,
  pitch_bible: pitchBibleChunker,
  lookbook:    lookbookChunker,
  deck:        deckChunker,
  outline:     outlineChunker,
  notes:       notesChunker,
}

const EXTENSION_HINTS = {
  fountain: 'script',
  fdx: 'script',
  txt: 'notes',
  md: 'brief',
  markdown: 'brief',
  docx: 'treatment',
  doc: 'treatment',
  pdf: 'treatment', // upgraded by Haiku classifier when ambiguous
  pptx: 'deck',
  ppt: 'deck',
  key: 'deck',
}

const RESPONSE_SCHEMA_BLOCK = `Return ONLY a single valid JSON object — no prose, no markdown
fences, no commentary. The object MUST conform to this exact shape:

{
  "phases":  [{ "name": string, "rationale": string, "approx_start_offset_days": number | null }],
  "assets":  [{ "name": string, "type": string, "phase_hint": string | null, "rationale": string }],
  "tasks":   [{ "asset_hint": string | null, "title": string, "role": string | null, "bid_days": number | null, "priority": "low" | "med" | "high" | "crit", "rationale": string }],
  "budget_lines": [{ "category": string, "label": string, "amount": number | null, "role_hint": string | null }],
  "risks":   [{ "label": string, "severity": "low" | "med" | "high" | "crit", "mitigation": string }],
  "open_questions": [string]
}

Rules:
- If you do not know a number, use null. Do NOT invent budgets, days, or dates.
- Asset \`type\` should be one of: character, environment, prop, vehicle, vfx, ui, sfx, music, doc, other.
- Task \`priority\` defaults to "med" unless the source explicitly signals urgency.
- Each rationale must reference something concrete from the chunk text.
- If the chunk has nothing relevant for an array, return [].`

const DEFAULT_CONCURRENCY = 3

// ─────────────────────────────────────────────────────────────
// File text extraction
// ─────────────────────────────────────────────────────────────

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

async function extractTextFromFile(file) {
  // `file` may be a real File/Blob or our intake descriptor
  // ({ name, mimeType, dataUrl, path }). We try the cheap paths
  // first then fall back to FileReader on a Blob.
  const ext = extOf(file?.name)

  // Plain text formats — read directly.
  if (ext === 'txt' || ext === 'md' || ext === 'markdown' || ext === 'fountain') {
    if (typeof file.text === 'function') return await file.text()
    if (file.dataUrl) return decodeDataUrlAsText(file.dataUrl)
    if (file instanceof Blob) return await file.text()
  }

  // .docx via mammoth — dynamic import so the dependency only
  // loads when an intake actually needs it.
  if (ext === 'docx') {
    const mammoth = await import('mammoth')
    const arrayBuffer = await blobToArrayBuffer(await asBlob(file))
    const result = await mammoth.default.extractRawText({ arrayBuffer })
    return result?.value || ''
  }

  // .pdf — call the main process extractor. The route lives in
  // electron/main.cjs and lazy-loads pdf-parse on demand. The
  // payload is JSON `{ name, dataUrl }` to match the existing
  // rabbit file upload pattern (no multipart middleware).
  if (ext === 'pdf') {
    try {
      if (!hasLocalServer()) {
        console.warn('[RABBIT intake] PDF text extraction runs in the desktop app only — treating', file?.name, 'as empty')
        return ''
      }
      const dataUrl = file?.dataUrl || (await blobToDataUrl(await asBlob(file)))
      const res = await localFetch('/api/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file?.name || 'upload.pdf', dataUrl }),
      })
      if (!res.ok) throw new Error(`extract-pdf ${res.status}`)
      const data = await res.json()
      return data?.text || ''
    } catch (err) {
      console.warn('[RABBIT intake] /api/extract-pdf failed, returning empty text:', err)
      return ''
    }
  }

  // .pptx — extract slide text via JSZip if available, otherwise
  // best-effort fall back to an empty string. Session 3 wires up
  // the DOG slide parser if there's one to reuse.
  if (ext === 'pptx') {
    try {
      const JSZip = (await import('jszip')).default
      const blob = await asBlob(file)
      const buf = await blobToArrayBuffer(blob)
      const zip = await JSZip.loadAsync(buf)
      const slideNames = Object.keys(zip.files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort()
      const parts = []
      for (const name of slideNames) {
        const xml = await zip.files[name].async('string')
        const stripped = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        parts.push(`\f${stripped}`)
      }
      return parts.join('\n')
    } catch (err) {
      console.warn('[RABBIT intake] pptx extraction unavailable:', err)
      return ''
    }
  }

  // Unknown — try a Blob.text() as a last resort.
  try {
    const blob = await asBlob(file)
    return await blob.text()
  } catch {
    return ''
  }
}

async function asBlob(file) {
  if (file instanceof Blob) return file
  if (file?.dataUrl) {
    const res = await fetch(file.dataUrl)
    return await res.blob()
  }
  throw new Error('Cannot derive Blob from intake file')
}

function blobToArrayBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function decodeDataUrlAsText(dataUrl) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return ''
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (meta.includes(';base64')) {
    try {
      return atob(payload)
    } catch {
      return ''
    }
  }
  try {
    return decodeURIComponent(payload)
  } catch {
    return payload
  }
}

// ─────────────────────────────────────────────────────────────
// Document-kind detection
// ─────────────────────────────────────────────────────────────

async function detectDocumentKind({ file, sampleText }) {
  // 1. If the caller supplied an explicit kind, trust it.
  if (file?.documentKind && CHUNKERS[file.documentKind]) {
    return file.documentKind
  }

  // 2. Extension hint.
  const ext = extOf(file?.name)
  const hint = EXTENSION_HINTS[ext]
  if (hint && hint !== 'treatment') return hint // .docx/.pdf are ambiguous

  // 3. Cheap text heuristics before reaching for the model.
  const text = (sampleText || '').slice(0, 2000)
  if (/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/m.test(text)) return 'script'
  if (/^slide\s+\d+/im.test(text)) return 'deck'
  if (/^#\s+act\s+(one|two|three|i{1,3})/im.test(text)) return 'treatment'

  // 4. Haiku classifier — last resort (rides the authenticated ai-proxy).
  try {
    const kind = await haikuClassify(text)
    if (kind && CHUNKERS[kind]) return kind
  } catch (err) {
    console.warn('[RABBIT intake] Haiku classifier failed:', err)
  }

  // 5. Fall back to the extension hint or "notes".
  return hint || 'notes'
}

async function haikuClassify(sampleText) {
  const data = await callAI({
    model: modelFor('rabbit.classify'),
    max_tokens: 32,
    system:
      'Classify the document. Reply with ONE of: script, treatment, gdd, brief, pitch_bible, lookbook, deck, outline, notes. No other text.',
    messages: [{ role: 'user', content: sampleText || '(empty)' }],
    tool: 'rabbit-intake',
  })
  // S30: never index content[0] — a thinking block can sit there. See
  // textFromMessage's header.
  const raw = textFromMessage(data).trim().toLowerCase()
  const m = raw.match(/script|treatment|gdd|brief|pitch_bible|lookbook|deck|outline|notes/)
  return m ? m[0] : null
}

// ─────────────────────────────────────────────────────────────
// Worker pool — concurrency-bounded chunk analysis
// ─────────────────────────────────────────────────────────────

async function runWorkerPool({ chunks, personas, concurrency, onProgress, signal }) {
  const total = chunks.length
  let done = 0
  const results = new Array(total)
  let cursor = 0
  let lastError = null

  async function worker() {
    while (true) {
      if (signal?.aborted) throw new Error('aborted')
      const myIndex = cursor++
      if (myIndex >= total) return
      const chunk = chunks[myIndex]
      try {
        const parsed = await analyzeChunk({ chunk, personas })
        results[myIndex] = parsed
      } catch (err) {
        console.error('[RABBIT intake] chunk analysis failed:', chunk.chunk_label, err)
        results[myIndex] = null
        lastError = err
      } finally {
        done += 1
        if (typeof onProgress === 'function') {
          onProgress({ chunksDone: done, chunksTotal: total, lastLabel: chunk.chunk_label })
        }
      }
    }
  }

  const workers = []
  const n = Math.max(1, Math.min(concurrency || DEFAULT_CONCURRENCY, total))
  for (let i = 0; i < n; i++) workers.push(worker())
  await Promise.all(workers)

  const parsed = results.filter(Boolean)
  // Session 12: the per-user API-key gate ahead of the run is gone (locked
  // #21), so a TOTAL failure — e.g. the proxy's ai_not_configured — must fail
  // the run loudly instead of resolving into a fake-successful empty review.
  // Partial failures stay tolerated, as before.
  if (parsed.length === 0 && total > 0) {
    throw new Error(
      lastError?.message
        ? `AI analysis failed for every chunk — ${lastError.message}`
        : 'AI analysis failed for every chunk',
    )
  }
  return parsed
}

async function analyzeChunk({ chunk, personas }) {
  const personaIds = personas && personas.length
    ? personas.filter(id => PERSONAS[id])
    : Object.keys(PERSONAS)
  const personaBlock = buildPersonaBlock(personaIds)

  const systemPrompt = [
    personaBlock,
    '',
    'You are analyzing ONE chunk of a larger production document.',
    `Chunk label: ${chunk.chunk_label}`,
    `Document kind: ${chunk.document_kind}`,
    '',
    RESPONSE_SCHEMA_BLOCK,
  ].filter(Boolean).join('\n')

  const userMessage = `Chunk text:\n\n${chunk.raw_text}`

  const model = modelFor(MODEL_KEYS[chunk.document_kind] || MODEL_KEYS.other)

  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt))
    try {
      const data = await callAI({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tool: 'rabbit-intake',
      })
      const text = textFromMessage(data)
      const parsed = extractJson(text)
      if (parsed) return parsed
      lastError = 'Could not parse JSON envelope'
    } catch (err) {
      lastError = err.message || String(err)
      if (attempt >= 2) throw err
    }
  }
  throw new Error(lastError || 'analyzeChunk failed')
}

function extractJson(text) {
  if (!text) return null
  // Strip markdown fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/)
  const body = fenced ? fenced[1] : text
  // Find the first {...} balanced object.
  const start = body.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        const candidate = body.slice(start, i + 1)
        try {
          return JSON.parse(candidate)
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Run the full chunked-analysis pipeline against a set of files.
 *
 * @param {object} opts
 * @param {string} opts.projectId               Active project (for telemetry / chunk row writes)
 * @param {Array<object>} opts.files            Files to ingest. Only those with `is_core_definer === true` are processed.
 * @param {string[]} [opts.personas]            Persona IDs to bias the prompt. Defaults to all three.
 * @param {(p: { chunksDone: number, chunksTotal: number, lastLabel: string }) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]           Abort hook.
 * @param {number} [opts.concurrency]           Worker pool size (defaults to 3).
 * @returns {Promise<{
 *   breakdown: object,
 *   chunks: object[],
 *   files: object[],
 * }>}
 */
export async function runIngestion(opts) {
  const {
    projectId,
    files,
    personas,
    onProgress,
    signal,
    concurrency = DEFAULT_CONCURRENCY,
  } = opts || {}

  if (!Array.isArray(files) || files.length === 0) {
    return {
      breakdown: reducers.merge([]),
      chunks: [],
      files: [],
    }
  }

  const coreFiles = files.filter(f => f && f.is_core_definer)
  if (coreFiles.length === 0) {
    return {
      breakdown: reducers.merge([]),
      chunks: [],
      files: [],
    }
  }

  // ── 1. Extract + chunk every core file. ──────────────────
  const fileResults = []
  const allChunks = []

  for (const file of coreFiles) {
    if (signal?.aborted) throw new Error('aborted')
    let rawText = ''
    try {
      rawText = await extractTextFromFile(file)
    } catch (err) {
      console.warn('[RABBIT intake] text extraction failed:', file?.name, err)
    }

    const documentKind = await detectDocumentKind({
      file,
      sampleText: rawText.slice(0, 2000),
    })

    const chunker = CHUNKERS[documentKind] || CHUNKERS.notes
    const rawChunks = chunker.split(rawText) || []
    const decoratedChunks = rawChunks.map((c, i) => ({
      ...c,
      document_kind: documentKind,
      file_name: file?.name || 'untitled',
      file_id: file?.id || null,
      chunk_index: i,
      project_id: projectId || null,
      status: 'queued',
    }))

    fileResults.push({
      file_id: file?.id || null,
      file_name: file?.name || 'untitled',
      document_kind: documentKind,
      chunk_count: decoratedChunks.length,
    })
    allChunks.push(...decoratedChunks)
  }

  if (allChunks.length === 0) {
    return {
      breakdown: reducers.merge([]),
      chunks: [],
      files: fileResults,
    }
  }

  // ── 2. Worker pool — analyze each chunk. ─────────────────
  const parsedResults = await runWorkerPool({
    chunks: allChunks,
    personas,
    concurrency,
    onProgress,
    signal,
  })

  // ── 3. Reduce. ───────────────────────────────────────────
  const breakdown = reducers.merge(parsedResults)

  return {
    breakdown,
    chunks: allChunks,
    files: fileResults,
  }
}

export default { runIngestion, MODEL_KEYS, CHUNKERS }
