// ============================================================
// RABBIT v0.1 — pure selectors
// ============================================================
//
// All selectors take the bundle slices as plain arguments — no
// React, no context. The provider exports memoized wrappers for
// the views to consume in Session 3.

// ─── Status taxonomy helpers ────────────────────────────────
// "Done" has exactly ONE definition, in dependencyStatus.js (Phase 7, Track A
// bundle A2, 2026-09-06). This file carried its own set of done states and
// AssetStatusWarningModal carried a private isDone; they agreed by luck. The
// old name is kept as an alias so every existing caller keeps working.
import { isDone } from './dependencyStatus';
const TASK_ACTIVE_STATES = new Set(['in_progress', 'pending_review', 'needs_revisions']);

export const isTaskDone = isDone;
export function isTaskActive(task) {
  return task && TASK_ACTIVE_STATES.has(task.status);
}

// ─── Grouping ────────────────────────────────────────────────
export function selectAssetsByPhase(assets, phaseId) {
  if (!assets) return [];
  return assets.filter(a => a.phase_id === phaseId).sort(sortBySortOrder);
}

function sortBySortOrder(a, b) {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0);
}

// ─── Asset derived status ───────────────────────────────────
//
// "derived" = the status the asset *would* have if it were a roll-up
// of its tasks. The user-facing `asset.status` field is independent
// (see schema.sql) so we can warn when the user marks an asset
// "approved" while child tasks are still in flight.
//
// FX2 (0096): over a list already chosen — the tasks ABOUT an asset (any of
// their items), which the provider reads from the items (ctx's
// selectAssetDerivedStatus). VW1m (2026-10-16): the raw selectTasksByAsset,
// selectAssetDerivedStatus and selectAssetStatusWarning that read a task's
// single asset_id (its main asset) are gone; nothing called them.
export function assetStatusOfTasks(list) {
  if (!Array.isArray(list) || list.length === 0) return 'not_started';
  if (list.every(isTaskDone)) {
    if (list.some(t => t.status === 'final')) return 'final';
    return 'approved';
  }
  if (list.some(isTaskActive)) return 'in_progress';
  if (list.some(t => t.status === 'blocked')) return 'blocked';
  if (list.some(t => t.status === 'on_hold')) return 'on_hold';
  return 'waiting_to_start';
}

/**
 * True when the asset's user-facing status is approved/final but at least
 * one task about it is not yet done. FX2 (0096): over a list already chosen
 * (the tasks about it: ctx's selectAssetStatusWarning).
 */
export function assetWarningOfTasks(asset, list) {
  if (!asset) return false;
  if (!['approved', 'final'].includes(asset.status)) return false;
  return (Array.isArray(list) ? list : []).some(t => !isTaskDone(t));
}

// ─── Budget rollup ──────────────────────────────────────────
//
// v0.1 rollup is a flat sum of task bid_days × default day rate
// from the active rate card (if any). The provider feeds the
// resolved day rates in via `roleRates`. If no rate is found for
// a role we fall back to `fallbackDayRate` (default 0).
export function selectProjectBudgetRollup({
  tasks,
  roleRates = {},
  fallbackDayRate = 0,
  currency = 'USD',
}) {
  if (!tasks) return { total: 0, byRole: {}, currency };

  const byRole = {};
  let total = 0;
  for (const task of tasks) {
    if (!task.bid_days) continue;
    const role = task.assigned_role_slug || 'unassigned';
    const rate = roleRates[role] ?? fallbackDayRate;
    const cost = Number(task.bid_days) * Number(rate);
    if (!byRole[role]) byRole[role] = { days: 0, cost: 0, role };
    byRole[role].days += Number(task.bid_days);
    byRole[role].cost += cost;
    total += cost;
  }
  return { total, byRole, currency };
}

// ─── Variance ───────────────────────────────────────────────
//
// `variance = logged_days - bid_days`. Positive = over budget,
// negative = under, zero = on-target. VW1m (2026-10-16): the project's
// only; an asset's (selectVarianceForAsset, by a task's main asset, called
// by no screen) is gone — the Budget's By asset tab splits a task between
// its assets.
export function selectVarianceForProject(tasks) {
  let bid = 0, logged = 0;
  for (const t of tasks || []) {
    bid    += Number(t.bid_days || 0);
    logged += Number(t.logged_days || 0);
  }
  return { bid, logged, variance: logged - bid };
}

// ─── Critical path (FS-only DAG longest path) ───────────────
//
// v0.1 ignores SS/FF/SF link types and lag for the path computation.
// Returns an array of task IDs forming the longest weighted path
// through the dependency DAG, weighted by `bid_days`.
//
// The tasks/dependencies graph is small (≤ a few hundred nodes per
// project), so a naive DP over a topo sort is fine.
export function selectCriticalPath(tasks, dependencies) {
  if (!tasks?.length) return [];

  const taskById = Object.fromEntries(tasks.map(t => [t.id, t]));
  const successors  = {};
  const predecessors = {};
  for (const t of tasks) { successors[t.id] = []; predecessors[t.id] = []; }
  for (const dep of dependencies || []) {
    if (!taskById[dep.predecessor_id] || !taskById[dep.successor_id]) continue;
    successors[dep.predecessor_id].push(dep.successor_id);
    predecessors[dep.successor_id].push(dep.predecessor_id);
  }

  // Topological order (Kahn).
  const inDeg = Object.fromEntries(tasks.map(t => [t.id, predecessors[t.id].length]));
  const queue = tasks.filter(t => inDeg[t.id] === 0).map(t => t.id);
  const topo = [];
  while (queue.length) {
    const id = queue.shift();
    topo.push(id);
    for (const succ of successors[id]) {
      inDeg[succ] -= 1;
      if (inDeg[succ] === 0) queue.push(succ);
    }
  }
  if (topo.length !== tasks.length) return []; // cycle — bail

  // DP longest path by bid_days.
  const dist = {};
  const back = {};
  for (const id of topo) {
    const w = Number(taskById[id].bid_days || 0);
    let best = w;
    let bestPrev = null;
    for (const pred of predecessors[id]) {
      const candidate = (dist[pred] || 0) + w;
      if (candidate > best) {
        best = candidate;
        bestPrev = pred;
      }
    }
    dist[id] = best;
    back[id] = bestPrev;
  }

  // Find tail with the largest dist value, then walk back.
  let tail = null;
  let max = -Infinity;
  for (const id of Object.keys(dist)) {
    if (dist[id] > max) { max = dist[id]; tail = id; }
  }
  const path = [];
  while (tail) { path.unshift(tail); tail = back[tail]; }
  return path;
}
