// =============================================================================
// rewritePrompts.js — what D.O.G.'s AI rewrite sends (F6, A5).
//
// The rewrite (the context menu's Extend, Shorten, … on a selection) and its
// Regenerate button built the same request twice, about 60 identical lines in
// handleRewriteRequest and handleRewriteRedo, and "the deck context plus the
// first two text uploads" was written out three times (twice there, once in
// the theme generator). Both now come from here, so the two buttons cannot
// drift apart. The model is resolved at each call site (`modelFor('dog.rewrite')`
// and `modelFor('dog.rewriteRedo')`), where noHardcodedModels.test.js and the
// model registry can see the literal keys.
//
// A file of its own: prompts/ holds one file per kind of request and had none
// for the rewrite, and DeckOutlineGenerator.jsx cannot be imported by a node
// test without mounting it.
// =============================================================================

/**
 * The deck's context and its first two text uploads, cut to length:
 * { context, excerpts } (excerpts joined by newlines, '' when there are none).
 */
export function deckExcerpt(deckPrompt, uploads, contextChars, uploadChars) {
  return {
    context: (deckPrompt || '').substring(0, contextChars),
    excerpts: uploads
      .filter(f => f.type === 'text')
      .slice(0, 2)
      .map(f => f.content.substring(0, uploadChars))
      .join('\n'),
  };
}

/**
 * The request body for rewriting a selection.
 *
 * @param {{ text: string, start: number, end: number, content: string }} selection
 *        the selected text, where it starts and ends, and the whole tab's text
 * @param {string} mode  a key of the rewrite prompts ('extend', 'shorten', …)
 * @param {{ deckPrompt: string, uploads: object[], system: string, model: string }} ctx
 * @returns {{ model, max_tokens, system, messages, tool }}
 */
export function rewriteRequest({ text, start, end, content }, mode, { deckPrompt, uploads, system, model }) {
  const { context: deckContext, excerpts: docSnippets } = deckExcerpt(deckPrompt, uploads, 600, 400);

  // Count lines in the selected text for strict enforcement
  const selLines = text.split('\n');
  const lineCount = selLines.length;
  const nonEmptyLineCount = selLines.filter(l => l.trim()).length;

  // Surrounding context (before and after the selection), so the AI understands the formatting
  const beforeSel = content.substring(Math.max(0, start - 200), start);
  const afterSel = content.substring(end, Math.min(content.length, end + 200));

  // Detect formatting patterns in the selected text
  const hasBold = /\*\*[^*]+\*\*/.test(text);
  const hasBullets = /^[\s]*[-•*▸▹►]\s/m.test(text);
  const hasNumbered = /^[\s]*\d+\.\s/m.test(text);
  const hasMultiLine = lineCount > 1;
  const hasHeaders = /\*\*[^*]+\*\*\s*\n/.test(text);

  let formatHint = `\n\nSTRICT LINE COUNT: The input has exactly ${nonEmptyLineCount} non-empty line(s). Your output MUST have exactly ${nonEmptyLineCount} non-empty line(s). Do NOT add extra lines, blank lines, or remove lines.`;
  if (mode === 'extend') {
    formatHint += ' Expand the text WITHIN each existing line — make each line longer and more detailed. Do NOT add new lines or bullet points.';
  } else if (mode === 'shorten') {
    formatHint += ' Condense the text WITHIN each existing line — make each line shorter. Do NOT remove lines.';
  }
  if (hasBold || hasBullets || hasNumbered || hasMultiLine || hasHeaders) {
    formatHint += '\nFORMATTING DETECTED:';
    if (hasBullets) formatHint += ` Bullet points (${nonEmptyLineCount} bullets) — output exactly ${nonEmptyLineCount} bullets, same style.`;
    if (hasBold) formatHint += ' **Bold** markers — keep ** around equivalent words.';
    if (hasNumbered) formatHint += ' Numbered list — keep same numbering style.';
    if (hasHeaders) formatHint += ' Bold section headers — keep exactly as-is.';
  }

  let userContent = `Selected text to rewrite:\n"""${text}"""${formatHint}`;

  // Add surrounding context so the AI understands the formatting environment
  if (beforeSel.trim() || afterSel.trim()) {
    userContent += `\n\nSurrounding markdown context (for formatting reference only, do NOT rewrite this):\nBEFORE: """${beforeSel.trim().slice(-100)}"""\nAFTER: """${afterSel.trim().slice(0, 100)}"""`;
  }

  if (mode === 'extend' && (deckContext || docSnippets)) {
    userContent += `\n\nDeck context: ${deckContext || 'None'}`;
    if (docSnippets) userContent += `\n\nSource document excerpts:\n${docSnippets}`;
  }

  return {
    model,
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: userContent }],
    tool: 'dog',
  };
}
