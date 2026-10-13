// =============================================================================
// storageRoot.js — Session 34: classify and canonicalise a storage-root path.
//
// The workspace storage root (workspace_storage.root_path) is the one string
// every computer in a company resolves files under, so the string itself has
// to be machine-independent. NETWORK_STORAGE_DESIGN.md §3.3 measured why that
// is not automatic: \\FILESERVER\Projects, \\fileserver.corp.local\Projects,
// \\192.168.1.5\Projects and Z:\Projects are four spellings of one folder,
// and only case folds under normalisation. Moving the root into the database
// SPREADS a per-machine spelling instead of fixing it — so the UI refuses the
// shapes that cannot travel (mapped drive letters) or that hand WILSON an
// entire disk (bare roots), and canonicalises the rest.
//
// String-level only, deliberately. Whether a drive letter is a NETWORK
// MAPPING is not decidable from the string — the Electron reachability probe
// (rabbit:probe-storage-root) answers that with `net use`, and the web admin
// terminal, which cannot ask, warns instead. This module is the UX courtesy;
// the enforcement is RLS (0048) plus the canonical-form CHECK on root_path.
//
// Pure functions, no imports — vitest covers the shapes in storageRoot.test.js.
// =============================================================================

// Trim, unify separators to backslash, collapse duplicate separators (except
// the UNC lead-in), and strip trailing separators. Returns the canonical
// string, or '' for input that has no path in it at all.
export function canonicalizeRoot(raw) {
  if (typeof raw !== 'string') return ''
  let p = raw.trim().replace(/\//g, '\\')
  if (!p) return ''
  const isUnc = /^\\{2}/.test(p)
  // Collapse every run of backslashes to one, then restore the UNC lead-in.
  p = p.replace(/\\+/g, '\\')
  if (isUnc) p = '\\' + p
  // Strip trailing separators — path.resolve() gives a bare root a trailing
  // separator and every deeper path none (§3.2), and the pre-S33 containment
  // guard refused every file under a root stored with one. The database
  // CHECK (workspace_storage_root_canon_chk) enforces the same rule.
  //
  // A bare drive root ('C:\') keeps its one separator: 'C:' alone is
  // drive-RELATIVE on Windows and would classify as invalid below.
  while (p.length > 1 && /[\\]$/.test(p) && !/^[A-Za-z]:\\$/.test(p)) {
    p = p.slice(0, -1)
  }
  return p
}

// Classify a CANONICALISED root path.
//   kind:     'unc' | 'local' | 'invalid'
//   bareRoot: true for \\server\share or C:\ — the whole share / whole disk,
//             refused as a root (containment under C:\ contains the drive).
//   driveLetter: 'C' for local drive-letter paths, so the caller knows to ask
//             the probe whether that letter is a network mapping (mapped
//             drives are refused — Z: names a different folder per machine).
//   reason:  a sentence for the person, null when the shape is usable.
export function classifyRoot(canonical) {
  const p = typeof canonical === 'string' ? canonical : ''
  if (!p) {
    return { kind: 'invalid', bareRoot: false, driveLetter: null, reason: 'Enter a folder path.' }
  }
  // Dot segments would let '\\srv\share\x\..' defeat the bare-root refusal
  // after resolution, and the \\?\ / \\.\ device namespace bypasses Win32
  // path normalisation entirely (S34 review). Neither is a path a person
  // types for a storage root; refuse rather than resolve.
  if (/^\\{2}[?.](\\|$)/.test(p)) {
    return {
      kind: 'invalid', bareRoot: false, driveLetter: null,
      reason: 'Device-namespace paths (\\\\?\\, \\\\.\\) cannot be a storage root.',
    }
  }
  if (p.split('\\').some(seg => seg === '.' || seg === '..')) {
    return {
      kind: 'invalid', bareRoot: false, driveLetter: null,
      reason: 'Dot segments (. or ..) are not allowed in a storage root — enter the folder\u2019s full path.',
    }
  }
  if (/^\\{2}/.test(p)) {
    const parts = p.slice(2).split('\\').filter(Boolean)
    if (parts.length < 2) {
      return {
        kind: 'invalid', bareRoot: false, driveLetter: null,
        reason: 'A network path needs at least \\\\server\\share.',
      }
    }
    if (parts.length === 2) {
      return {
        kind: 'unc', bareRoot: true, driveLetter: null,
        reason: 'That is the whole share. Pick a folder inside it — for example \\\\'
          + parts.join('\\') + '\\Projects.',
      }
    }
    return { kind: 'unc', bareRoot: false, driveLetter: null, reason: null }
  }
  const drive = /^([A-Za-z]):\\(.*)$/.exec(p)
  if (drive) {
    if (!drive[2]) {
      return {
        kind: 'local', bareRoot: true, driveLetter: drive[1].toUpperCase(),
        reason: `That is the whole ${drive[1].toUpperCase()}: drive. Pick a folder inside it.`,
      }
    }
    return { kind: 'local', bareRoot: false, driveLetter: drive[1].toUpperCase(), reason: null }
  }
  return {
    kind: 'invalid', bareRoot: false, driveLetter: null,
    reason: 'Enter an absolute path — \\\\server\\share\\folder for a network location, or a full local folder path.',
  }
}
