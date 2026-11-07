// =============================================================================
// copyFileFence.cjs — the rabbit:copy-file IPC, a streamed copy for multi-GB
// files, and what it may read and write.
//
// 🚨 SECURITY BOUNDARY. The preload hands this channel to whatever script runs
// on WILSON's page, and it used to copy any path that script named to any folder
// that script named: the person's keys into a shared project folder, a program
// into their Startup folder. The failure direction stays CLOSED: when in doubt,
// refuse, and refuse before touching the disk.
//
//   The source is a file the person picked in this launch's OS dialog (the
//   userAuthorizedFiles list, the model the office-server routes follow), or a
//   project body in WILSON's own data: the projects folder and the local media
//   folder, never the data folder as a whole, because the Drive tokens and the
//   stored credentials sit at its top. An unpicked path gets the same sentence
//   whether it exists or not, so the refusal cannot be used to probe the disk.
//
//   The destination is inside the folder of the project the page names, from
//   main's own resolvers, by name (resolveContainedFilePath) and then by real
//   path (insideByRealPath), because a junction defeats the name check alone.
//   The file name is one plain name. No folder is made until both have passed.
//
// The two callers (FileManager's Add files and entityFiles' create forms) take
// their source from rabbit:pick-files and name the project the server answered
// on the record, so neither is refused. A refusal is a thrown sentence, which
// both already show the person.
//
// What this does not close: a page may still choose any path INSIDE the project's
// folder, and overwrite what is there, with a file the person picked. Naming the
// row rather than the path (the fix shape in code-review-2026-10-31, A1) would.
//
// Plain functions, no Electron: a test reaches every rule (main.cjs requires
// Electron at load and cannot be loaded by one).
// =============================================================================

'use strict';

const { resolveContainedFilePath, isPathInside, dataFilePath } = require('./pathContainment.cjs');
const { insideByRealPath } = require('./localMedia.cjs');

const NOT_PICKED = 'WILSON copies only a file you picked. Pick the file again, then try once more.';
const NOT_THE_PROJECT = "WILSON copies files only into this project's own folder.";

/** The roots' answer, or none: a resolver that throws closes the fence. */
function rootsOf(ask, ...args) {
  try { return (ask(...args) || []).filter(Boolean); } catch { return []; }
}

function sourceAllowed(sourcePath, { isPicked, ownDataRoots }) {
  if (typeof sourcePath !== 'string' || !sourcePath || sourcePath.includes('\0')) return false;
  if (isPicked(sourcePath)) return true;
  return rootsOf(ownDataRoots).some((root) => isPathInside(root, sourcePath) && insideByRealPath(root, sourcePath));
}

/**
 * Where the copy lands, or null. Makes the folders it needs only after the name
 * check and the real-path check of what already exists have passed, then asks
 * the real path again of the folder it made.
 */
function destinationAllowed({ projectId, destDir, destFileName }, { fs, projectRoots }) {
  if (typeof projectId !== 'string' || !projectId) return null;
  if (typeof destDir !== 'string' || !destDir || typeof destFileName !== 'string') return null;
  for (const root of rootsOf(projectRoots, projectId)) {
    const dir = resolveContainedFilePath(root, destDir);
    const finalPath = dir && dataFilePath(dir, destFileName);
    if (!finalPath) continue;
    // A project folder not there yet is made first: nothing has a real path to
    // compare with until it exists, and it is main's own answer, not the page's.
    fs.mkdirSync(root, { recursive: true });
    if (!insideByRealPath(root, dir)) continue;
    fs.mkdirSync(dir, { recursive: true });
    if (!insideByRealPath(root, finalPath)) continue;
    // insideByRealPath walks up past a link leading nowhere; the write would follow it.
    if (fs.lstatSync(finalPath, { throwIfNoEntry: false })?.isSymbolicLink()) continue;
    return finalPath;
  }
  return null;
}

/**
 * The handler main.cjs registers on rabbit:copy-file.
 * @param {object} deps
 * @param {object} deps.fs
 * @param {(sourcePath: string) => boolean} deps.isPicked  in this launch's picked list
 * @param {() => string[]} deps.ownDataRoots               the folders of WILSON's own data a copy may read
 * @param {(projectId: string) => string[]} deps.projectRoots  the project's folders; none for an unknown project
 * @returns {(event: object, opts: object) => Promise<{ ok: true, finalPath: string, bytesWritten: number }>}
 */
function createCopyFile({ fs, isPicked, ownDataRoots, projectRoots }) {
  return async (event, opts) => {
    const { sourcePath, destDir, destFileName, projectId } = opts || {};
    if (!sourceAllowed(sourcePath, { isPicked, ownDataRoots })) throw new Error(NOT_PICKED);
    if (!fs.existsSync(sourcePath)) throw new Error('source file does not exist');

    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error('that is not a file');
    const totalBytes = stat.size;

    const finalPath = destinationAllowed({ projectId, destDir, destFileName }, { fs, projectRoots });
    if (!finalPath) throw new Error(NOT_THE_PROJECT);

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

/**
 * main's answer to "which folders are this project's": the one its files resolve
 * under, and the stored folder_root where the person could have chosen it even
 * while it is missing from disk (a deleted project folder is made again by the
 * copy, as it always was; resolveProjectFolderRoot skips a root that is not there).
 */
function makeProjectCopyRoots({ readRabbitBundle, resolveProjectFolderRoot, storedRootUsable }) {
  return (projectId) => {
    const bundle = readRabbitBundle(projectId);
    if (!bundle) return [];
    const stored = bundle.project?.folder_root;
    return [stored && storedRootUsable(stored) ? stored : null, resolveProjectFolderRoot(bundle)].filter(Boolean);
  };
}

module.exports = { createCopyFile, makeProjectCopyRoots };
