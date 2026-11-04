// =============================================================================
// mothEligibility.js — MO1 (0111, MOTH_DESIGN §2.2 CL-2): which file rows Moth
// may draw, as the client's mirror of public.moth_file_row_locked.
//
// On the cloud the server has already removed these rows (moth_project_files),
// so this is a second look. On the signed-out desktop there is no server: this
// is the only filter between the project's bundle and the screen, which is why
// it reads the desktop's old money folders too and fails closed on a non-row.
//
// mothEligibility.test.js reads the migration's text and holds the arms together.
// =============================================================================
import { isMoneyKey, moneyFolderChainLocked } from '../../rabbit_v0.1.0/storage/index.js'

const has = (list, value) => (list instanceof Set ? list.has(value) : Array.isArray(list) && list.includes(value))

/** A key's or a disk path's directories, either slash, case-folded. */
const pathSegments = (path) => (typeof path === 'string' ? path.toLowerCase().split(/[\\/]/) : [])

/**
 * @param {object} row a files row
 * @param {object} [known] what the row alone cannot say
 * @param {Set|string[]} [known.expenseFileIds] files named by THIS project's expenses (the desktop only)
 * @param {string[]} [known.localMoneyDirs] the desktop's {slug}_RECEIPTS&INVOICES, {slug}_CREWINVOICES and {slug}_TALENTINVOICES
 * @param {Map|object[]} [known.folders] this project's folder rows, for the chain
 * @returns {boolean} true when Moth must not draw the row
 */
export function mothFileHidden(row, { expenseFileIds = [], localMoneyDirs = [], folders = [] } = {}) {
  if (!row || typeof row !== 'object') return true
  if (row.is_financial) return true
  if (isMoneyKey(row.storage_path)) return true
  if (Array.isArray(row.tags) && row.tags.includes('legal')) return true
  if (has(expenseFileIds, row.id)) return true
  if (moneyFolderChainLocked(row.folder_id, folders)) return true
  const segments = pathSegments(row.storage_path)
  return localMoneyDirs.some((dir) => segments.includes(String(dir).toLowerCase()))
}
