// GENERATED from src/tools/rabbit_v0.1.0/bins/binMedia.js by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.
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

// electron/rules/binMedia.cjs.entry.js
var binMedia_cjs_entry_exports = {};
__export(binMedia_cjs_entry_exports, {
  AUDIO_EXTS: () => AUDIO_EXTS,
  BIN_KINDS: () => BIN_KINDS,
  BROWSER_VIDEO_EXTS: () => BROWSER_VIDEO_EXTS,
  COLORS: () => COLORS,
  DOC_EXTS: () => DOC_EXTS,
  GRAPHIC_EXTS: () => GRAPHIC_EXTS,
  MEDIA_TYPES: () => MEDIA_TYPES,
  REVIEW_FLAGS: () => REVIEW_FLAGS,
  STILL_EXTS: () => STILL_EXTS,
  VFX_EXTS: () => VFX_EXTS,
  VIDEO_EXTS: () => VIDEO_EXTS,
  guessMediaType: () => guessMediaType
});
module.exports = __toCommonJS(binMedia_cjs_entry_exports);

// src/tools/rabbit_v0.1.0/bins/binMedia.js
var VIDEO_EXTS = /* @__PURE__ */ new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".wmv",
  ".flv",
  ".mpg",
  ".mpeg",
  ".m2v",
  ".mts",
  ".m2ts",
  ".mxf",
  ".r3d",
  ".ari",
  ".arri",
  ".braw",
  ".dnx",
  ".dnxhd",
  ".dnxhr"
]);
var STILL_EXTS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".tiff",
  ".tif",
  ".bmp",
  ".avif",
  ".heic",
  ".heif"
]);
var AUDIO_EXTS = /* @__PURE__ */ new Set([".wav", ".bwf", ".aif", ".aiff", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".wma"]);
var GRAPHIC_EXTS = /* @__PURE__ */ new Set([".psd", ".psb", ".ai", ".svg", ".eps", ".indd", ".afdesign", ".sketch", ".fig"]);
var VFX_EXTS = /* @__PURE__ */ new Set([".exr", ".dpx", ".tga", ".hdr", ".cin"]);
var DOC_EXTS = /* @__PURE__ */ new Set([".pdf", ".txt", ".md", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".rtf", ".pages", ".numbers"]);
var BROWSER_VIDEO_EXTS = /* @__PURE__ */ new Set([".mp4", ".m4v", ".webm"]);
var MEDIA_TYPES = ["video", "still", "sequence", "audio", "graphic", "vfx", "document", "other"];
var REVIEW_FLAGS = ["unflagged", "select", "reject"];
var COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];
var BIN_KINDS = ["footage", "audio", "stills", "graphics", "vfx", "selects", "other"];
function guessMediaType(ext) {
  const e = String(ext || "").toLowerCase();
  if (VIDEO_EXTS.has(e)) return "video";
  if (STILL_EXTS.has(e)) return "still";
  if (AUDIO_EXTS.has(e)) return "audio";
  if (VFX_EXTS.has(e)) return "vfx";
  if (GRAPHIC_EXTS.has(e)) return "graphic";
  if (DOC_EXTS.has(e)) return "document";
  return "other";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AUDIO_EXTS,
  BIN_KINDS,
  BROWSER_VIDEO_EXTS,
  COLORS,
  DOC_EXTS,
  GRAPHIC_EXTS,
  MEDIA_TYPES,
  REVIEW_FLAGS,
  STILL_EXTS,
  VFX_EXTS,
  VIDEO_EXTS,
  guessMediaType
});
