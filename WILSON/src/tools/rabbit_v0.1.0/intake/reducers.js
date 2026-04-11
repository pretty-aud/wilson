// ============================================================
// RABBIT intake — chunk reducer
// ============================================================
//
// Each chunker pass returns the per-chunk schema described in
// §10.4 of the Session 2 prompt:
//
//   { phases, assets, tasks, budget_lines, risks, open_questions }
//
// `merge(allParsedJson)` collapses N of those into a single
// breakdown bundle that's ready for the user-review step in
// Session 3's IntakeWizardView. After the user accepts, the
// provider's `acceptIngestion(runId)` writes everything in one
// transaction via the active adapter.

const ASSET_TYPES_DEFAULT = 'other'

/** Lowercase, collapse whitespace, strip punctuation. */
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Cheap fuzzy comparison: equal after normalization, or one contains the other. */
function fuzzyEqual(a, b) {
  const na = normName(a)
  const nb = normName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.length >= 4 && nb.includes(na)) return true
  if (nb.length >= 4 && na.includes(nb)) return true
  return false
}

// ─────────────────────────────────────────────────────────────
// Phase merging
// ─────────────────────────────────────────────────────────────

function mergePhases(allParsed) {
  const out = []
  for (const parsed of allParsed) {
    for (const phase of parsed.phases || []) {
      if (!phase || !phase.name) continue
      const existing = out.find(p => fuzzyEqual(p.name, phase.name))
      if (existing) {
        // Keep the earliest start offset, accumulate rationale snippets.
        if (
          typeof phase.approx_start_offset_days === 'number' &&
          (existing.approx_start_offset_days == null ||
            phase.approx_start_offset_days < existing.approx_start_offset_days)
        ) {
          existing.approx_start_offset_days = phase.approx_start_offset_days
        }
        if (phase.rationale && !existing.rationale.includes(phase.rationale)) {
          existing.rationale = existing.rationale
            ? `${existing.rationale}\n• ${phase.rationale}`
            : phase.rationale
        }
        existing.merge_count += 1
      } else {
        out.push({
          name: phase.name,
          rationale: phase.rationale || '',
          approx_start_offset_days:
            typeof phase.approx_start_offset_days === 'number'
              ? phase.approx_start_offset_days
              : null,
          merge_count: 1,
        })
      }
    }
  }
  // Sort by start offset (nulls last) so the user sees a sensible order.
  out.sort((a, b) => {
    const ao = a.approx_start_offset_days ?? Number.POSITIVE_INFINITY
    const bo = b.approx_start_offset_days ?? Number.POSITIVE_INFINITY
    return ao - bo
  })
  return out
}

// ─────────────────────────────────────────────────────────────
// Asset merging
// ─────────────────────────────────────────────────────────────

