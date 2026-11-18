// GENERATED from src/tools/rabbit_v0.1.0/state/tableViewsModel.js by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.
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

// electron/rules/tableViews.cjs.entry.js
var tableViews_cjs_entry_exports = {};
__export(tableViews_cjs_entry_exports, {
  ALL_VIEW_ID: () => ALL_VIEW_ID,
  GROUPINGS_PER_TABLE_MAX: () => GROUPINGS_PER_TABLE_MAX,
  GROUPING_IDS_MAX: () => GROUPING_IDS_MAX,
  GROUPING_KINDS: () => GROUPING_KINDS,
  MAX_VIEW_POSITION: () => MAX_VIEW_POSITION,
  TABLE_KEYS: () => TABLE_KEYS,
  TABLE_VIEW_LAST_MAX: () => TABLE_VIEW_LAST_MAX,
  VIEWS_PER_TABLE_MAX: () => VIEWS_PER_TABLE_MAX,
  VIEW_CONFIG_MAX_BYTES: () => VIEW_CONFIG_MAX_BYTES,
  VIEW_NAME_MAX: () => VIEW_NAME_MAX,
  canonicalJson: () => canonicalJson,
  compareGroupingRows: () => compareGroupingRows,
  compareViewRows: () => compareViewRows,
  compareViews: () => compareViews,
  configsEqual: () => configsEqual,
  findGroupingBySet: () => findGroupingBySet,
  groupingKeyOf: () => groupingKeyOf,
  groupingProblem: () => groupingProblem,
  isGroupingPair: () => isGroupingPair,
  isTableKey: () => isTableKey,
  isViewIdOrAll: () => isViewIdOrAll,
  jsonbText: () => jsonbText,
  mergeTableViewLast: () => mergeTableViewLast,
  nextViewPosition: () => nextViewPosition,
  normalizeEntityIds: () => normalizeEntityIds,
  normalizeViewName: () => normalizeViewName,
  planForgetItem: () => planForgetItem,
  planReorderViews: () => planReorderViews,
  tableViewLastKey: () => tableViewLastKey,
  tableViewLastKeyProblem: () => tableViewLastKeyProblem,
  utf8Length: () => utf8Length,
  viewConfigProblem: () => viewConfigProblem,
  viewNameProblem: () => viewNameProblem,
  viewsOfTable: () => viewsOfTable
});
module.exports = __toCommonJS(tableViews_cjs_entry_exports);

