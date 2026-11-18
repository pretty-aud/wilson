// GENERATED from src/tools/rabbit_v0.1.0/state/taskItemsModel.js by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/rules/taskItems.cjs.entry.js
var taskItems_cjs_entry_exports = {};
__export(taskItems_cjs_entry_exports, {
  FIELD_KIND: () => FIELD_KIND,
  ITEM_KINDS: () => ITEM_KINDS,
  KIND_FIELD: () => KIND_FIELD,
  LINK_FIELDS: () => LINK_FIELDS,
  compareItems: () => compareItems,
  copyFieldsFromItems: () => copyFieldsFromItems,
  isItemKind: () => isItemKind,
  itemShapeProblem: () => itemShapeProblem,
  itemsOfTask: () => itemsOfTask,
  nextPosition: () => nextPosition,
  planLegacyFieldWrite: () => planLegacyFieldWrite,
  seedItemsFor: () => seedItemsFor
});
module.exports = __toCommonJS(taskItems_cjs_entry_exports);

// src/tools/rabbit_v0.1.0/state/taskItemsModel.js
var ITEM_KINDS = Object.freeze(["asset", "scene", "shot", "level", "experience"]);
var KIND_FIELD = Object.freeze({
  asset: "asset_id",
  scene: "scene_id",
  shot: "shot_id",
  level: "level_id",
  experience: "experience_id"
});
var LINK_FIELDS = Object.freeze(ITEM_KINDS.map((k) => KIND_FIELD[k]));
var FIELD_KIND = Object.freeze(
  Object.fromEntries(ITEM_KINDS.map((k) => [KIND_FIELD[k], k]))
);
var COLUMN_KINDS = Object.freeze(["asset", "scene", "shot"]);
var KIND_LABEL = Object.freeze({
  asset: "Asset",
  scene: "Scene",
  shot: "Shot",
  level: "Level",
  experience: "Experience"
});
var KIND_LABEL_PLURAL = Object.freeze({
  asset: "Assets",
  scene: "Scenes",
  shot: "Shots",
  level: "Levels",
  experience: "Experiences"
});
var NO_KIND_LABEL = Object.freeze({
  asset: "No asset",
  scene: "No scene",
  shot: "No shot",
  level: "No level",
  experience: "No experience"
});
var ITEM_SORTS = Object.freeze(["type", "name", "date"]);
var ITEM_SORT_LABEL = Object.freeze({ type: "Type", name: "A to Z", date: "Date created" });
function isItemKind(kind) {
  return ITEM_KINDS.includes(kind);
}
function timeOf(v) {
  if (v == null || v === "") return 0;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return 0;
  const m = /\.(\d{4,})/.exec(String(v));
  return m ? t + Number(m[1].slice(3, 6).padEnd(3, "0")) / 1e3 : t;
}
var byCodeUnit = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function compareItems(a, b) {
  const pa = Number(a?.position) || 0;
  const pb = Number(b?.position) || 0;
  if (pa !== pb) return pa - pb;
  const ta = timeOf(a?.created_at);
  const tb = timeOf(b?.created_at);
  if (ta !== tb) return ta - tb;
  return byCodeUnit(String(a?.id ?? ""), String(b?.id ?? ""));
}
function itemsOfTask(items, taskId, kind = null) {
  if (!Array.isArray(items) || taskId == null) return [];
  const id = String(taskId);
  const mine = items.filter((i) => i && String(i.task_id) === id && (kind == null || i.entity_type === kind));
  return mine.sort((a, b) => {
    if (a.entity_type !== b.entity_type) {
      return ITEM_KINDS.indexOf(a.entity_type) - ITEM_KINDS.indexOf(b.entity_type);
    }
    return compareItems(a, b);
  });
}
function copyFieldsFromItems(taskItems) {
  const out = {};
  for (const kind of ITEM_KINDS) out[KIND_FIELD[kind]] = null;
  const sorted = (Array.isArray(taskItems) ? taskItems.slice() : []).sort(compareItems);
  for (const i of sorted) {
    const f = KIND_FIELD[i?.entity_type];
    if (f && out[f] == null) out[f] = i.entity_id;
  }
  return out;
}
function nextPosition(items, taskId, kind) {
  let max = -1;
  for (const i of itemsOfTask(items, taskId, kind)) {
    const p = Number(i.position) || 0;
    if (p > max) max = p;
  }
  return Math.min(max + 1, MAX_ITEM_POSITION);
}
var idOrNull = (v) => v == null || v === "" ? null : String(v);
function planLegacyFieldWrite(items, taskId, kind, value, previous, make) {
  const none = { remove: [], insert: null };
  if (!isItemKind(kind) || taskId == null) return none;
  const mine = itemsOfTask(items, taskId, kind);
  const want = idOrNull(value);
  const prev = idOrNull(previous);
  if (want == null) {
    if (prev == null) return none;
    return { remove: mine.filter((i) => String(i.entity_id) === prev), insert: null };
  }
  if (want === prev) return none;
  if (mine.some((i) => String(i.entity_id) === want)) return none;
  return {
    remove: [],
    insert: make({ task_id: taskId, entity_type: kind, entity_id: value, position: nextPosition(items, taskId, kind) })
  };
}
function seedItemsFor(task, items, make, fields = LINK_FIELDS) {
  if (!task || task.id == null) return [];
  const out = [];
  for (const f of fields) {
    const kind = FIELD_KIND[f];
    const v = task[f];
    if (!kind || v == null || v === "") continue;
    const has = (Array.isArray(items) ? items : []).some((i) => i && String(i.task_id) === String(task.id) && i.entity_type === kind && String(i.entity_id) === String(v));
    if (!has) out.push(make({ task_id: task.id, entity_type: kind, entity_id: v, position: 0 }));
  }
  return out;
}
var NAME_ORDER = new Intl.Collator(void 0, { numeric: true, sensitivity: "base" });
var MAX_ITEM_POSITION = 2147483647;
var isIdString = (v) => typeof v === "string" && v.trim() !== "";
function itemShapeProblem(row) {
  if (!row || typeof row !== "object") return "an item needs a task, a kind and an entity";
  if (row.task_id == null || row.task_id === "") return "an item needs its task";
  if (!isIdString(row.task_id)) return "an item's task is named by its id, as text";
  if (!isItemKind(row.entity_type)) return `${row.entity_type} is not a kind of item (asset, scene, shot, level, experience)`;
  if (row.entity_id == null || row.entity_id === "") return "an item needs the asset, scene, shot, level or experience it names";
  if (!isIdString(row.entity_id)) return "an item names its asset, scene, shot, level or experience by its id, as text";
  if (row.id != null && !isIdString(row.id)) return "an item's own id is text";
  const p = row.position == null ? 0 : Number(row.position);
  if (!Number.isInteger(p) || p < 0 || p > MAX_ITEM_POSITION) return "an item's position is a whole number from 0 to 2147483647";
  if (row.created_at != null && (typeof row.created_at !== "string" || Number.isNaN(Date.parse(row.created_at)))) {
    return "an item's created_at is a date";
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FIELD_KIND,
  ITEM_KINDS,
  KIND_FIELD,
  LINK_FIELDS,
  compareItems,
  copyFieldsFromItems,
  isItemKind,
  itemShapeProblem,
  itemsOfTask,
  nextPosition,
  planLegacyFieldWrite,
  seedItemsFor
});
