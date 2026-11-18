// GENERATED from src/tools/otter_v0.3.1/adapters/otterRoutes.js by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.
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

// electron/rules/otterMerges.cjs.entry.js
var otterMerges_cjs_entry_exports = {};
__export(otterMerges_cjs_entry_exports, {
  mergeFunctions: () => mergeFunctions,
  mergeHotkeys: () => mergeHotkeys
});
module.exports = __toCommonJS(otterMerges_cjs_entry_exports);

// src/tools/otter_v0.3.1/adapters/otterRoutes.js
var cleanName = (v) => typeof v === "string" ? v.replace(new RegExp("\\p{Cf}", "gu"), "").trim() : "";
var functionCategoryName = (cat) => cleanName(cat?.category) || cleanName(cat?.name) || "General";
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var categoryKey = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}#+]+/gu, " ").trim() || name.toLowerCase();
var functionKey = (fn) => cleanName(fn?.name);
var isCategory = (c) => isObj(c) && (c.functions === void 0 || Array.isArray(c.functions));
var isNamed = (c) => !!(cleanName(c.category) || cleanName(c.name));
function mergeFunctions(existing, incoming) {
  const doc = existing == null ? {} : existing;
  if (!isObj(doc) || doc.categories !== void 0 && !Array.isArray(doc.categories)) return existing;
  const out = { ...doc, categories: [...doc.categories || []] };
  const unfiled = /* @__PURE__ */ new Set();
  for (const c of out.categories) if (isCategory(c) && !isNamed(c)) {
    for (const f of c.functions || []) if (functionKey(f)) unfiled.add(functionKey(f));
  }
  for (const inCat of Array.isArray(incoming) ? incoming : []) {
    if (!isObj(inCat)) continue;
    const name = functionCategoryName(inCat);
    const i = out.categories.findIndex((c) => isCategory(c) && categoryKey(functionCategoryName(c)) === categoryKey(name));
    const into = i < 0 ? null : out.categories[i];
    const have = new Set((into ? into.functions || [] : []).map(functionKey).filter(Boolean));
    const add = [];
    for (const fn of Array.isArray(inCat.functions) ? inCat.functions : []) {
      if (!isObj(fn)) continue;
      const k = functionKey(fn);
      if (k && (have.has(k) || unfiled.has(k))) continue;
      if (k) {
        have.add(k);
        if (into && !isNamed(into)) unfiled.add(k);
      }
      add.push(fn);
    }
    const sentEmpty = !(Array.isArray(inCat.functions) && inCat.functions.length);
    if (i < 0) {
      if (add.length || sentEmpty) out.categories.push({ category: name, functions: add });
    } else if (add.length) out.categories[i] = { ...into, functions: [...into.functions || [], ...add] };
  }
  return out;
}
var hotkeyHeading = (c) => isObj(c) && Array.isArray(c.shortcuts) ? cleanName(c.category) : "";
var actionKey = (hk) => typeof hk.action === "string" ? hk.action.toLowerCase().trim() : "";
function mergeHotkeys(existing, incoming) {
  const doc = existing == null ? {} : existing;
  if (!isObj(doc) || doc.categories !== void 0 && !Array.isArray(doc.categories)) return existing;
  const out = { ...doc, categories: [...doc.categories || []] };
  for (const inCat of Array.isArray(incoming) ? incoming : []) {
    if (!isObj(inCat)) continue;
    const name = functionCategoryName(inCat);
    const key = categoryKey(name);
    const i = out.categories.findIndex((c) => {
      const h = hotkeyHeading(c);
      return !!h && categoryKey(h) === key;
    });
    const into = i < 0 ? null : out.categories[i];
    const have = new Set((into ? into.shortcuts : []).filter(isObj).map(actionKey));
    const list = Array.isArray(inCat.shortcuts) ? inCat.shortcuts : Array.isArray(inCat.hotkeys) ? inCat.hotkeys : [];
    const add = [];
    for (const hk of list) {
      if (!isObj(hk) || have.has(actionKey(hk))) continue;
      have.add(actionKey(hk));
      add.push(hk);
    }
    if (i < 0) {
      if (add.length || !list.length) out.categories.push({ category: name, shortcuts: add });
    } else if (add.length) out.categories[i] = { ...into, shortcuts: [...into.shortcuts, ...add] };
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mergeFunctions,
  mergeHotkeys
});
