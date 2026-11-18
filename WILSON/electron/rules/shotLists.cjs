// GENERATED from src/tools/rabbit_v0.1.0/state/shotListModel.js by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.
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

// electron/rules/shotLists.cjs.entry.js
var shotLists_cjs_entry_exports = {};
__export(shotLists_cjs_entry_exports, {
  SHOT_LIST_BACKFILL_SUMMARY: () => SHOT_LIST_BACKFILL_SUMMARY,
  SHOT_LIST_BACKFILL_TITLE: () => SHOT_LIST_BACKFILL_TITLE,
  backfillItems: () => backfillItems,
  compareScenesForList: () => compareScenesForList,
  compareShotsForList: () => compareShotsForList
});
module.exports = __toCommonJS(shotLists_cjs_entry_exports);

// src/tools/rabbit_v0.1.0/state/shotListModel.js
var SHOT_LIST_BACKFILL_TITLE = "Shot list 1";
var SHOT_LIST_BACKFILL_SUMMARY = "Created from existing scenes";
function cmpNullsLast(a, b) {
  const an = a === null || a === void 0 || a === "";
  const bn = b === null || b === void 0 || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  const x = Number(a);
  const y = Number(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}
function cmpText(a, b) {
  const x = a == null ? "" : String(a);
  const y = b == null ? "" : String(b);
  if (x < y) return -1;
  if (x > y) return 1;
  return 0;
}
function compareScenesForList(a, b) {
  return cmpNullsLast(a?.scene_number, b?.scene_number) || cmpNullsLast(a?.sort_order, b?.sort_order) || cmpText(a?.created_at, b?.created_at) || cmpText(a?.id, b?.id);
}
function compareShotsForList(a, b) {
  return cmpNullsLast(a?.shot_number, b?.shot_number) || cmpNullsLast(a?.sort_order, b?.sort_order) || cmpText(a?.created_at, b?.created_at) || cmpText(a?.id, b?.id);
}
function backfillItems(scenes, shots) {
  const out = [];
  const orderedScenes = [...scenes || []].sort(compareScenesForList);
  orderedScenes.forEach((s, i) => out.push({ scene_id: s.id, shot_id: null, position: i }));
  const groups = /* @__PURE__ */ new Map();
  for (const sh of shots || []) {
    const key = sh.scene_id || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sh);
  }
  const sceneOrder = new Map(orderedScenes.map((s, i) => [s.id, i]));
  const rank = (k) => k === null ? Number.MAX_SAFE_INTEGER : sceneOrder.has(k) ? sceneOrder.get(k) : Number.MAX_SAFE_INTEGER - 1;
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || cmpText(a, b));
  for (const k of keys) {
    groups.get(k).sort(compareShotsForList).forEach((sh, i) => out.push({ scene_id: null, shot_id: sh.id, position: i }));
  }
  return out;
}
var SNAPSHOT_SCENE_FIELDS = Object.freeze([
  "id",
  "name",
  "scene_number",
  "description",
  "notes",
  "status",
  "type",
  "time_of_day",
  "thumbnail_image",
  "start_date",
  "end_date"
]);
var SNAPSHOT_SHOT_FIELDS = Object.freeze([
  "id",
  "scene_id",
  "name",
  "shot_number",
  "description",
  "notes",
  "status",
  "type",
  "time_of_day",
  "framing",
  "camera_movement",
  "frame_count",
  "thumbnail_image",
  "start_date",
  "end_date"
]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SHOT_LIST_BACKFILL_SUMMARY,
  SHOT_LIST_BACKFILL_TITLE,
  backfillItems,
  compareScenesForList,
  compareShotsForList
});