// src/tools/rabbit_v0.1.0/state/tableViewsModel.js
var TABLE_KEYS = Object.freeze(["tasks", "assets", "scenes", "shots", "levels", "experiences"]);
var GROUPING_KINDS = Object.freeze({
  tasks: Object.freeze(["asset", "scene", "shot", "level", "experience"]),
  assets: Object.freeze(["scene", "shot", "level", "experience"]),
  levels: Object.freeze(["asset"]),
  experiences: Object.freeze(["asset"])
});
var VIEW_NAME_MAX = 80;
var VIEW_CONFIG_MAX_BYTES = 32768;
var VIEWS_PER_TABLE_MAX = 200;
var GROUPINGS_PER_TABLE_MAX = 500;
var GROUPING_IDS_MAX = 100;
var TABLE_VIEW_LAST_MAX = 300;
var ALL_VIEW_ID = "all";
var LAYOUTS_BY_TABLE = Object.freeze({
  tasks: Object.freeze(["table", "board"]),
  assets: Object.freeze(["table", "gallery"]),
  scenes: Object.freeze(["table", "gallery"]),
  shots: Object.freeze(["table", "gallery"]),
  levels: Object.freeze(["table", "gallery"]),
  experiences: Object.freeze(["table", "gallery"])
});
var FILTER_VALUELESS_OPS = Object.freeze(["is_empty", "is_not_empty"]);
function isTableKey(key) {
  return typeof key === "string" && TABLE_KEYS.includes(key);
}
function isGroupingPair(tableKey, kind) {
  return Object.prototype.hasOwnProperty.call(GROUPING_KINDS, tableKey) && GROUPING_KINDS[tableKey].includes(kind);
}
var isPlainObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
function unstorableCharIn(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return true;
    if (c >= 55296 && c <= 56319) {
      const d = text.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) {
        i++;
        continue;
      }
      return true;
    }
    if (c >= 56320 && c <= 57343) return true;
  }
  return false;
}
function unstorableIn(value) {
  if (value !== null && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON();
  if (typeof value === "string") return unstorableCharIn(value);
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(unstorableIn);
  return Object.keys(value).some((k) => value[k] !== void 0 && typeof value[k] !== "function" && typeof value[k] !== "symbol" && (unstorableCharIn(k) || unstorableIn(value[k])));
}
function normalizeViewName(name) {
  return typeof name === "string" ? name.trim() : "";
}
function viewNameProblem(name) {
  if (typeof name !== "string") return "A view needs a name.";
  if (name !== name.trim()) return "A view's name cannot start or end with a space.";
  if (name.length === 0) return "A view needs a name.";
  if ([...name].length > VIEW_NAME_MAX) return `A view's name can be at most ${VIEW_NAME_MAX} characters.`;
  if (CONTROL.test(name)) return "A view's name cannot hold a line break or a tab.";
  if (unstorableCharIn(name)) return "A view's name holds a character that cannot be saved.";
  return null;
}
function utf8Length(text) {
  let n = 0;
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    n += c < 128 ? 1 : c < 2048 ? 2 : c < 65536 ? 3 : 4;
  }
  return n;
}
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isPlainObject(value)) {
    return "{" + Object.keys(value).sort().filter((k) => value[k] !== void 0).map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return value === void 0 ? "null" : JSON.stringify(value);
}
function configsEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}
function compareCodePoints(a, b) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}
function jsonbNumberText(n) {
  const s = JSON.stringify(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[2] + (m[3] || "");
  const point = m[2].length + Number(m[4]);
  const body = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return m[1] + body;
}
function jsonbText(value, seen = /* @__PURE__ */ new Set()) {
  if (value !== null && typeof value === "object" && typeof value.toJSON === "function") value = value.toJSON();
  if (value === null || value === void 0 || typeof value === "function" || typeof value === "symbol") return "null";
  if (typeof value === "bigint") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? jsonbNumberText(value) : "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (seen.has(value)) throw new TypeError("Converting circular structure to JSON");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) parts.push(jsonbText(value[i], seen));
      return "[" + parts.join(", ") + "]";
    }
    const keys = Object.keys(value).filter((k) => value[k] !== void 0 && typeof value[k] !== "function" && typeof value[k] !== "symbol").sort((a, b) => utf8Length(a) - utf8Length(b) || compareCodePoints(a, b));
    return "{" + keys.map((k) => JSON.stringify(k) + ": " + jsonbText(value[k], seen)).join(", ") + "}";
  } finally {
    seen.delete(value);
  }
}
function viewConfigProblem(config) {
  if (!isPlainObject(config)) return "A view's settings must be an object.";
  let text;
  try {
    text = jsonbText(config);
  } catch {
    return "A view's settings could not be read.";
  }
  if (unstorableIn(config)) return "A view's settings hold a character that cannot be saved.";
  if (utf8Length(text) > VIEW_CONFIG_MAX_BYTES) return "A view's settings can be at most 32 KB.";
  return null;
}
var KNOWN_CONFIG_KEYS = Object.freeze(["version", "layout", "filters", "sorts", "group", "board", "fields", "leading", "keyDates"]);
function timeOf(v) {
  if (v == null || v === "") return 0;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return 0;
  const m = /\.(\d{4,})/.exec(String(v));
  return m ? t + Number("0." + m[1].slice(3)) : t;
}
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0;
function compareViews(a, b) {
  const p = num(a?.position) - num(b?.position);
  if (p !== 0) return p;
  const t = timeOf(a?.created_at) - timeOf(b?.created_at);
  if (t !== 0) return t;
  const ia = String(a?.id ?? ""), ib = String(b?.id ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}
var byText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function compareViewRows(a, b) {
  return byText(String(a?.table_key ?? ""), String(b?.table_key ?? "")) || compareViews(a, b);
}
function compareGroupingRows(a, b) {
  return byText(String(a?.table_key ?? ""), String(b?.table_key ?? "")) || byText(String(a?.kind ?? ""), String(b?.kind ?? "")) || timeOf(a?.created_at) - timeOf(b?.created_at) || byText(String(a?.id ?? ""), String(b?.id ?? ""));
}
function viewsOfTable(views, tableKey) {
  return (Array.isArray(views) ? views : []).filter((v) => v && v.table_key === tableKey).sort(compareViews);
}
var MAX_VIEW_POSITION = 2147483647;
function nextViewPosition(views, tableKey) {
  let max = -1;
  for (const v of Array.isArray(views) ? views : []) {
    if (v && v.table_key === tableKey && num(v.position) > max) max = num(v.position);
  }
  return Math.min(max + 1, MAX_VIEW_POSITION);
}
function planReorderViews(views, tableKey, orderedIds) {
  if (!isTableKey(tableKey)) throw invalid(`${tableKey} is not a table with views`);
  const ids = Array.isArray(orderedIds) ? orderedIds : [];
  if (ids.some((id) => id == null || id === "")) throw invalid("a view id is empty");
  const named = ids.map(String);
  if (new Set(named).size !== named.length) throw invalid("a view is named twice");
  const rank = new Map(named.map((id, i) => [id, i]));
  const rows = viewsOfTable(views, tableKey);
  const ordered = rows.slice().sort((a, b) => {
    const ra = rank.has(String(a.id)) ? rank.get(String(a.id)) : Infinity;
    const rb = rank.has(String(b.id)) ? rank.get(String(b.id)) : Infinity;
    if (ra !== rb) return ra - rb;
    return compareViews(a, b);
  });
  const changes = [];
  ordered.forEach((v, i) => {
    if (num(v.position) !== i) changes.push({ id: v.id, position: i });
  });
  return changes;
}
function invalid(message) {
  const err = new Error(message);
  err.code = "table_view_invalid";
  return err;
}
function normalizeEntityIds(ids) {
  const out = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => id != null && id !== "").map(String))];
  return out.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}
