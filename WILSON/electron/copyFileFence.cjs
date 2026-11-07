// =============================================================================
// copyFileFence.cjs — the rabbit:copy-file IPC, a streamed copy for multi-GB
// files.
//
// Plain functions, no Electron: a test reaches every rule (main.cjs requires
// Electron at load and cannot be loaded by one).
// =============================================================================

'use strict';

const path = require('path');

/**
 * The handler main.cjs registers on rabbit:copy-file.
 * @param {object} deps
 * @param {object} deps.fs
 * @returns {(event: object, opts: object) => Promise<{ ok: true, finalPath: string, bytesWritten: number }>}
 */
function createCopyFile({ fs }) {
  return async (event, { sourcePath, destDir, destFileName }) => {
    if (!fs.existsSync(sourcePath)) throw new Error('source file does not exist');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const finalPath = path.join(destDir, destFileName);

    const stat = fs.statSync(sourcePath);
    const totalBytes = stat.size;

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(sourcePath);
      const writeStream = fs.createWriteStream(finalPath);
      let bytesCopied = 0;
      let lastProgressPct = 0;

      readStream.on('data', (chunk) => {
        bytesCopied += chunk.length;
        const pct = Math.round((bytesCopied / totalBytes) * 100);
        // Only send progress at each 1% increment to avoid flooding IPC
        if (pct > lastProgressPct) {
          lastProgressPct = pct;
          try {
            event.sender.send('rabbit:copy-progress', {
              fileName: destFileName,
              bytesCopied,
              totalBytes,
              percent: pct,
            });
          } catch { /* window may be closed */ }
        }
      });

      readStream.on('error', (err) => {
        writeStream.destroy();
        reject(err);
      });

      writeStream.on('error', (err) => {
        readStream.destroy();
        reject(err);
      });

      writeStream.on('finish', () => {
        resolve({ ok: true, finalPath, bytesWritten: bytesCopied });
      });

      readStream.pipe(writeStream);
    });
  };
}

module.exports = { createCopyFile };
