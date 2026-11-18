// =============================================================================
// build-electron-rules.mjs — the desktop's CommonJS copies of the renderer's
// rules, GENERATED from the ES modules that state them (F9; the
// desktop-build review's B1).
//
// A synchronous Local Server route cannot import an ES module, so the rules
// were kept a second time by hand in CommonJS (rabbitTaskItems.cjs,
// rabbitTableViews.cjs, rabbitShotLists.cjs, main.cjs's two O.T.T.E.R.
// merges, rabbitBins.cjs's media tables) and eight parity tests held each
// pair together. Now each copy is esbuild's bundle of the module itself
// (`--bundle --format=cjs`, platform node), written into electron/rules/,
// which electron-builder packs with the rest of electron/ ("files":
// "electron/**/*"); the .cjs files require it in place of their copied rules.
//
// The files are COMMITTED, so a fresh checkout, `npm run electron:dev`, CI and
// a packaged build need no step of their own. src/lib/electronRules.test.js
// regenerates them in memory and compares them with the committed text, so a
// rule changed in a module and not regenerated fails `npm test` — the one
// check in place of the parity tests. After changing a rule module:
//
//     npm run build:rules
//
// Each entry re-exports only the names the desktop uses, so tree shaking
// drops the rest (the modules' screen helpers, fetch helpers and imports).
// The output is deterministic: paths in esbuild's comments are relative to
// the repository root, `\n` line endings, ASCII strings.
// =============================================================================

import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const RULES_DIR = 'electron/rules'

export const RULES = [
  {
    file: 'taskItems.cjs',
    from: 'src/tools/rabbit_v0.1.0/state/taskItemsModel.js',
    names: ['ITEM_KINDS', 'KIND_FIELD', 'LINK_FIELDS', 'FIELD_KIND', 'isItemKind', 'compareItems', 'itemsOfTask',
      'copyFieldsFromItems', 'nextPosition', 'planLegacyFieldWrite', 'seedItemsFor', 'itemShapeProblem'],
  },
  {
    file: 'tableViews.cjs',
    from: 'src/tools/rabbit_v0.1.0/state/tableViewsModel.js',
    names: ['TABLE_KEYS', 'GROUPING_KINDS', 'VIEW_NAME_MAX', 'VIEW_CONFIG_MAX_BYTES', 'VIEWS_PER_TABLE_MAX',
      'GROUPINGS_PER_TABLE_MAX', 'GROUPING_IDS_MAX', 'TABLE_VIEW_LAST_MAX', 'ALL_VIEW_ID', 'MAX_VIEW_POSITION',
      'isTableKey', 'isGroupingPair', 'normalizeViewName', 'viewNameProblem', 'utf8Length', 'canonicalJson',
      'configsEqual', 'jsonbText', 'viewConfigProblem', 'compareViews', 'compareViewRows', 'compareGroupingRows',
      'viewsOfTable', 'nextViewPosition', 'planReorderViews', 'normalizeEntityIds', 'groupingKeyOf', 'groupingProblem',
      'findGroupingBySet', 'planForgetItem', 'tableViewLastKey', 'tableViewLastKeyProblem', 'isViewIdOrAll',
      'mergeTableViewLast'],
  },
  {
    file: 'shotLists.cjs',
    from: 'src/tools/rabbit_v0.1.0/state/shotListModel.js',
    names: ['SHOT_LIST_BACKFILL_TITLE', 'SHOT_LIST_BACKFILL_SUMMARY', 'compareScenesForList', 'compareShotsForList', 'backfillItems'],
  },
  {
    file: 'otterMerges.cjs',
    from: 'src/tools/otter_v0.3.1/adapters/otterRoutes.js',
    names: ['mergeFunctions', 'mergeHotkeys'],
  },
  {
    file: 'binMedia.cjs',
    from: 'src/tools/rabbit_v0.1.0/bins/binMedia.js',
    names: ['VIDEO_EXTS', 'STILL_EXTS', 'AUDIO_EXTS', 'GRAPHIC_EXTS', 'VFX_EXTS', 'DOC_EXTS', 'BROWSER_VIDEO_EXTS',
      'MEDIA_TYPES', 'REVIEW_FLAGS', 'COLORS', 'BIN_KINDS', 'guessMediaType'],
  },
]

/** Every generated file's text, built in memory: `{ 'taskItems.cjs': '…' }`. */
export async function buildRules({ plugins = [] } = {}) {
  const out = {}
  for (const rule of RULES) {
    const result = await build({
      stdin: {
        contents: `export { ${rule.names.join(', ')} } from './${rule.from}'\n`,
        resolveDir: ROOT,
        sourcefile: `${RULES_DIR}/${rule.file}.entry.js`,
        loader: 'js',
      },
      absWorkingDir: ROOT,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      treeShaking: true,
      legalComments: 'none',
      charset: 'ascii',
      minify: false,
      sourcemap: false,
      write: false,
      logLevel: 'silent',
      plugins,
      banner: { js: `// GENERATED from ${rule.from} by scripts/build-electron-rules.mjs. Do not edit: change the module, then npm run build:rules.` },
    })
    out[rule.file] = result.outputFiles[0].text
  }
  return out
}

const runAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (runAsScript) {
  const built = await buildRules()
  mkdirSync(path.join(ROOT, RULES_DIR), { recursive: true })
  for (const [file, text] of Object.entries(built)) writeFileSync(path.join(ROOT, RULES_DIR, file), text)
  console.log(`wrote ${Object.keys(built).length} files to ${RULES_DIR}/`)
}
