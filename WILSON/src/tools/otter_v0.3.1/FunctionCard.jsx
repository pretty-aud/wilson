import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { LESSON_CODE_THEME, WELL_CODE_TEXT } from './otterLanguage.js';

// ═══════════════════════════════════════════════════════════════════
//  ONE FUNCTION, ONE CARD (post-overhaul S2b, C9). The Functions reference
//  and the Search dialog's function results drew the same card from two
//  copies of the same JSX; this is the one card both render.
//
//  The two code wells — the signature and the example — colour their TEXT
//  as the lessons colour a fence (LESSON_CODE_THEME, oneDark: strings,
//  keywords, functions and numbers each in their own ink), when the course's
//  language is known (otterLanguage.js). The well itself is the stylesheet's
//  `.otter-code-well`, unchanged: its ground, its padding and its wrapping.
//  The highlighter would draw a second box of its own as an inline style on
//  its <pre>, so WellPre takes the <pre> over and passes none of that on;
//  only the token colours, which the highlighter writes on each <span>,
//  reach the page. An unknown language draws the well exactly as before.
//  The name, the parameters, the return value and the description are prose
//  and keep their inks.
// ═══════════════════════════════════════════════════════════════════

/** The highlighter's <pre>: the stylesheet's well, and nothing else. */
function WellPre({ children, 'data-language': language }) {
  return <pre className="otter-code-well" data-language={language}>{children}</pre>;
}

export function CodeWell({ code, language }) {
  const text = String(code);
  if (!language) return <pre className="otter-code-well">{text}</pre>;
  return (
    <SyntaxHighlighter
      language={language}
      style={LESSON_CODE_THEME}
      PreTag={WellPre}
      data-language={language}
      codeTagProps={{ className: `language-${language}`, style: WELL_CODE_TEXT }}
    >{text}</SyntaxHighlighter>
  );
}

export default function FunctionCard({ fn, language }) {
  return (
    <div className="otter-fn-card">
      <code className="otter-fn-name">{fn.name}</code>
      {fn.syntax && <CodeWell code={fn.syntax} language={language} />}
      {fn.parameters && <div className="otter-fn-part"><span className="otter-fn-label">Parameters:</span><span className="otter-fn-text">{fn.parameters}</span></div>}
      {fn.returns && <div className="otter-fn-part"><span className="otter-fn-label">Returns: </span><span className="otter-fn-text">{fn.returns}</span></div>}
      {fn.description && <p className="otter-fn-desc">{fn.description}</p>}
      {fn.example && <CodeWell code={fn.example} language={language} />}
    </div>
  );
}
