/**
 * IndexedDB-backed project storage for WILSON.
 * Replaces localStorage to support larger files (images, videos, PDFs).
 * localStorage limit ≈ 5 MB; IndexedDB limit ≈ browser-dependent, typically 100s of MB+.
 *
 * On first load, automatically migrates existing localStorage data into IndexedDB.
 */

const DB_NAME = 'wilson-db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const LS_KEY = 'wilson-projects';

// Storage warning threshold (informational only — IndexedDB can handle much more)
export const STORAGE_WARNING_BYTES = 50 * 1024 * 1024; // 50 MB

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return _dbPromise;
}

/**
 * Load projects from IndexedDB, falling back to localStorage for migration.
 * @returns {Promise<Array>} Array of project objects
 */
export async function loadProjects() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result = await new Promise((resolve, reject) => {
      const req = store.get('all');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (result && Array.isArray(result)) {
      return result;
    }

    // No IndexedDB data — try migrating from localStorage
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const projects = JSON.parse(raw);
      if (Array.isArray(projects) && projects.length > 0) {
        // Migrate to IndexedDB
        await saveProjects(projects);
        // Clear localStorage copy to free space
        localStorage.removeItem(LS_KEY);
        return projects;
      }
    }
    return [];
  } catch (err) {
    console.warn('[WILSON] IndexedDB load failed, falling back to localStorage:', err);
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
}

/**
 * Save projects to IndexedDB.
 * @param {Array} projects - Array of project objects
 * @returns {Promise<number>} Approximate byte size of saved data
 */
export async function saveProjects(projects) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const req = store.put(projects, 'all');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    // Estimate size (approximate — JSON serialization)
    const json = JSON.stringify(projects);
    return json.length;
  } catch (err) {
    console.error('[WILSON] IndexedDB save failed:', err);
    return 0;
  }
}

/**
 * Synchronous load from localStorage — used only for initial state before IndexedDB is ready.
 * @returns {Array}
 */
export function loadProjectsSync() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
