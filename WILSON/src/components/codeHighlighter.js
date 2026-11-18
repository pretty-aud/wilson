// =============================================================================
// codeHighlighter.js — F11 (the review's shared-client C2): the ONE code
// highlighter, with the languages the app shows and no others.
//
// The pet's answers (PetCompanion.jsx), the Files preview (Resources/
// FilePreviewDialog.jsx) and O.T.T.E.R.'s lessons, quiz wells and function
// library (Otter.jsx, FunctionCard.jsx) imported `Prism` from the package's
// index, which imports refractor/all: 297 grammars, 584,943 bytes of the main
// chunk at 81df858b, parsed at every launch. This is PrismLight (refractor's
// core) with the list below registered once, at load, before any of the four
// draws.
//
// The list is the union of what the app names: filePreview.js's CODE_LANGUAGE
// values and otterLanguage.js's course languages, plus the rest of refractor's
// own "common" set (arduino, diff, regex, makefile, markdown, objectivec, perl,
// sass), because the pet's and the lessons' fences are written by the model and
// carry any tag. A grammar registers what it extends itself (tsx brings jsx and
// typescript; cpp, glsl and hlsl bring c; php brings markup-templating; vbnet
// brings basic), and each brings its own aliases (js, ts, py, sh, shell, html,
// xml, svg, cs, yml, rb, kt, md, objc ...).
//
// A language not on the list draws exactly as an unknown language always has:
// refractor's highlight throws "Unknown language", the package's catch draws the
// code as one text node in the same <pre> and <code> with the same theme, no
// token colours (react-syntax-highlighter's highlight.js, getCodeTree). Adding a
// language is one import and one line here.
//
// Imported by deep path, never from the package index: the index re-exports
// prism.js, and prism.js imports refractor/all.
// =============================================================================

import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import arduino from 'react-syntax-highlighter/dist/esm/languages/prism/arduino'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import batch from 'react-syntax-highlighter/dist/esm/languages/prism/batch'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import gdscript from 'react-syntax-highlighter/dist/esm/languages/prism/gdscript'
import glsl from 'react-syntax-highlighter/dist/esm/languages/prism/glsl'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import hlsl from 'react-syntax-highlighter/dist/esm/languages/prism/hlsl'
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less'
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua'
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import mel from 'react-syntax-highlighter/dist/esm/languages/prism/mel'
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec'
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r'
import regex from 'react-syntax-highlighter/dist/esm/languages/prism/regex'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import sass from 'react-syntax-highlighter/dist/esm/languages/prism/sass'
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import vbnet from 'react-syntax-highlighter/dist/esm/languages/prism/vbnet'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'

const GRAMMARS = {
  arduino, bash, batch, c, cpp, csharp, css, diff, gdscript, glsl, go, hlsl, ini, java,
  javascript, json, jsx, kotlin, less, lua, makefile, markdown, markup, mel, objectivec, perl,
  php, powershell, python, r, regex, ruby, rust, sass, scss, sql, swift, toml, tsx, typescript,
  vbnet, yaml,
}

for (const [name, grammar] of Object.entries(GRAMMARS)) SyntaxHighlighter.registerLanguage(name, grammar)

/** The grammar names registered above (each also answers to its own aliases). */
export const HIGHLIGHTED_LANGUAGES = Object.freeze(Object.keys(GRAMMARS))

export default SyntaxHighlighter