function groupingKeyOf(ids) {
  return normalizeEntityIds(ids).join("|");
}
function groupingProblem(row) {
  if (!isPlainObject(row)) return "A grouping must be an object.";
  if (!isGroupingPair(row.table_key, row.kind)) {
    return `The ${row.table_key} table cannot be grouped by ${row.kind}.`;
  }
  const raw = Array.isArray(row.entity_ids) ? row.entity_ids : null;
  if (!raw || raw.length === 0) return "A grouping names at least one item.";
  if (raw.some((id) => id == null || id === "" || typeof id !== "string")) return "A grouping's items must each be an id.";
  if (normalizeEntityIds(raw).length > GROUPING_IDS_MAX) return `A grouping can name at most ${GROUPING_IDS_MAX} items.`;
  return null;
}
function findGroupingBySet(groupings, tableKey, kind, ids) {
  const key = groupingKeyOf(ids);
  return (Array.isArray(groupings) ? groupings : []).find((g) => g && g.table_key === tableKey && g.kind === kind && groupingKeyOf(g.entity_ids) === key) || null;
}
function planForgetItem(groupings, kind, entityId) {
  const id = String(entityId);
  const rows = (Array.isArray(groupings) ? groupings : []).filter((g) => g && g.kind === kind);
  const holding = rows.filter((g) => normalizeEntityIds(g.entity_ids).includes(id)).sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
  const remove = [];
  const update = [];
  for (const g of holding) {
    const rest = normalizeEntityIds(g.entity_ids).filter((x) => x !== id);
    const key = rest.join("|");
    const collides = rest.length > 0 && rows.some((o) => o !== g && o.table_key === g.table_key && !normalizeEntityIds(o.entity_ids).includes(id) && groupingKeyOf(o.entity_ids) === key);
    if (rest.length === 0 || collides) remove.push(g.id);
    else update.push({ id: g.id, entity_ids: rest });
  }
  return { remove, update };
}
var SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
function tableViewLastKey(projectId, tableKey) {
  return `${projectId}:${tableKey}`;
}
function tableViewLastKeyProblem(key) {
  if (typeof key !== "string") return "not a key";
  const at = key.lastIndexOf(":");
  if (at <= 0) return `${key} is not a project id and a table`;
  const project = key.slice(0, at), table = key.slice(at + 1);
  if (!SAFE_ID.test(project) || !isTableKey(table)) return `${key} is not a project id and a table`;
  return null;
}
function isViewIdOrAll(view) {
  return view === ALL_VIEW_ID || typeof view === "string" && SAFE_ID.test(view);
}
var atOf = (entry) => isPlainObject(entry) && typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : null;
function mergeTableViewLast(map, key, view, at) {
  const merged = { ...isPlainObject(map) ? map : {}, [key]: { view, at } };
  const entries = Object.entries(merged);
  if (entries.length <= TABLE_VIEW_LAST_MAX) return merged;
  entries.sort(([ka, va], [kb, vb]) => {
    const a = atOf(va), b = atOf(vb);
    if (a !== b) {
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    }
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return Object.fromEntries(entries.slice(0, TABLE_VIEW_LAST_MAX));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALL_VIEW_ID,
  GROUPINGS_PER_TABLE_MAX,
  GROUPING_IDS_MAX,
  GROUPING_KINDS,
  MAX_VIEW_POSITION,
  TABLE_KEYS,
  TABLE_VIEW_LAST_MAX,
  VIEWS_PER_TABLE_MAX,
  VIEW_CONFIG_MAX_BYTES,
  VIEW_NAME_MAX,
  canonicalJson,
  compareGroupingRows,
  compareViewRows,
  compareViews,
  configsEqual,
  findGroupingBySet,
  groupingKeyOf,
  groupingProblem,
  isGroupingPair,
  isTableKey,
  isViewIdOrAll,
  jsonbText,
  mergeTableViewLast,
  nextViewPosition,
  normalizeEntityIds,
  normalizeViewName,
  planForgetItem,
  planReorderViews,
  tableViewLastKey,
  tableViewLastKeyProblem,
  utf8Length,
  viewConfigProblem,
  viewNameProblem,
  viewsOfTable
});