function mergeAssets(allParsed) {
  const out = []
  for (const parsed of allParsed) {
    for (const asset of parsed.assets || []) {
      if (!asset || !asset.name) continue
      const type = asset.type || ASSET_TYPES_DEFAULT
      const existing = out.find(
        a => a.type === type && fuzzyEqual(a.name, asset.name)
      )
      if (existing) {
        if (asset.phase_hint && !existing.phase_hint) {
          existing.phase_hint = asset.phase_hint
        }
        if (asset.rationale && !existing.rationale.includes(asset.rationale)) {
          existing.rationale = existing.rationale
            ? `${existing.rationale}\n• ${asset.rationale}`
            : asset.rationale
        }
        existing.merge_count += 1
      } else {
        out.push({
          name: asset.name,
          type,
          phase_hint: asset.phase_hint || null,
          rationale: asset.rationale || '',
          merge_count: 1,
        })
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Task merging
// ─────────────────────────────────────────────────────────────

function mergeTasks(allParsed, mergedAssets) {
  const out = []
  for (const parsed of allParsed) {
    for (const task of parsed.tasks || []) {
      if (!task || !task.title) continue
      // Resolve asset_hint to a real merged asset if we can.
      const matchedAsset = task.asset_hint
        ? mergedAssets.find(a => fuzzyEqual(a.name, task.asset_hint))
        : null
      const resolvedAssetName = matchedAsset ? matchedAsset.name : task.asset_hint || null

      const existing = out.find(
        t =>
          fuzzyEqual(t.title, task.title) &&
          (t.asset_hint || '') === (resolvedAssetName || '') &&
          (t.role || '') === (task.role || '')
      )

      if (existing) {
        // Same task surfaced from multiple chunks: sum the bid days.
        if (typeof task.bid_days === 'number') {
          existing.bid_days = (existing.bid_days || 0) + task.bid_days
        }
        if (task.rationale && !existing.rationale.includes(task.rationale)) {
          existing.rationale = existing.rationale
            ? `${existing.rationale}\n• ${task.rationale}`
            : task.rationale
        }
        existing.merge_count += 1
      } else {
        out.push({
          title: task.title,
          asset_hint: resolvedAssetName,
          role: task.role || null,
          bid_days: typeof task.bid_days === 'number' ? task.bid_days : null,
          priority: task.priority || 'med',
          rationale: task.rationale || '',
          merge_count: 1,
        })
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Budget / risk / question merging
// ─────────────────────────────────────────────────────────────

function mergeBudgetLines(allParsed) {
  const out = []
  for (const parsed of allParsed) {
    for (const line of parsed.budget_lines || []) {
      if (!line || !line.label) continue
      const existing = out.find(
        l =>
          (l.category || '') === (line.category || '') &&
          fuzzyEqual(l.label, line.label)
      )
      if (existing) {
        if (typeof line.amount === 'number') {
          existing.amount = (existing.amount || 0) + line.amount
        }
        if (line.role_hint && !existing.role_hint) {
          existing.role_hint = line.role_hint
        }
        existing.merge_count += 1
      } else {
        out.push({
          category: line.category || 'other',
          label: line.label,
          amount: typeof line.amount === 'number' ? line.amount : null,
          role_hint: line.role_hint || null,
          merge_count: 1,
        })
      }
    }
  }
  return out
}

function mergeRisks(allParsed) {
  const out = []
  for (const parsed of allParsed) {
    for (const risk of parsed.risks || []) {
      if (!risk || !risk.label) continue
      const existing = out.find(r => fuzzyEqual(r.label, risk.label))
      if (existing) {
        // Escalate severity if a later chunk says it's worse.
        const order = { low: 0, med: 1, high: 2, crit: 3 }
        if ((order[risk.severity] ?? 1) > (order[existing.severity] ?? 1)) {
          existing.severity = risk.severity
        }
        if (risk.mitigation && !existing.mitigation.includes(risk.mitigation)) {
          existing.mitigation = existing.mitigation
            ? `${existing.mitigation}\n• ${risk.mitigation}`
            : risk.mitigation
        }
        existing.merge_count += 1
      } else {
        out.push({
          label: risk.label,
          severity: risk.severity || 'med',
          mitigation: risk.mitigation || '',
          merge_count: 1,
        })
      }
    }
  }
  return out
}

function mergeOpenQuestions(allParsed) {
  const seen = new Set()
  const out = []
  for (const parsed of allParsed) {
    for (const q of parsed.open_questions || []) {
      if (!q) continue
      const key = normName(q)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(String(q))
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Merge an array of per-chunk parsed JSON objects into a single
 * breakdown bundle.
 *
 * @param {Array<object>} allParsedJson
 * @returns {{
 *   phases: object[],
 *   assets: object[],
 *   tasks: object[],
 *   budget_lines: object[],
 *   risks: object[],
 *   open_questions: string[],
 *   stats: { chunkCount: number }
 * }}
 */
export function merge(allParsedJson) {
  const safe = Array.isArray(allParsedJson) ? allParsedJson.filter(Boolean) : []
  const phases = mergePhases(safe)
  const assets = mergeAssets(safe)
  const tasks = mergeTasks(safe, assets)
  const budget_lines = mergeBudgetLines(safe)
  const risks = mergeRisks(safe)
  const open_questions = mergeOpenQuestions(safe)
  return {
    phases,
    assets,
    tasks,
    budget_lines,
    risks,
    open_questions,
    stats: { chunkCount: safe.length },
  }
}

// Default export keeps imports flexible (`reducers.merge(...)` style).
export default { merge }
