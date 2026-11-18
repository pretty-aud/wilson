/** @vitest-environment jsdom */
// =============================================================================
// codeHighlighter.test.jsx — F11 item 1 (the review's shared-client C2).
//
// The one highlighter carries the languages the app shows, and only those:
//   1. a code block in every registered language is still coloured (token
//      spans), and so is every alias a fence is likely to carry;
//   2. every language the Files preview names is registered (the course
//      languages are otterLanguage.test.js's section 2);
//   3. a language that is not registered draws as plain text, as an unknown
//      language always has, and does not throw;
//   4. nothing in src reaches the full build: no file imports the package's
//      index (which imports refractor/all) or refractor/all itself, and the
//      four places that draw code take this module.
// Failing controls, run before the commit: the scan in 4 is red on the tree
// before F11 (four files imported `{ Prism }` from the index); dropping `glsl`
// from the module turns 1 and 2 red.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import SyntaxHighlighter, { HIGHLIGHTED_LANGUAGES } from './codeHighlighter'
import { CODE_LANGUAGE } from './Resources/filePreview'

const SAMPLE = {
  arduino: 'void setup() { pinMode(13, OUTPUT); }',
  bash: 'echo "hi" # c',
  batch: '@echo off',
  c: 'int main() { return 0; }',
  cpp: 'class A { public: int b; };',
  csharp: 'public class A { string s = "x"; }',
  css: '.a { color: red; }',
  diff: '+ added line',
  gdscript: 'func _ready():\n\tvar s = "x"',
  glsl: 'uniform vec3 c;\nvoid main() { gl_FragColor = vec4(c, 1.0); }',
  go: 'func main() { s := "x" }',
  hlsl: 'float4 main(float4 p : POSITION) : SV_POSITION { return p; }',
  ini: '[section]\nkey=1',
  java: 'public class A { String s = "x"; }',
  javascript: 'const a = "s" // c',
  json: '{"a": 1, "b": [true, null]}',
  jsx: 'const e = <div className="a">{x}</div>',
  kotlin: 'fun main() { val s = "x" }',
  less: '@c: red;\n.a { color: @c; }',
  lua: 'local a = "s" -- c',
  makefile: 'all: build\n\techo done',
  markdown: '# Title\n*a* `b`',
  markup: '<div class="a">t</div>',
  mel: 'string $a = "s"; // c',
  objectivec: '@interface A : NSObject\n@end',
  perl: 'my $a = "s";',
  php: '<?php $a = "s"; ?>',
  powershell: '$a = Get-ChildItem # c',
  python: 'def f(x):\n    return "s"',
  r: 'f <- function(x) { "s" }',
  regex: '^a+(b|c)$',
  ruby: 'def f(x)\n  "s"\nend',
  rust: 'fn main() { let s = "x"; }',
  sass: '$c: red\n.a\n  color: $c',
  scss: '$c: red;\n.a { color: $c; }',
  sql: "SELECT a FROM t WHERE b = 's'",
  swift: 'let s = "x" // c',
  toml: '[a]\nb = "s"',
  tsx: 'const e: JSX.Element = <A b="c" />',
  typescript: 'interface A { b: string }',
  vbnet: 'Dim a As String = "s"',
  yaml: 'a: 1\nb: "s"',
}
// What a model's fence most often writes instead of the grammar's own name.
const ALIASES = {
  py: 'def f(): pass', js: 'const a = 1', ts: 'const a: number = 1', sh: 'echo "hi"',
  shell: 'echo "hi"', html: '<p class="a">b</p>', xml: '<a b="c"/>', svg: '<svg width="1"/>',
  cs: 'class A {}', yml: 'a: 1', rb: 'def f; end', kt: 'fun f() {}', md: '# T',
}

const draw = (language, code) => renderToStaticMarkup(
  <SyntaxHighlighter language={language} style={oneDark}>{code}</SyntaxHighlighter>,
)
const coloured = (markup) => markup.includes('class="token')

describe('1. every registered language, and the common aliases, are coloured', () => {
  it('each registered grammar has a sample, and each sample draws token spans', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...HIGHLIGHTED_LANGUAGES].sort())
    const plain = HIGHLIGHTED_LANGUAGES.filter((lang) => !coloured(draw(lang, SAMPLE[lang])))
    expect(plain).toEqual([])
  })
  it('a fence tagged with an alias is coloured too', () => {
    const plain = Object.entries(ALIASES).filter(([alias, code]) => !coloured(draw(alias, code))).map(([a]) => a)
    expect(plain).toEqual([])
  })
})

describe('2. the Files preview names only registered languages', () => {
  it('every CODE_LANGUAGE value is registered', () => {
    const missing = [...new Set(Object.values(CODE_LANGUAGE))].filter((lang) => !HIGHLIGHTED_LANGUAGES.includes(lang))
    expect(missing).toEqual([])
  })
})

describe('3. an unregistered language draws as plain text, as an unknown one always has', () => {
  it('abap and haskell (both in the full build, neither here) draw their text, uncoloured, without throwing', () => {
    for (const lang of ['abap', 'haskell', 'blueprint']) {
      const markup = draw(lang, 'main = putStrLn "x"')
      expect(coloured(markup), lang).toBe(false)
      expect(markup).toContain('main = putStrLn &quot;x&quot;')
      expect(markup).toContain(`class="language-${lang}"`)
    }
  })
})

describe('4. nothing in src reaches the full build', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const SRC = join(here, '..')
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : walk(p)
    return /\.(js|jsx|mjs)$/.test(name) && !/\.test\./.test(name) ? [p] : []
  })
  const files = walk(SRC)
  const rel = (p) => relative(SRC, p).replace(/\\/g, '/')
  const FULL = [
    /from\s+['"]react-syntax-highlighter['"]/,
    /['"]refractor\/all['"]/,
    /['"]react-syntax-highlighter\/dist\/(?:esm|cjs)\/(?:prism|prism-async|prism-async-light|light|light-async|default-highlight|index)(?:\.js)?['"]/,
  ]

  it('no file imports the package index, the full Prism or refractor/all', () => {
    const hits = files.filter((p) => FULL.some((re) => re.test(readFileSync(p, 'utf8')))).map(rel)
    expect(hits).toEqual([])
  })
  it('the four places that draw code take this module, and only this module registers languages', () => {
    const takers = files.filter((p) => /from\s+['"][./]+(?:components\/|\.\.\/)*codeHighlighter['"]/.test(readFileSync(p, 'utf8'))).map(rel).sort()
    expect(takers).toEqual([
      'components/PetCompanion.jsx',
      'components/Resources/FilePreviewDialog.jsx',
      'tools/otter_v0.3.1/FunctionCard.jsx',
      'tools/otter_v0.3.1/Otter.jsx',
    ])
    const registrars = files.filter((p) => /registerLanguage\(/.test(readFileSync(p, 'utf8'))).map(rel)
    expect(registrars).toEqual(['components/codeHighlighter.js'])
  })
  it('CONTROL: the scan sees the import the four files had before F11', () => {
    expect(FULL.some((re) => re.test("import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'"))).toBe(true)
    expect(FULL.some((re) => re.test("import SyntaxHighlighter from '../codeHighlighter'"))).toBe(false)
  })
})
