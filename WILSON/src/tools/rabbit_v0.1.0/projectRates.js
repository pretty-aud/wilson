// ============================================================
// RABBIT — projectRates
// ============================================================
//
// Session 27. The third thing Audrey asked for on 2026-08-03, and the one
// S26 could not deliver:
//
//   "a lot of these project specific details like unique margin, unique
//    contingency, unique team member rates ... should be saved in the project
//    folder as a file the system can read."
//
// Margin and contingency went into PROJECT.json. The RATES did not, and the
// reason was measured rather than cautious:
//
//   project_rate_overrides_select :: can_access_project_money(project_id)
//                                    -- MANAGER ONLY
//   rabbit_files_select           :: any authenticated project member, for any
//                                    object under projects/<id>/ whose third
//                                    path segment is not money-gated
//
// PROJECT.json has no third path segment, so it falls under the base policy
// and every project member can read it. Putting per-member rates in there
// would have handed the whole team the exact figures RLS had just denied
// them — the S24 invoice defect in a new file.
//
// So the rates get a segment of their own. Audrey chose this over leaving
// them app-only (2026-08-04), so that a project folder handed to an outside
// partner carries its own commercial terms.
//
//
// 🚨 RATES_SEGMENT IS SHARED WITH MIGRATION 0042 AND IS LOAD-BEARING.
//
// public.rabbit_money_segment(text) decides which paths are manager-only, and
// it is the ONLY definition — the three base storage policies negate it and
// the four money policies assert it. This constant must be one of the values
// that function returns true for.
//
// Getting it wrong does not fail loudly. 0038 shipped the invoice segment
// lowercase while the policies compared it literally, and the gate INVERTED:
// the file became invisible to the managers allowed to read it and visible to
// everyone else. Nothing errored. 0039 had to fix it in six places, which is
// why 0042 reduced it to one.
//
// The predicate is case-insensitive now, so case alone cannot invert it — but
// a TYPO here still can, because a segment the function does not recognise is
// not gated at all, and a rates file at projects/<id>/FINANC/RATES.json would
// be world-readable to the whole project. projectRates.test.js pins the exact
// string, and pgTAP 53 probes that a plain member cannot read this path.
//
// → Changing this value means changing 0042 in the same commit, or not at all.
export const RATES_SEGMENT = 'FINANCE'

/** The file's name inside the gated folder. */
export const RATES_FILENAME = 'RATES.json'

/** Bumped when the SHAPE changes, so an importer can refuse what it cannot read. */
export const RATES_VERSION = 1

/**
 * The storage path, relative to the bucket root. One definition, so the
 * adapter and any future reader cannot disagree about where this lives.
 */
export function projectRatesPath(projectId) {
  return `projects/${projectId}/${RATES_SEGMENT}/${RATES_FILENAME}`
}

/**
 * Build the rates mirror. Pure — takes what the caller already loaded and
 * returns an object, so the clock and the fetching stay outside.
 *
 * `members` is an optional id -> display name map. A rates file listing bare
 * UUIDs is useless for the one job this file has (handing a project to
 * somebody outside WILSON), so a name is included when the caller has one and
 * the field is simply absent when it does not.
 */
export function buildProjectRatesMirror(project, overrides = [], generatedAt = null, members = {}) {
  return {
    wilson_rates_version: RATES_VERSION,
    generated_at: generatedAt,
    project_id: project?.id || null,
    project_title: project?.title || null,
    currency: project?.budget_currency || null,

    // 🚨 Stated IN the file, not only in this comment. Someone who finds this
    // on a drive in a year has none of the above context, and the two things
    // they must know are that editing it changes nothing and that it is not
    // supposed to be passed around.
    authority: 'database',
    confidentiality:
      'MANAGER-ONLY. This file lives in a restricted folder because it states '
      + 'what individual people are paid. WILSON serves it only to project '
      + 'managers and workspace admins. Treat a copy taken out of that folder '
      + 'as confidential.',
    note:
      'Generated MIRROR of the project-scoped rate overrides held in WILSON. '
      + 'The database is authoritative: editing this file changes nothing. It '
      + 'exists for portability, recovery and handoff.',

    // A project override REPLACES the workspace rate card for this project
    // only — that is the whole point of the store (see useProjectRateOverrides).
    // Recording which axis each row is keyed on matters: exactly one of
    // role_slug / member_id is set, because a row keyed by both has no single
    // resolution order and the database CHECK refuses it.
    overrides: (overrides || []).map(o => ({
      scope:        o.member_id ? 'member' : 'role',
      role_slug:    o.role_slug || null,
      member_id:    o.member_id || null,
      ...(o.member_id && members[o.member_id] ? { member_name: members[o.member_id] } : {}),
      day_rate:     o.day_rate ?? null,
      week_rate:    o.week_rate ?? null,
      month_rate:   o.month_rate ?? null,
      wage:         o.wage ?? null,
      currency:     o.currency || null,
      notes:        o.notes || '',
    })).sort((a, b) =>
      (a.scope + (a.role_slug || a.member_id || '')).localeCompare(
        b.scope + (b.role_slug || b.member_id || ''))),

    count: (overrides || []).length,
  }
}

/** The mirror as the bytes that get written. Two-space indent: a person reads this. */
export function serializeProjectRates(mirror) {
  return JSON.stringify(mirror, null, 2)
}
