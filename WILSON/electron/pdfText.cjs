// =============================================================================
// electron/pdfText.cjs — the desktop's PDF text reader, POST /api/extract-pdf
//
// Mounted by main.cjs inside startLocalServer, behind the loopback token and
// main.cjs's global express.json({ limit: '50mb' }), which this body rides:
// JSON { name, dataUrl }, the PDF as a base64 data URL (OUTSTANDING F12-19).
// The answer is { name, text, numPages }. Moved out of main.cjs by F13
// (2026-11-19) so its test mounts the real route
// (src/components/RateCard/importers/pdfText.test.js), as projectFileStream.cjs
// is mounted by main.cjs and served in its test.
//
// Two callers, both behind hasLocalServer() (in the browser nothing reads a
// PDF's text, by Session 12's choice): RABBIT intake (intake/pipeline.js,
// extractTextFromFile), which sends the text to the AI, and the rate card's
// PDF importer, RateCard/importers/pdfImporter.js, which scans its lines for
// rate rows. Both want the words alone.
//
// 🚨 pdf-parse 2.x is not the 1.x function this route was first written for
// (OUTSTANDING F12-02): its export is an object, and the old
// `require('pdf-parse')(buffer)` threw "pdfParse is not a function" on every
// call from 2026-04-06 to F13. The reader is the class PDFParse, destroyed in a
// finally.
//
// 🚨 Its text writes a marker line after every page unless told otherwise
// ("-- 1 of 2 --", its option pageJoiner). The text here is the pages' own
// text, in page order, a blank line between pages, and nothing else — measured
// on 2.4.5: an empty pageJoiner gives the same words with two more line ends
// at the end, so the pages are joined here rather than trusting the option.
//
// 🚨 Required inside the handler, never at the top, so the desktop's startup
// pays nothing for it: its first load took up to 3.5 s on her PC (Node 20,
// cold), and it opens the native canvas binary (@napi-rs/canvas) as it loads.
// MEASURED: that binary is not optional for text. The package makes a
// DOMMatrix at its top, which plain Node lacks and the binary supplies;
// without it the require itself throws "DOMMatrix is not defined".
//
// MEASURED by F13 (2026-11-19) in Electron 33.4.11's own Node (20.18.3;
// ELECTRON_RUN_AS_NODE on the worktree's own binary, a script that never
// requires main.cjs), from the source and from the packaged build's app.asar
// (`npm run package`, never started): both read the test PDFs. electron-builder
// packs pdf-parse inside app.asar, its worker (pdf.worker.mjs, an ES module the
// package import()s) with it, and the canvas's Windows binary beside it in
// app.asar.unpacked, nested under @napi-rs/canvas; the binary was opened from
// there. A read loads nothing of pdfjs-dist (traced). Not proved by any run:
// the same inside the running app's main process.
//
// A body that is not a PDF (an empty one too), and a PDF locked with a
// password, are the request's own fault: 422 with plain words, which the
// importer shows. Anything else is 500 with the package's words, logged.
// =============================================================================
'use strict';

const NOT_A_PDF = 'This file is not a PDF, or it is damaged.';
const LOCKED = 'This PDF is locked with a password. Save a copy without the password and try again.';

// The words of a PDF, page by page. Loads the package on its first call.
async function readPdfText(bytes) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return {
      text: result.pages.map((page) => page.text).join('\n\n'),
      numPages: result.total,
    };
  } finally {
    await parser.destroy();
  }
}

// The words for a PDF the request itself got wrong, or null.
function refusalOf(err) {
  if (err && err.name === 'InvalidPDFException') return NOT_A_PDF;
  if (err && err.name === 'PasswordException') return LOCKED;
  return null;
}

function mountPdfText(expressApp, { log = console.error } = {}) {
  expressApp.post('/api/extract-pdf', async (req, res) => {
    try {
      const { dataUrl, name } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        return res.status(400).json({ error: 'dataUrl is required' });
      }
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      const { text, numPages } = await readPdfText(Buffer.from(base64, 'base64'));
      res.json({ name: name || null, text, numPages });
    } catch (err) {
      const refusal = refusalOf(err);
      if (refusal) return res.status(422).json({ error: refusal });
      log('[RABBIT] /api/extract-pdf failed:', err);
      res.status(500).json({ error: (err && err.message) || 'extract-pdf failed' });
    }
  });
}

module.exports = { mountPdfText, readPdfText, refusalOf, NOT_A_PDF, LOCKED };
