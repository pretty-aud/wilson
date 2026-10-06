// ============================================================
// budgetMath — the money rules, in one place, under test
// ============================================================
//
// Session 24. Before this file, every rule below was duplicated inline across
// BudgetView.jsx, CrewTeamTab.jsx, TalentTab.jsx and ClientViewTab.jsx, and
// NONE of it had a single test at any layer. Arithmetic that decides what a
// production is bid at, and whether it made a profit, is the last thing that
// should be pinned only by four copies agreeing with each other.
//
// These are pure functions on purpose: no hooks, no adapter, no React, so
// they can be tested directly and reused by both adapters.

// ── The inheritance rule ────────────────────────────────────────
//
// A budget line's margin/contingency percentage is a FALLBACK, not a seed:
// NULL (or undefined) means "inherit the project default".
//
// 🚨 ZERO IS A REAL VALUE. `0` is a deliberate "no margin on this line" and
// must NOT inherit. The existing UI gets this right by testing `!= null`
// rather than falsiness (CrewTeamTab.jsx:330-331), and CrewTeamTab.jsx:439
// resets a line by writing NULL back precisely so it starts inheriting again.
// A `||` here instead of a null check would silently promote every
// deliberate 0% to the project default — an error that looks like nothing at
// all until someone reconciles a bid.
export function effectivePct(lineValue, projectDefault) {
  if (lineValue !== null && lineValue !== undefined && lineValue !== '') {
    const n = Number(lineValue)
    if (Number.isFinite(n)) return n
  }
  const d = Number(projectDefault)
  return Number.isFinite(d) ? d : 0
}

// ── Margin and contingency ──────────────────────────────────────
//
// 🚨 BOTH ARE APPLIED TO THE BASE. Contingency is NOT added first and then
// margined. MEASURED in three independent places that already agree:
// BudgetView.jsx:347-349, CrewTeamTab.jsx:332-333, ClientViewTab.jsx:86-88.
//
// Margin IS the profit, so `baseCost` here is the actual cost to the company
// and `total` is what the client is bid. Keeping the three parts separate is
// what makes profit derivable at all — store only the marked-up total and the
// company's own cost can never be recovered.
export function applyMarginAndContingency(baseCost, marginPct, contingencyPct) {
  const base = Number(baseCost) || 0
  const m = Number(marginPct) || 0
  const c = Number(contingencyPct) || 0
  const marginAmt = round2(base * (m / 100))
  const contingencyAmt = round2(base * (c / 100))
  return {
    baseCost: round2(base),
    marginAmt,
    contingencyAmt,
    total: round2(base + marginAmt + contingencyAmt),
  }
}

// Profit = what we bid − what it actually cost us.
// Deliberately NOT "the margin amount": the margin is the profit we PLANNED,
// and the whole point of tracking actuals is that the two differ.
export function profit(bidTotal, actualCost) {
  return round2((Number(bidTotal) || 0) - (Number(actualCost) || 0))
}

// ── Rate resolution ─────────────────────────────────────────────
//
// project override -> workspace rate card -> blank.
//
// 🚨 A rate edited inside a project is PROJECT-SCOPED (Audrey, twice). The
// override never writes back to rate_cards/rate_card_entries, which are
// workspace-wide — otherwise negotiating one project's rate would silently
// rewrite every other project's numbers.
//
// Two keys, and the person wins: an unstaffed BID line is priced by
// `role_slug` at the role's external/day rate, and once a real person holds
// the line it is priced by `member_id` at that person's INTERNAL rate
// (`wage`). The external rate is mainly a bidding instrument.
export function resolveRate({
  roleSlug = null,
  memberId = null,
  overrides = [],
  entries = [],
  preferInternal = false,
} = {}) {
  const pick = (row) => {
    if (!row) return null
    const v = preferInternal
      ? (firstNumber(row.wage) ?? firstNumber(row.day_rate))
      : (firstNumber(row.day_rate) ?? firstNumber(row.wage))
    return v
  }

  // 1. A person-scoped project override is the most specific thing there is.
  if (memberId) {
    const o = overrides.find(r => r.member_id === memberId)
    const v = pick(o)
    if (v != null) return { rate: v, source: 'project_override_member' }
  }

  // 2. A role-scoped project override.
  if (roleSlug) {
    const o = overrides.find(r => r.role_slug === roleSlug && !r.member_id)
    const v = pick(o)
    if (v != null) return { rate: v, source: 'project_override_role' }
  }

  // 3. The workspace rate card — the person's own entry first.
  if (memberId) {
    const e = entries.find(r => r.member_id === memberId)
    const v = pick(e)
    if (v != null) return { rate: v, source: 'rate_card_member' }
  }

  // 4. The workspace rate card — the role.
  if (roleSlug) {
    const e = entries.find(r => r.role_slug === roleSlug)
    const v = pick(e)
    if (v != null) return { rate: v, source: 'rate_card_role' }
  }

  // 5. Blank. NOT zero — a missing rate and a genuine 0 rate are different
  // facts, and rendering an unpriced role as $0 is how a bid silently
  // under-quotes. Callers decide how to show "no rate yet".
  return { rate: null, source: 'none' }
}

// Build the slug -> rate map the budget tabs consume, with project overrides
// layered over the workspace rate card.
export function buildRoleRates(entries = [], overrides = []) {
  const map = {}
  for (const e of entries) {
    if (!e?.role_slug) continue
    const n = firstNumber(e.day_rate)
    if (n != null && map[e.role_slug] == null) map[e.role_slug] = n
  }
  for (const o of overrides) {
    if (!o?.role_slug || o.member_id) continue
    const n = firstNumber(o.day_rate)
    if (n != null) map[o.role_slug] = n   // the override WINS
  }
  return map
}

// ── helpers ─────────────────────────────────────────────────────

// Money is rounded to 2dp at each step, matching BudgetView.jsx:347-349.
// Not a float concern the database shares — the columns are numeric — but the
// client must agree with itself across tabs.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// null/undefined/''/NaN all mean "not set". 0 means zero.
function firstNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
