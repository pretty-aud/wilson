const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Handle Squirrel.Windows startup events (install, update, uninstall)
if (require('electron-squirrel-startup')) app.quit();

// ═══════════════════════════════════════════════════════════════════
//  O.T.T.E.R. DATA DIRECTORY — stored in Electron userData
// ═══════════════════════════════════════════════════════════════════
function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'otter-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSoftwareDir() {
  const dir = path.join(getDataDir(), 'software');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ═══════════════════════════════════════════════════════════════════
//  RABBIT DATA DIRECTORY — separate root from otter-data
// ═══════════════════════════════════════════════════════════════════
function getRabbitDataDir() {
  const dir = path.join(app.getPath('userData'), 'rabbit-data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJSON(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Title-Case-Hyphenated slug for project/asset/file folder names.
// "Hero Film 2026" → "Hero-Film-2026"
function fileSlugify(str) {
  return str.trim()
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('-');
}

// ── Managed-files config ────────────────────────────────────
// Stores { defaultRootDir: string|null } at rabbit-data/files-config.json.
// Individual projects can override with their own folder_root.
function getFilesConfigPath() { return path.join(getRabbitDataDir(), 'files-config.json'); }
function readFilesConfig() { return readJSON(getFilesConfigPath(), { defaultRootDir: null }); }
function writeFilesConfig(cfg) { writeJSON(getFilesConfigPath(), cfg); }

// Next version number for a file within an asset: finds max existing version
// and returns max+1. Returns 1 if no prior versions exist.
function getNextVersion(managedFiles, fileName, assetId) {
  const existing = (managedFiles || []).filter(f =>
    f.file_name === fileName && f.asset_id === assetId && !f.deleted_at
  );
  if (existing.length === 0) return 1;
  return Math.max(...existing.map(f => f.version || 0)) + 1;
}

// Format version number as zero-padded 3-digit string: 1 → "v001"
function formatVersion(n) { return 'v' + String(n).padStart(3, '0'); }

// Thumbnail cache directory
function getThumbCacheDir() {
  const dir = path.join(getRabbitDataDir(), 'thumbnails');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Check if a file extension is an image we can thumbnail
const THUMB_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.avif']);
function isThumbableExt(ext) { return THUMB_EXTENSIONS.has((ext || '').toLowerCase()); }

// ═══════════════════════════════════════════════════════════════════
//  DEFAULT PET DATA
// ═══════════════════════════════════════════════════════════════════
function defaultPet() {
  return {
    name: 'Ollie', gender: Math.random() < 0.5 ? 'male' : 'female',
    breed: null, form: 'egg',
    hunger: 0, happiness: 0,
    state: 'content', difficulty: 'medium', petMode: true,
    eggPetCount: 0, eggHatchThreshold: Math.floor(Math.random() * 3) + 2,
    bornAt: null, evolvedAt: null, diedAt: null,
    lastFedAt: null, lastPettedAt: null, lastSleptAt: null, sleepingSince: null,
    interactionCount: 0, lastUpdatedAt: new Date().toISOString(),
    feedback: [], totalThumbsUp: 0, totalThumbsDown: 0
  };
}

// ═══════════════════════════════════════════════════════════════════
//  EXPRESS SERVER WITH O.T.T.E.R. API ROUTES
// ═══════════════════════════════════════════════════════════════════
function startLocalServer(distPath) {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    expressApp.use(cors());
    expressApp.use(express.json({ limit: '50mb' }));

    // ── Pet endpoints ──
    expressApp.get('/api/pet', (req, res) => {
      const petPath = path.join(getDataDir(), 'pet.json');
      let pet = readJSON(petPath);
      if (!pet) { pet = defaultPet(); writeJSON(petPath, pet); }
      res.json(pet);
    });

    expressApp.post('/api/pet', (req, res) => {
      writeJSON(path.join(getDataDir(), 'pet.json'), req.body);
      res.json({ ok: true });
    });

    expressApp.post('/api/pet/reset', (req, res) => {
      const petPath = path.join(getDataDir(), 'pet.json');
      let pet = readJSON(petPath);
      if (pet) {
        pet.feedback = []; pet.totalThumbsUp = 0; pet.totalThumbsDown = 0;
        pet.interactionCount = 0;
        writeJSON(petPath, pet);
      }
      res.json(pet || defaultPet());
    });

    expressApp.post('/api/pet/new-egg', (req, res) => {
      const petPath = path.join(getDataDir(), 'pet.json');
      let old = readJSON(petPath);
      if (!old || old.form !== 'ghost') {
        return res.status(400).json({ error: 'Pet must be a ghost to create new egg' });
      }
      const pet = defaultPet();
      pet.difficulty = old.difficulty;
      pet.feedback = old.feedback || [];
      pet.totalThumbsUp = old.totalThumbsUp || 0;
      pet.totalThumbsDown = old.totalThumbsDown || 0;
      writeJSON(petPath, pet);
      res.json(pet);
    });

    // ── Software/Course endpoints ──
    expressApp.get('/api/software', (req, res) => {
      const swDir = getSoftwareDir();
      const folders = fs.readdirSync(swDir).filter(f => fs.statSync(path.join(swDir, f)).isDirectory());
      const list = folders.map(slug => {
        const meta = readJSON(path.join(swDir, slug, '_meta.json'), {});
        const subjDir = path.join(swDir, slug, 'subjects');
        let subjectCount = 0;
        if (fs.existsSync(subjDir)) {
          subjectCount = fs.readdirSync(subjDir).filter(f => f.endsWith('.json')).length;
        }
        return { slug, name: meta.name || slug, type: meta.type || 'software', skill_level: meta.skill_level || 'beginner', subject_count: subjectCount, created_at: meta.created_at };
      });
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      res.json(list);
    });

    expressApp.post('/api/software', (req, res) => {
      const { name, type, skill_level } = req.body;
      const slug = slugify(name);
      const swPath = path.join(getSoftwareDir(), slug);
      if (!fs.existsSync(swPath)) fs.mkdirSync(swPath, { recursive: true });
      if (!fs.existsSync(path.join(swPath, 'subjects'))) fs.mkdirSync(path.join(swPath, 'subjects'));
      const meta = { name, type: type || 'software', skill_level: skill_level || 'beginner', created_at: new Date().toISOString() };
      writeJSON(path.join(swPath, '_meta.json'), meta);
      if (!fs.existsSync(path.join(swPath, '_hotkeys.json'))) writeJSON(path.join(swPath, '_hotkeys.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_functions.json'))) writeJSON(path.join(swPath, '_functions.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_nodes.json'))) writeJSON(path.join(swPath, '_nodes.json'), { categories: [] });
      if (!fs.existsSync(path.join(swPath, '_progress.json'))) writeJSON(path.join(swPath, '_progress.json'), { completed_lessons: [], last_accessed: null });
      if (!fs.existsSync(path.join(swPath, '_quiz-history.json'))) writeJSON(path.join(swPath, '_quiz-history.json'), { attempts: [] });
      if (!fs.existsSync(path.join(swPath, '_references.json'))) writeJSON(path.join(swPath, '_references.json'), { urls: [] });
      res.json({ slug, ...meta });
    });

    expressApp.get('/api/software/:slug', (req, res) => {
      const meta = readJSON(path.join(getSoftwareDir(), req.params.slug, '_meta.json'));
      if (!meta) return res.status(404).json({ error: 'Not found' });
      res.json({ slug: req.params.slug, ...meta });
    });

    expressApp.delete('/api/software/:slug', (req, res) => {
      const swPath = path.join(getSoftwareDir(), req.params.slug);
      if (fs.existsSync(swPath)) fs.rmSync(swPath, { recursive: true, force: true });
      res.json({ ok: true });
    });

    // ── Subject ordering utility ──
    // Content-aware curriculum sort: analyzes title + skill_level to determine
    // a pedagogically correct order. Returns a numeric score (lower = earlier).
    // Score = (difficultyTier * 100) + topicGroup
    // This ensures difficulty is the primary axis, topic grouping is secondary.
    function getCurriculumScore(title, skillLevel) {
      const t = (title || '').toLowerCase();

      // ── Difficulty tier (primary axis, 0-3) ──
      let tier;
      if (/\b(general basics|interface|layout|navigation|getting.?started|workspace|overview)\b/.test(t)) {
        tier = 0; // Absolute foundations — first thing a new user needs
      } else if (/\b(basics?|fundamenta|essentia|introduction|intro to)\b/.test(t) || /^basic\b/i.test(t)) {
        tier = 1; // Beginner-level subjects
      } else if (/\b(intermediate|principles?|techniques)\b/.test(t) || skillLevel === 'intermediate') {
        tier = 2; // Intermediate
      } else if (/\b(advanced|complex|optimization|reusab|dynamic)\b/.test(t) || skillLevel === 'advanced') {
        tier = 3; // Advanced
      } else {
        tier = skillLevel === 'beginner' ? 1 : skillLevel === 'advanced' ? 3 : 2;
      }

      // ── Topic group (secondary axis, 0-8) ──
      // Orders topics in a natural curriculum flow within each difficulty tier.
      // NOTE: No trailing \b — patterns use stems to match plurals/gerunds
      // (e.g., "model" matches "modeling", "light" matches "lighting")
      let group = 5; // default middle
      if (/\b(general|basics of|overview|interface|layout|workspace|navigation)/.test(t)) group = 0;
      else if (/\b(model|mesh|topolog|sculpt|edit.?mode|object.?mode|extrude)/.test(t)) group = 1;
      else if (/\b(curve|spline|nurbs|path\b)/.test(t)) group = 2;
      else if (/\b(material|shad|textur|uv |unwrap)/.test(t)) group = 3;
      else if (/\b(light|render|camera|composit)/.test(t)) group = 4;
      else if (/\b(animat|keyframe|rig\b|bone|armature|timeline|motion)/.test(t)) group = 5;
      else if (/\b(node|procedur|geometry.?node|shader.?node|attribut|data.?flow)/.test(t)) group = 6;
      else if (/\b(instanc|distribut|scatter|particle)/.test(t)) group = 7;
      else if (/\b(simulat|physic|dynamic|fluid|cloth|rigid)/.test(t)) group = 8;
      // Coding language topics
      else if (/\b(variable|data.?type|syntax|operator|\btype)/.test(t)) group = 1;
      else if (/\b(control.?flow|loop|condition|if |while|for )/.test(t)) group = 2;
      else if (/\b(function|method|class\b|object|module|scope)/.test(t)) group = 3;
      else if (/\b(array|list|dict|collect|string|data.?struct)/.test(t)) group = 4;
      else if (/\b(file|i\/o|input|output|stream)/.test(t)) group = 6;
      else if (/\b(error|exception|debug|test)/.test(t)) group = 7;
      else if (/\b(api|library|framework|package|import)/.test(t)) group = 8;

      return tier * 100 + group;
    }

    function renumberSubjects(softwareSlug) {
      const subjDir = path.join(getSoftwareDir(), softwareSlug, 'subjects');
      if (!fs.existsSync(subjDir)) return [];
      const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
      const subjects = files.map(f => {
        const data = readJSON(path.join(subjDir, f), {});
        return { fileName: f, slug: f.replace('.json', ''), data };
      });
      // Always apply content-aware curriculum sort
      subjects.sort((a, b) => {
        const sa = getCurriculumScore(a.data.title, a.data.skill_level);
        const sb = getCurriculumScore(b.data.title, b.data.skill_level);
        if (sa !== sb) return sa - sb;
        return (a.data.title || '').localeCompare(b.data.title || '');
      });
      // Reassign sequential 1-indexed order
      subjects.forEach((s, i) => {
        s.data.subject_order = i + 1;
        writeJSON(path.join(subjDir, s.fileName), s.data);
      });
      return subjects.map(s => ({
        slug: s.slug, title: s.data.title || s.slug, description: s.data.description || '',
        skill_level: s.data.skill_level || 'beginner', is_stub: s.data.is_stub || false,
        subject_order: s.data.subject_order
      }));
    }

    // ── Subject endpoints ──
    expressApp.get('/api/software/:slug/subjects', (req, res) => {
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) return res.json([]);
      // Always use curriculum-aware sort to ensure correct ordering
      const sorted = renumberSubjects(req.params.slug);
      res.json(sorted);
    });

    expressApp.post('/api/software/:slug/subjects', (req, res) => {
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) fs.mkdirSync(subjDir, { recursive: true });
      const subSlug = req.body.slug || slugify(req.body.title);
      // Auto-assign subject_order if not provided
      if (req.body.subject_order == null) {
        const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
        let maxOrder = 0;
        for (const f of files) {
          const d = readJSON(path.join(subjDir, f), {});
          if (d.subject_order != null && d.subject_order > maxOrder) maxOrder = d.subject_order;
        }
        req.body.subject_order = maxOrder + 1;
      }
      writeJSON(path.join(subjDir, `${subSlug}.json`), req.body);
      res.json({ slug: subSlug, ...req.body });
    });

    expressApp.get('/api/software/:slug/subjects/:sub', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, 'subjects', `${req.params.sub}.json`));
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json({ slug: req.params.sub, ...data });
    });

    expressApp.delete('/api/software/:slug/subjects/:sub', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, 'subjects', `${req.params.sub}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      // Renumber remaining subjects to close gaps
      const updated = renumberSubjects(req.params.slug);
      res.json({ ok: true, subjects: updated });
    });

    // Renumber all subjects (called after undo/redo/import)
    expressApp.post('/api/software/:slug/subjects/renumber', (req, res) => {
      const updated = renumberSubjects(req.params.slug);
      res.json(updated);
    });

    // Reorder subjects by explicit slug order (called when AI determines placement)
    expressApp.post('/api/software/:slug/subjects/reorder', (req, res) => {
      const { orderedSlugs } = req.body;
      if (!Array.isArray(orderedSlugs)) return res.status(400).json({ error: 'orderedSlugs array required' });
      const subjDir = path.join(getSoftwareDir(), req.params.slug, 'subjects');
      if (!fs.existsSync(subjDir)) return res.json([]);
      // Read all subjects
      const files = fs.readdirSync(subjDir).filter(f => f.endsWith('.json'));
      const subjectMap = {};
      for (const f of files) {
        const slug = f.replace('.json', '');
        subjectMap[slug] = readJSON(path.join(subjDir, f), {});
      }
      // Assign order based on orderedSlugs position
      let order = 1;
      for (const slug of orderedSlugs) {
        if (subjectMap[slug]) {
          subjectMap[slug].subject_order = order++;
          writeJSON(path.join(subjDir, `${slug}.json`), subjectMap[slug]);
        }
      }
      // Any subjects not in orderedSlugs get appended at the end
      for (const slug of Object.keys(subjectMap)) {
        if (!orderedSlugs.includes(slug)) {
          subjectMap[slug].subject_order = order++;
          writeJSON(path.join(subjDir, `${slug}.json`), subjectMap[slug]);
        }
      }
      // Return the sorted list
      const result = Object.entries(subjectMap).map(([slug, data]) => ({
        slug, title: data.title || slug, description: data.description || '',
        skill_level: data.skill_level || 'beginner', is_stub: data.is_stub || false,
        subject_order: data.subject_order
      }));
      result.sort((a, b) => a.subject_order - b.subject_order);
      res.json(result);
    });

    // ── Hotkeys endpoints ──
    expressApp.get('/api/software/:slug/hotkeys', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_hotkeys.json'), { categories: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/hotkeys/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_hotkeys.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      const normalizeCat = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const inCat of incoming) {
        const catName = inCat.category || inCat.name || 'General';
        const inShortcuts = inCat.shortcuts || inCat.hotkeys || [];
        const catNorm = normalizeCat(catName);
        let existCat = existing.categories.find(c => normalizeCat(c.category) === catNorm);
        if (!existCat) { existCat = { category: catName, shortcuts: [] }; existing.categories.push(existCat); }
        for (const hk of inShortcuts) {
          const actionNorm = (hk.action || '').toLowerCase().trim();
          if (!existCat.shortcuts.some(h => (h.action || '').toLowerCase().trim() === actionNorm)) existCat.shortcuts.push(hk);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Functions endpoints ──
    expressApp.get('/api/software/:slug/functions', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_functions.json'), { categories: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/functions/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_functions.json');
      const existing = readJSON(filePath, { categories: [] });
      const incoming = req.body.categories || [];
      for (const inCat of incoming) {
        let existCat = existing.categories.find(c => c.name === inCat.name);
        if (!existCat) { existCat = { name: inCat.name, functions: [] }; existing.categories.push(existCat); }
        for (const fn of (inCat.functions || [])) {
          if (!existCat.functions.some(f => f.name === fn.name)) existCat.functions.push(fn);
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Nodes endpoints ──
    // Auto-migrate old { categories: [] } format → new { systems: [] } format
    function migrateNodesData(data) {
      if (data.systems) return data; // already new format
      if (!data.categories || data.categories.length === 0) return { systems: [] };
      // Group old categories into systems by detecting system-like category names
      const systemMap = {};
      for (const cat of data.categories) {
        const catName = cat.category || 'General';
        // Infer system from category name patterns
        let system = 'General';
        const lower = catName.toLowerCase();
        if (lower.includes('shader') || lower.includes('texture') || lower.includes('material') || lower.includes('shading')) system = 'Shader Nodes';
        else if (lower.includes('geometry') || lower.includes('instanc') || lower.includes('distribut') || lower.includes('primitiv') || lower.includes('transform') || lower.includes('mesh') || lower.includes('curve') || lower.includes('point')) system = 'Geometry Nodes';
        else if (lower.includes('composit')) system = 'Compositing Nodes';
        if (!systemMap[system]) systemMap[system] = [];
        systemMap[system].push(cat);
      }
      return { systems: Object.entries(systemMap).map(([system, categories]) => ({ system, categories })) };
    }

    expressApp.get('/api/software/:slug/nodes', (req, res) => {
      const raw = readJSON(path.join(getSoftwareDir(), req.params.slug, '_nodes.json'), { systems: [] });
      const data = migrateNodesData(raw);
      res.json(data);
    });

    expressApp.post('/api/software/:slug/nodes/merge', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_nodes.json');
      const raw = readJSON(filePath, { systems: [] });
      const existing = migrateNodesData(raw);
      const incoming = req.body.categories || [];
      const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

      for (const inCat of incoming) {
        const systemName = inCat.system || 'General';
        const catName = inCat.category || 'General';
        const inNodes = inCat.nodes || [];
        const sysNorm = norm(systemName);
        const catNorm = norm(catName);

        // Find or create system
        let sys = existing.systems.find(s => norm(s.system) === sysNorm);
        if (!sys) { sys = { system: systemName, categories: [] }; existing.systems.push(sys); }

        // Find or create category within system
        let existCat = sys.categories.find(c => norm(c.category) === catNorm);
        if (!existCat) { existCat = { category: catName, nodes: [] }; sys.categories.push(existCat); }

        // Merge nodes by name
        for (const node of inNodes) {
          const normName = (node.name || '').toLowerCase().trim();
          if (!existCat.nodes.some(n => (n.name || '').toLowerCase().trim() === normName)) {
            existCat.nodes.push(node);
          }
        }
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Progress endpoints ──
    expressApp.get('/api/software/:slug/progress', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_progress.json'), { completed_lessons: [], last_accessed: null });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/progress', (req, res) => {
      writeJSON(path.join(getSoftwareDir(), req.params.slug, '_progress.json'), req.body);
      res.json({ ok: true });
    });

    // ── Quiz history endpoints ──
    expressApp.get('/api/software/:slug/quiz-history', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_quiz-history.json'), { attempts: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/quiz-history', (req, res) => {
      writeJSON(path.join(getSoftwareDir(), req.params.slug, '_quiz-history.json'), req.body);
      res.json({ ok: true });
    });

    // ── Reference URLs (per-software) ──
    expressApp.get('/api/software/:slug/references', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_references.json'), { urls: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/references', (req, res) => {
      writeJSON(path.join(getSoftwareDir(), req.params.slug, '_references.json'), req.body);
      res.json({ ok: true });
    });

    // ── Correction memory (per-software) ──
    expressApp.get('/api/software/:slug/corrections', (req, res) => {
      const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_corrections.json'), { corrections: [] });
      res.json(data);
    });

    expressApp.post('/api/software/:slug/corrections', (req, res) => {
      const filePath = path.join(getSoftwareDir(), req.params.slug, '_corrections.json');
      const existing = readJSON(filePath, { corrections: [] });
      const incoming = req.body.corrections || [];
      // Merge by id — add new, update existing
      for (const c of incoming) {
        const idx = existing.corrections.findIndex(e => e.id === c.id);
        if (idx >= 0) existing.corrections[idx] = c;
        else existing.corrections.push(c);
      }
      writeJSON(filePath, existing);
      res.json(existing);
    });

    // ── Export all ──
    expressApp.get('/api/export-all', (req, res) => {
      const swDir = getSoftwareDir();
      const folders = fs.readdirSync(swDir).filter(f => fs.statSync(path.join(swDir, f)).isDirectory());
      const software = folders.map(slug => {
        const meta = readJSON(path.join(swDir, slug, '_meta.json'), {});
        const hotkeys = readJSON(path.join(swDir, slug, '_hotkeys.json'), { categories: [] });
        const functions = readJSON(path.join(swDir, slug, '_functions.json'), { categories: [] });
        const nodesRaw = readJSON(path.join(swDir, slug, '_nodes.json'), { systems: [] });
        const nodes = migrateNodesData(nodesRaw);
        const progress = readJSON(path.join(swDir, slug, '_progress.json'), {});
        const quizHistory = readJSON(path.join(swDir, slug, '_quiz-history.json'), {});
        const subjDir = path.join(swDir, slug, 'subjects');
        let subjects = [];
        if (fs.existsSync(subjDir)) {
          subjects = fs.readdirSync(subjDir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(subjDir, f), {}));
        }
        return { meta: { slug, ...meta }, hotkeys, functions, nodes, progress, quizHistory, subjects };
      });
      res.json({ version: '2.0', exported_at: new Date().toISOString(), software });
    });

    // ── Migration check (v1 → v2) ──
    expressApp.get('/api/migration-needed', (req, res) => {
      const dataDir = getDataDir();
      const needed = fs.existsSync(path.join(dataDir, 'lesson-plans.bak')) || fs.existsSync(path.join(dataDir, 'progress.bak'));
      res.json({ needed });
    });

    expressApp.post('/api/migrate', (req, res) => {
      res.json({ ok: true, message: 'Migration handled client-side or not needed' });
    });

    // ── O.T.T.E.R. settings (prompts only — API key uses WILSON's localStorage) ──
    expressApp.get('/api/otter-settings', (req, res) => {
      const data = readJSON(path.join(getDataDir(), 'otter-settings.json'), {
        companionVisible: true, companionName: 'Ollie', prompts: {}
      });
      res.json(data);
    });

    expressApp.post('/api/otter-settings', (req, res) => {
      writeJSON(path.join(getDataDir(), 'otter-settings.json'), req.body);
      res.json({ ok: true });
    });

    // ── Agent skills (per-tool system prompt overrides) ──
    // The Settings → Agent Skills tab persists prompt overrides
    // here, separate from otter-settings so the existing Otter
    // settings file isn't reshaped. Shape:
    //   { [toolName]: { systemPromptOverride: string | null } }
    expressApp.get('/api/agent-skills', (req, res) => {
      const data = readJSON(path.join(getDataDir(), 'agent-skills.json'), {});
      res.json(data);
    });
    expressApp.post('/api/agent-skills', (req, res) => {
      writeJSON(path.join(getDataDir(), 'agent-skills.json'), req.body || {});
      res.json({ ok: true });
    });

    // ── Password management (file-backed, persists across port changes) ──
    const ADMIN_PASSWORD = 'DILLYDALLY';
    const DEFAULT_PASSWORD = 'MUTINY';
    function getPasswordFile() { return path.join(getDataDir(), 'wilson-auth.json'); }
    function getStoredPassword() {
      const data = readJSON(getPasswordFile(), null);
      return (data && data.password) ? data.password : DEFAULT_PASSWORD;
    }

    // Check if session is still valid (persists across app restarts, expires after 1 hour)
    expressApp.get('/api/auth/session', (req, res) => {
      const data = readJSON(getPasswordFile(), null);
      if (!data || !data.last_auth_at) return res.json({ valid: false });
      const elapsed = Date.now() - data.last_auth_at;
      const valid = elapsed < 60 * 60 * 1000; // 1 hour
      res.json({ valid });
    });

    expressApp.post('/api/auth/verify', (req, res) => {
      const input = (req.body.password || '').toUpperCase();
      const stored = getStoredPassword().toUpperCase();
      const valid = input === stored || input === ADMIN_PASSWORD;
      // Persist auth timestamp on successful login
      if (valid) {
        const data = readJSON(getPasswordFile(), {});
        data.last_auth_at = Date.now();
        writeJSON(getPasswordFile(), data);
      }
      res.json({ valid });
    });

    expressApp.post('/api/auth/change', (req, res) => {
      const current = (req.body.current || '').toUpperCase();
      const stored = getStoredPassword().toUpperCase();
      if (current !== stored && current !== ADMIN_PASSWORD) {
        return res.json({ ok: false, error: 'Current password is incorrect' });
      }
      const np = req.body.newPassword || '';
      if (np.length === 0) return res.json({ ok: false, error: 'New password cannot be empty' });
      if (np.length > 12) return res.json({ ok: false, error: 'Password must be 12 characters or fewer' });
      if (!/^[a-zA-Z0-9]+$/.test(np)) return res.json({ ok: false, error: 'Password must contain only letters and numbers' });
      writeJSON(getPasswordFile(), { password: np.toUpperCase() });
      res.json({ ok: true });
    });

    // ── URL fetch (for user-provided reference links) ──
    expressApp.post('/api/fetch-url', async (req, res) => {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'URL required' });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'WILSON/0.5.5 OTTERBot' }
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000);
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : url;
        res.json({ title, text, url });
      } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to fetch URL' });
      }
    });

    // Raw passthrough fetcher used by the RABBIT Rate Card
    // Google Sheets importer. Returns the body verbatim along
    // with the response Content-Type so the renderer can decide
    // how to parse it (CSV vs HTML vs JSON). 15 second timeout,
    // 5 MB cap to keep things sane.
    expressApp.post('/api/fetch-raw', async (req, res) => {
      const { url, redirect = 'follow' } = req.body || {};
      if (!url) return res.status(400).json({ error: 'URL required' });
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, {
          signal: controller.signal,
          redirect,
          headers: { 'User-Agent': 'WILSON/0.6 RABBIT' },
        });
        clearTimeout(timeout);
        if (!response.ok) {
          return res.status(response.status).json({
            error: `Upstream ${response.status} ${response.statusText}`,
            status: response.status,
          });
        }
        const contentType = response.headers.get('content-type') || '';
        const buf = await response.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) {
          return res.status(413).json({ error: 'Response exceeds 5 MB cap' });
        }
        const body = Buffer.from(buf).toString('utf8');
        res.json({ body, contentType, finalUrl: response.url, status: response.status });
      } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to fetch URL' });
      }
    });

    // ═══════════════════════════════════════════════════════════════
    //  RABBIT — local server adapter routes
    //  Backs `localServerAdapter.js`. Persists each project as one
    //  denormalized JSON bundle under
    //    {userData}/rabbit-data/projects/{project_id}/project.json
    //  Binary files live under .../files/, thumbs under .../thumbs/.
    // ═══════════════════════════════════════════════════════════════
    // Use Node's built-in crypto.randomUUID — uuid@13 is ESM-only and
    // can't be require()'d from this CommonJS main process file.
    const { randomUUID: uuidv4 } = require('node:crypto');

    function getRabbitProjectsDir() {
      const dir = path.join(getRabbitDataDir(), 'projects');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function getRabbitProjectDir(projectId) {
      const dir = path.join(getRabbitProjectsDir(), projectId);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function getRabbitFilesDir(projectId) {
      const dir = path.join(getRabbitProjectDir(projectId), 'files');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function rabbitBundlePath(projectId) {
      return path.join(getRabbitProjectDir(projectId), 'project.json');
    }
    function readRabbitBundle(projectId) {
      const bundle = readJSON(rabbitBundlePath(projectId), null);
      if (!bundle) return null;
      // ── Migrate old bundles ──
      let dirty = false;
      if (!bundle.projectTeam)     { bundle.projectTeam     = []; dirty = true; }
      if (!bundle.managedFiles)    { bundle.managedFiles    = []; dirty = true; }
      if (!bundle.budgetLines)     { bundle.budgetLines     = []; dirty = true; }
      if (!bundle.budgetActuals)   { bundle.budgetActuals   = []; dirty = true; }
      if (!bundle.budgetVersions)  { bundle.budgetVersions  = []; dirty = true; }
      if (!bundle.expenses)        { bundle.expenses        = []; dirty = true; }
      if (!bundle.scenes)          { bundle.scenes          = []; dirty = true; }
      if (!bundle.shots)           { bundle.shots           = []; dirty = true; }
      if (!bundle.levels)          { bundle.levels          = []; dirty = true; }
      if (!bundle.experiences)     { bundle.experiences     = []; dirty = true; }
      // Ensure sub-folder structure exists on first access
      try { ensureProjectFolders(bundle); } catch {}
      if (dirty) {
        try { writeJSON(rabbitBundlePath(projectId), bundle); } catch {}
      }
      return bundle;
    }
    function writeRabbitBundle(projectId, bundle) {
      bundle.project.updated_at = new Date().toISOString();
      // Ensure projectTeam array exists (backward compat for old bundles)
      if (!bundle.projectTeam) bundle.projectTeam = [];
      writeJSON(rabbitBundlePath(projectId), bundle);
      // Mirror split databases to user-visible project folder
      mirrorProjectDatabases(projectId, bundle);
    }
    function emptyBundle(project) {
      return {
        project,
        phases:          [],
        assets:          [],
        tasks:           [],
        dependencies:    [],
        taskLinks:       [],
        files:           [],
        assetVersions:   [],
        comments:        [],
        ingestionRuns:   [],
        teamAssignments: [],
        projectTeam:     [],
        managedFiles:    [],
        budgetVersions:  [],
        expenses:        [],
        budgetLines:     [],
        budgetActuals:   [],
        scenes:          [],
        shots:           [],
        levels:          [],
        experiences:     [],
      };
    }
    function rabbitTouch(row) {
      const now = new Date().toISOString();
      if (!row.id) row.id = uuidv4();
      if (!row.created_at) row.created_at = now;
      row.updated_at = now;
      return row;
    }
    function rabbitUpsertInto(arr, row) {
      const idx = arr.findIndex(x => x.id === row.id);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], ...row };
        return arr[idx];
      }
      arr.push(row);
      return row;
    }
    function rabbitRemoveFrom(arr, id) {
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return false;
      arr.splice(idx, 1);
      return true;
    }
    function rabbitNotFound(res, what = 'project') {
      return res.status(404).json({ error: `${what} not found` });
    }

    // ── Project folder structure helpers ─────────────────────
    // Every user-visible project folder gets three sub-folders:
    //   ASSETS/                       — asset folders + managed files
    //   {Slug}_DATABASES/             — read-only JSON mirrors of project data
    //   {Slug}_FILES/                 — uploaded files (receipts, docs, etc.)

    function resolveProjectFolder(bundle) {
      const root = bundle?.project?.folder_root;
      if (root && fs.existsSync(root)) return root;
      const cfg = readFilesConfig();
      if (!cfg.defaultRootDir) return null;
      const slug = bundle?.project?.folder_slug || fileSlugify(bundle?.project?.title || 'Untitled-Project');
      const resolved = path.join(cfg.defaultRootDir, slug);
      return fs.existsSync(resolved) ? resolved : null;
    }

    function ensureProjectFolders(bundle) {
      const root = resolveProjectFolder(bundle);
      if (!root) return;
      const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
      const dirs = [
        path.join(root, 'ASSETS'),
        path.join(root, `${slug}_DATABASES`),
        path.join(root, `${slug}_FILES`),
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      }
    }

    function mirrorProjectDatabases(projectId, bundle) {
      const root = resolveProjectFolder(bundle);
      if (!root) return;
      const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
      const dbDir = path.join(root, `${slug}_DATABASES`);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
      try {
        // project.json — project metadata
        writeJSON(path.join(dbDir, 'project.json'), bundle.project);
        // team.json — project-scoped team roster
        writeJSON(path.join(dbDir, 'team.json'), bundle.projectTeam || []);
        // tasks.json — tasks + dependencies + task links
        writeJSON(path.join(dbDir, 'tasks.json'), {
          tasks:        bundle.tasks        || [],
          dependencies: bundle.dependencies || [],
          taskLinks:    bundle.taskLinks    || [],
        });
        // timeline.json — phases + scheduling data
        writeJSON(path.join(dbDir, 'timeline.json'), {
          phases:       bundle.phases       || [],
          tasks:        (bundle.tasks || []).map(t => ({
            id: t.id, name: t.name, asset_id: t.asset_id,
            assigned_role_slug: t.assigned_role_slug,
            status: t.status, bid_days: t.bid_days,
            start_date: t.start_date, end_date: t.end_date,
            sort_order: t.sort_order,
          })),
          dependencies: bundle.dependencies || [],
        });
        // budget.json — budget lines, actuals, versions, expenses
        writeJSON(path.join(dbDir, 'budget.json'), {
          budgetLines:    bundle.budgetLines    || [],
          budgetActuals:  bundle.budgetActuals  || [],
          budgetVersions: bundle.budgetVersions || [],
          expenses:       bundle.expenses       || [],
        });
      } catch (e) {
        console.error('mirrorProjectDatabases failed:', e.message);
      }
    }

    // Resolve the _FILES dir inside the user-visible project folder.
    // Falls back to the internal rabbit-data files dir if no project folder exists.
    function resolveProjectFilesDir(bundle, projectId) {
      const root = resolveProjectFolder(bundle);
      if (root) {
        const slug = bundle.project.folder_slug || fileSlugify(bundle.project.title || 'Untitled-Project');
        const dir = path.join(root, `${slug}_FILES`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
      }
      // Fallback to internal storage
      return getRabbitFilesDir(projectId);
    }

    // ── Projects ────────────────────────────────────────────
    expressApp.get('/api/rabbit/projects', (req, res) => {
      const projectsDir = getRabbitProjectsDir();
      const ids = fs.readdirSync(projectsDir).filter(f =>
        fs.statSync(path.join(projectsDir, f)).isDirectory()
      );
      const list = [];
      for (const id of ids) {
        const bundle = readRabbitBundle(id);
        if (bundle?.project) {
          // Return the full project record so DOG-side fields
          // (documents, visualAssets, startDate, endDate, description)
          // travel through alongside the canonical RABBIT fields.
          list.push({ ...bundle.project });
        }
      }
      list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
      res.json(list);
    });

    expressApp.get('/api/rabbit/projects/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.id);
      if (!bundle) return rabbitNotFound(res);
      res.json(bundle);
    });

    expressApp.post('/api/rabbit/projects', (req, res) => {
      const now = new Date().toISOString();
      // Spread req.body first so DOG-side fields (documents, visualAssets,
      // startDate, endDate, etc.) ride through, then enforce the canonical
      // identity / timestamp fields so they can't be overridden.
      const project = {
        ...req.body,
        id:              req.body.id || uuidv4(),
        workspace_id:    req.body.workspace_id || '00000000-0000-0000-0000-000000000001',
        title:           req.body.title || 'Untitled Project',
        description:     req.body.description || '',
        status:          req.body.status || 'active',
        status_tag:      req.body.status_tag || null,
        start_date:      req.body.start_date || null,
        end_date:        req.body.end_date || null,
        budget_total:    req.body.budget_total ?? null,
        budget_currency: req.body.budget_currency || 'USD',
        client_name:     req.body.client_name || null,
        cover_image_url: req.body.cover_image_url || null,
        created_by:      req.body.created_by || null,
        documents:       Array.isArray(req.body.documents)    ? req.body.documents    : [],
        visualAssets:    Array.isArray(req.body.visualAssets) ? req.body.visualAssets : [],
        folder_slug:     req.body.folder_slug || fileSlugify(req.body.title || 'Untitled-Project'),
        folder_root:     req.body.folder_root || null,
        created_at:      now,
        updated_at:      now,
      };
      const bundle = emptyBundle(project);
      // Create the project folder on disk if a root is configured
      const cfg = readFilesConfig();
      const rootDir = project.folder_root || cfg.defaultRootDir;
      if (rootDir && fs.existsSync(rootDir)) {
        const projFolder = path.join(rootDir, project.folder_slug);
        if (!fs.existsSync(projFolder)) fs.mkdirSync(projFolder, { recursive: true });
        if (!project.folder_root) project.folder_root = projFolder;
      }
      // Create ASSETS/, _DATABASES/, _FILES/ sub-folders
      ensureProjectFolders(bundle);
      writeRabbitBundle(project.id, bundle);
      res.json(project);
    });

    expressApp.patch('/api/rabbit/projects/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.id);
      if (!bundle) return rabbitNotFound(res);
      const oldTitle = bundle.project.title;
      const oldSlug = bundle.project.folder_slug;
      bundle.project = { ...bundle.project, ...req.body, id: bundle.project.id };
      // If title changed, update folder_slug and rename folder
      if (req.body.title && req.body.title !== oldTitle) {
        const newSlug = fileSlugify(req.body.title);
        if (newSlug !== oldSlug && oldSlug) {
          const root = bundle.project.folder_root
            ? path.dirname(bundle.project.folder_root)
            : readFilesConfig().defaultRootDir;
          if (root) {
            const oldPath = path.join(root, oldSlug);
            const newPath = path.join(root, newSlug);
            if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
              try {
                fs.renameSync(oldPath, newPath);
                bundle.project.folder_root = newPath;
                // Rename slug-prefixed sub-folders inside the project folder
                for (const suffix of ['_DATABASES', '_FILES']) {
                  const op = path.join(newPath, oldSlug + suffix);
                  const np = path.join(newPath, newSlug + suffix);
                  if (fs.existsSync(op) && !fs.existsSync(np)) {
                    try { fs.renameSync(op, np); } catch (e2) { console.error(`subfolder rename ${suffix}:`, e2.message); }
                  }
                }
              } catch (e) { console.error('project folder rename failed:', e.message); }
            }
          }
        }
        bundle.project.folder_slug = newSlug;
      }
      writeRabbitBundle(req.params.id, bundle);
      res.json(bundle.project);
    });

    expressApp.delete('/api/rabbit/projects/:id', (req, res) => {
      const dir = path.join(getRabbitProjectsDir(), req.params.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      res.json({ ok: true });
    });

    // ── Generic sub-entity factory (phases, assets, tasks, …) ──
    // Each entity type lives as an array on the project bundle. The
    // factory generates POST/PATCH/DELETE routes that load → mutate
    // → save the whole bundle. Single-user, low write rate, fine.
    function rabbitSubentityRoutes(entityName, bundleKey) {
      // POST insert / upsert
      expressApp.post(`/api/rabbit/projects/:projectId/${entityName}`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const row = rabbitTouch({ ...req.body, project_id: req.params.projectId });
        const result = rabbitUpsertInto(bundle[bundleKey], row);
        writeRabbitBundle(req.params.projectId, bundle);
        res.json(result);
      });
      // PATCH
      expressApp.patch(`/api/rabbit/projects/:projectId/${entityName}/:id`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const arr = bundle[bundleKey];
        const idx = arr.findIndex(x => x.id === req.params.id);
        if (idx < 0) return rabbitNotFound(res, entityName);
        arr[idx] = { ...arr[idx], ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
        writeRabbitBundle(req.params.projectId, bundle);
        res.json(arr[idx]);
      });
      // DELETE
      expressApp.delete(`/api/rabbit/projects/:projectId/${entityName}/:id`, (req, res) => {
        const bundle = readRabbitBundle(req.params.projectId);
        if (!bundle) return rabbitNotFound(res);
        if (!bundle[bundleKey]) bundle[bundleKey] = [];
        const removed = rabbitRemoveFrom(bundle[bundleKey], req.params.id);
        if (!removed) return rabbitNotFound(res, entityName);
        writeRabbitBundle(req.params.projectId, bundle);
        res.json({ ok: true });
      });
    }

    rabbitSubentityRoutes('phases',         'phases');

    // ── Assets: custom routes with folder lifecycle side-effects ──
    // Replaces rabbitSubentityRoutes('assets','assets') so we can
    // create/rename/soft-delete OS folders when assets change.
    function resolveProjectFolderRoot(bundle) {
      const projectRoot = bundle.project?.folder_root;
      if (projectRoot && fs.existsSync(projectRoot)) return projectRoot;
      const cfg = readFilesConfig();
      if (!cfg.defaultRootDir) return null;
      const slug = fileSlugify(bundle.project?.title || 'Untitled-Project');
      return path.join(cfg.defaultRootDir, bundle.project?.folder_slug || slug);
    }
    function ensureAssetFolder(bundle, assetName) {
      const root = resolveProjectFolderRoot(bundle);
      if (!root) return null;
      const assetsDir = path.join(root, 'ASSETS');
      if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
      const assetSlug = fileSlugify(assetName || 'Untitled-Asset');
      const folderPath = path.join(assetsDir, assetSlug);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
      return { folderPath, assetSlug };
    }
    // POST — create/upsert asset + create folder
    expressApp.post('/api/rabbit/projects/:projectId/assets', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const row = rabbitTouch({ ...req.body, project_id: req.params.projectId });
      if (!row.folder_slug && row.name) row.folder_slug = fileSlugify(row.name);
      const result = rabbitUpsertInto(bundle.assets, row);
      ensureAssetFolder(bundle, result.name);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(result);
    });
    // PATCH — update asset + rename folder if name changed
    expressApp.patch('/api/rabbit/projects/:projectId/assets/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const idx = bundle.assets.findIndex(x => x.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'asset');
      const oldAsset = bundle.assets[idx];
      bundle.assets[idx] = { ...oldAsset, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      const newAsset = bundle.assets[idx];
      // Rename folder if name changed
      if (req.body.name && req.body.name !== oldAsset.name) {
        const root = resolveProjectFolderRoot(bundle);
        if (root) {
          const oldSlug = oldAsset.folder_slug || fileSlugify(oldAsset.name || 'Untitled-Asset');
          const newSlug = fileSlugify(req.body.name);
          const assetsDir = path.join(root, 'ASSETS');
          if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
          const oldPath = path.join(assetsDir, oldSlug);
          const newPath = path.join(assetsDir, newSlug);
          if (fs.existsSync(oldPath) && oldPath !== newPath) {
            try { fs.renameSync(oldPath, newPath); } catch (e) { console.error('folder rename failed:', e.message); }
          } else if (!fs.existsSync(newPath)) {
            fs.mkdirSync(newPath, { recursive: true });
          }
          newAsset.folder_slug = newSlug;
          // Update folder_path on managed files
          if (!bundle.managedFiles) bundle.managedFiles = [];
          const oldPrefix = 'ASSETS/' + oldSlug + '/';
          const newPrefix = 'ASSETS/' + newSlug + '/';
          for (const mf of bundle.managedFiles) {
            if (mf.asset_id === req.params.id && mf.folder_path) {
              mf.folder_path = mf.folder_path.replace(oldPrefix, newPrefix);
            }
          }
        }
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(newAsset);
    });
    // DELETE — soft-delete folder to .trash
    expressApp.delete('/api/rabbit/projects/:projectId/assets/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.assets) bundle.assets = [];
      const asset = bundle.assets.find(x => x.id === req.params.id);
      if (asset) {
        const root = resolveProjectFolderRoot(bundle);
        if (root) {
          const slug = asset.folder_slug || fileSlugify(asset.name || 'Untitled-Asset');
          const folderPath = path.join(root, 'ASSETS', slug);
          if (fs.existsSync(folderPath)) {
            const trashDir = path.join(root, '.trash');
            if (!fs.existsSync(trashDir)) fs.mkdirSync(trashDir, { recursive: true });
            const ts = Date.now();
            try { fs.renameSync(folderPath, path.join(trashDir, `${slug}_${ts}`)); } catch (e) { console.error('trash move failed:', e.message); }
          }
        }
        // Soft-delete managed files for this asset
        if (!bundle.managedFiles) bundle.managedFiles = [];
        const now = new Date().toISOString();
        for (const mf of bundle.managedFiles) {
          if (mf.asset_id === req.params.id) mf.deleted_at = now;
        }
      }
      rabbitRemoveFrom(bundle.assets, req.params.id);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    rabbitSubentityRoutes('tasks',          'tasks');
    rabbitSubentityRoutes('dependencies',   'dependencies');
    rabbitSubentityRoutes('task-links',     'taskLinks');
    rabbitSubentityRoutes('asset-versions', 'assetVersions');
    rabbitSubentityRoutes('comments',       'comments');
    rabbitSubentityRoutes('ingestion-runs', 'ingestionRuns');
    rabbitSubentityRoutes('team-assignments', 'teamAssignments');
    rabbitSubentityRoutes('budget-versions', 'budgetVersions');
    rabbitSubentityRoutes('expenses',        'expenses');
    rabbitSubentityRoutes('budget-lines',    'budgetLines');
    rabbitSubentityRoutes('budget-actuals',  'budgetActuals');
    rabbitSubentityRoutes('scenes',          'scenes');
    rabbitSubentityRoutes('shots',           'shots');
    rabbitSubentityRoutes('levels',          'levels');
    rabbitSubentityRoutes('experiences',     'experiences');
    rabbitSubentityRoutes('milestones',      'milestones');

    // ── Project Team: project-scoped copy of workspace team members ──
    // Bulk-sync: replaces projectTeam with the provided array of members
    expressApp.post('/api/rabbit/projects/:projectId/project-team/sync', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const members = Array.isArray(req.body.members) ? req.body.members : [];
      const now = new Date().toISOString();
      bundle.projectTeam = members.map(m => ({
        ...m,
        project_id: req.params.projectId,
        synced_at: now,
      }));
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.projectTeam);
    });
    // GET — list project team members
    expressApp.get('/api/rabbit/projects/:projectId/project-team', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      res.json(bundle.projectTeam || []);
    });
    // Individual CRUD via sub-entity factory
    rabbitSubentityRoutes('project-team',    'projectTeam');

    // ── Files: upload (base64 JSON payload) + download (binary stream) ──
    // Renderer reads File as ArrayBuffer, base64-encodes, POSTs JSON.
    // Server decodes and writes to {project_dir}/files/{file_id}-{name}.
    // Multipart was the original spec but base64 keeps us off a new dep
    // (multer/formidable) and works fine inside the existing 50mb json limit.
    expressApp.post('/api/rabbit/projects/:projectId/files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const { name, mimeType, sizeBytes, base64, scope = {} } = req.body || {};
      if (!name || !base64) return res.status(400).json({ error: 'name and base64 required' });

      const fileId = uuidv4();
      const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const diskName = `${fileId}-${safeName}`;
      const filesDir = resolveProjectFilesDir(bundle, req.params.projectId);
      fs.writeFileSync(path.join(filesDir, diskName), Buffer.from(base64, 'base64'));

      const row = rabbitTouch({
        id:               fileId,
        project_id:       req.params.projectId,
        phase_id:         scope.phaseId || null,
        asset_id:         scope.assetId || null,
        task_id:          scope.taskId  || null,
        name,
        mime_type:        mimeType || null,
        size_bytes:       sizeBytes ?? null,
        storage_provider: 'local_server',
        storage_path:     diskName,
        kind:             scope.kind || 'source',
        is_core_definer:  !!scope.isCoreDefiner,
        uploaded_at:      new Date().toISOString(),
      });
      bundle.files.push(row);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });

    expressApp.get('/api/rabbit/projects/:projectId/files/:id/download', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const file = bundle.files.find(f => f.id === req.params.id);
      if (!file) return rabbitNotFound(res, 'file');
      const diskPath = path.join(resolveProjectFilesDir(bundle, req.params.projectId), file.storage_path);
      if (!fs.existsSync(diskPath)) return res.status(410).json({ error: 'file body missing on disk' });
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.sendFile(diskPath);
    });

    expressApp.patch('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const idx = bundle.files.findIndex(f => f.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'file');
      bundle.files[idx] = { ...bundle.files[idx], ...req.body, id: req.params.id };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.files[idx]);
    });

    expressApp.delete('/api/rabbit/projects/:projectId/files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const file = bundle.files.find(f => f.id === req.params.id);
      if (file) {
        const diskPath = path.join(resolveProjectFilesDir(bundle, req.params.projectId), file.storage_path);
        if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
      }
      rabbitRemoveFrom(bundle.files, req.params.id);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    // ── Managed files (asset-folder-based, streaming, versioned) ──
    // These are the production file management routes. Files are copied
    // via IPC (not HTTP) to avoid body-size limits. The Express routes
    // only manage the JSON manifest records in the bundle.
    expressApp.get('/api/rabbit/projects/:projectId/managed-files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const files = (bundle.managedFiles || []).filter(f => !f.deleted_at);
      res.json(files);
    });

    expressApp.post('/api/rabbit/projects/:projectId/managed-files', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const now = new Date().toISOString();
      const projectSlug = bundle.project?.folder_slug || fileSlugify(bundle.project?.title || 'Untitled');
      const version = getNextVersion(bundle.managedFiles, req.body.file_name, req.body.asset_id);
      const vLabel = formatVersion(version);
      const ext = req.body.extension || '';
      const fileNameSlug = fileSlugify(req.body.file_name || 'File');
      const storedName = `${projectSlug}_${fileNameSlug}_${vLabel}${ext}`;

      // Build folder_path
      const asset = (bundle.assets || []).find(a => a.id === req.body.asset_id);
      const assetSlug = asset?.folder_slug || fileSlugify(asset?.name || 'Untitled-Asset');
      const folderPath = `ASSETS/${assetSlug}/`;

      const row = {
        id:               req.body.id || uuidv4(),
        project_id:       req.params.projectId,
        asset_id:         req.body.asset_id || null,
        task_id:          req.body.task_id || null,
        file_name:        req.body.file_name || 'Untitled',
        stored_name:      storedName,
        original_name:    req.body.original_name || '',
        extension:        ext,
        mime_type:        req.body.mime_type || null,
        size_bytes:       req.body.size_bytes || 0,
        version,
        version_label:    vLabel,
        folder_path:      folderPath,
        thumbnail_path:   null,
        uploaded_by:      req.body.uploaded_by || null,
        uploaded_at:      now,
        updated_at:       now,
        deleted_at:       null,
        notes:            req.body.notes || '',
        storage_provider: 'local_managed',
      };
      bundle.managedFiles.push(row);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });

    expressApp.patch('/api/rabbit/projects/:projectId/managed-files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const idx = bundle.managedFiles.findIndex(f => f.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'managed-file');
      bundle.managedFiles[idx] = {
        ...bundle.managedFiles[idx],
        ...req.body,
        id: req.params.id,
        updated_at: new Date().toISOString(),
      };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.managedFiles[idx]);
    });

    expressApp.delete('/api/rabbit/projects/:projectId/managed-files/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const hard = req.query.hard === 'true';
      if (hard) {
        const mf = bundle.managedFiles.find(f => f.id === req.params.id);
        if (mf) {
          // Delete physical file
          const root = resolveProjectFolderRoot(bundle);
          if (root) {
            const diskPath = path.join(root,
              ...(mf.folder_path || '').split('/').filter(Boolean),
              mf.stored_name);
            if (fs.existsSync(diskPath)) try { fs.unlinkSync(diskPath); } catch {}
          }
          // Delete thumbnail
          const thumbPath = path.join(getThumbCacheDir(), `${mf.id}.jpg`);
          if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
        }
        rabbitRemoveFrom(bundle.managedFiles, req.params.id);
      } else {
        // Soft delete
        const idx = bundle.managedFiles.findIndex(f => f.id === req.params.id);
        if (idx >= 0) bundle.managedFiles[idx].deleted_at = new Date().toISOString();
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ ok: true });
    });

    // Thumbnail endpoint — generates + caches a 256px-wide JPEG via sharp
    expressApp.get('/api/rabbit/projects/:projectId/managed-files/:id/thumbnail', async (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const mf = (bundle.managedFiles || []).find(f => f.id === req.params.id);
      if (!mf) return rabbitNotFound(res, 'managed-file');
      if (!isThumbableExt(mf.extension)) return res.status(415).json({ error: 'not an image' });
      const thumbDir = getThumbCacheDir();
      const thumbPath = path.join(thumbDir, `${mf.id}.jpg`);
      // Serve cached
      if (fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        return res.sendFile(thumbPath);
      }
      // Generate from source file
      const root = resolveProjectFolderRoot(bundle);
      if (!root) return res.status(404).json({ error: 'no file root configured' });
      const asset = (bundle.assets || []).find(a => a.id === mf.asset_id);
      const assetSlug = asset?.folder_slug || fileSlugify(asset?.name || 'Untitled-Asset');
      const srcPath = path.join(root, 'ASSETS', assetSlug, mf.stored_name);
      if (!fs.existsSync(srcPath)) return res.status(410).json({ error: 'source file missing' });
      try {
        await sharp(srcPath).resize(256).jpeg({ quality: 80 }).toFile(thumbPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.sendFile(thumbPath);
      } catch (err) {
        console.error('thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'thumbnail generation failed' });
      }
    });

    // ── Asset thumbnail endpoint ──
    // Serves a cached 512px JPEG thumbnail for an asset's thumbnail_image.
    expressApp.get('/api/rabbit/projects/:projectId/assets/:id/thumbnail', async (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const asset = (bundle.assets || []).find(a => a.id === req.params.id);
      if (!asset) return rabbitNotFound(res, 'asset');
      if (!asset.thumbnail_image) return res.status(404).json({ error: 'no thumbnail set' });

      const thumbDir = getThumbCacheDir();
      const thumbPath = path.join(thumbDir, `asset-${asset.id}.jpg`);

      // Serve cached version if it exists and source hasn't changed
      if (fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.sendFile(thumbPath);
      }

      // Generate from source
      const srcPath = asset.thumbnail_image;
      if (!fs.existsSync(srcPath)) return res.status(410).json({ error: 'source image missing' });

      try {
        await sharp(srcPath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.sendFile(thumbPath);
      } catch (err) {
        console.error('asset thumbnail generation failed:', err.message);
        res.status(500).json({ error: 'thumbnail generation failed' });
      }
    });

    // Import existing folder structure into managed files manifest
    expressApp.post('/api/rabbit/projects/:projectId/managed-files/import-folder', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.managedFiles) bundle.managedFiles = [];
      const { folderPath } = req.body;
      if (!folderPath || !fs.existsSync(folderPath)) {
        return res.status(400).json({ error: 'folderPath does not exist' });
      }
      const now = new Date().toISOString();
      const projectSlug = bundle.project?.folder_slug || fileSlugify(bundle.project?.title || 'Untitled');
      const created = [];
      // Scan top-level subdirs as asset folders
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === '_manifest.json') continue;
        const assetSlug = entry.name;
        // Find or create matching asset
        let asset = (bundle.assets || []).find(a =>
          (a.folder_slug || fileSlugify(a.name || '')) === assetSlug
        );
        if (!asset) {
          asset = rabbitTouch({ name: assetSlug.replace(/-/g, ' '), type: 'other', status: 'not_started', folder_slug: assetSlug, project_id: req.params.projectId });
          if (!bundle.assets) bundle.assets = [];
          bundle.assets.push(asset);
        }
        // Scan files inside the asset folder
        const assetDir = path.join(folderPath, assetSlug);
        const files = fs.readdirSync(assetDir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || file.name.startsWith('.')) continue;
          const ext = path.extname(file.name);
          const baseName = path.basename(file.name, ext);
          const stats = fs.statSync(path.join(assetDir, file.name));
          const row = {
            id:               uuidv4(),
            project_id:       req.params.projectId,
            asset_id:         asset.id,
            task_id:          null,
            file_name:        baseName,
            stored_name:      file.name,
            original_name:    file.name,
            extension:        ext,
            mime_type:        null,
            size_bytes:       stats.size,
            version:          1,
            version_label:    'v001',
            folder_path:      `ASSETS/${assetSlug}/`,
            thumbnail_path:   null,
            uploaded_by:      null,
            uploaded_at:      now,
            updated_at:       now,
            deleted_at:       null,
            notes:            '',
            storage_provider: 'local_managed',
          };
          bundle.managedFiles.push(row);
          created.push(row);
        }
      }
      writeRabbitBundle(req.params.projectId, bundle);
      res.json({ imported: created.length, files: created });
    });

    // ── Ingestion chunks (live in their own array on the bundle) ──
    expressApp.post('/api/rabbit/projects/:projectId/ingestion-chunks', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.ingestionChunks) bundle.ingestionChunks = [];
      const row = rabbitTouch({ ...req.body });
      rabbitUpsertInto(bundle.ingestionChunks, row);
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(row);
    });
    expressApp.patch('/api/rabbit/projects/:projectId/ingestion-chunks/:id', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      if (!bundle.ingestionChunks) bundle.ingestionChunks = [];
      const idx = bundle.ingestionChunks.findIndex(c => c.id === req.params.id);
      if (idx < 0) return rabbitNotFound(res, 'chunk');
      bundle.ingestionChunks[idx] = { ...bundle.ingestionChunks[idx], ...req.body, id: req.params.id };
      writeRabbitBundle(req.params.projectId, bundle);
      res.json(bundle.ingestionChunks[idx]);
    });
    expressApp.get('/api/rabbit/projects/:projectId/ingestion-runs/:runId/chunks', (req, res) => {
      const bundle = readRabbitBundle(req.params.projectId);
      if (!bundle) return rabbitNotFound(res);
      const chunks = (bundle.ingestionChunks || []).filter(c => c.run_id === req.params.runId);
      res.json(chunks);
    });

    // ── Rate cards (workspace-scoped, separate from project bundles) ──
    function getRateCardsDir() {
      const dir = path.join(getRabbitDataDir(), 'rate-cards');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function rateCardPath(id) { return path.join(getRateCardsDir(), `${id}.json`); }

    expressApp.get('/api/rabbit/workspaces/:workspaceId/rate-cards', (req, res) => {
      const dir = getRateCardsDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(card => card.card?.workspace_id === req.params.workspaceId);
      res.json(list.map(c => c.card));
    });
    expressApp.post('/api/rabbit/workspaces/:workspaceId/rate-cards', (req, res) => {
      const card = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      const existing = readJSON(rateCardPath(card.id), null);
      const stored = { card, entries: existing?.entries || [] };
      writeJSON(rateCardPath(card.id), stored);
      res.json(card);
    });
    expressApp.delete('/api/rabbit/rate-cards/:id', (req, res) => {
      const p = rateCardPath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });
    expressApp.get('/api/rabbit/rate-cards/:id/entries', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      res.json(stored?.entries || []);
    });
    expressApp.post('/api/rabbit/rate-cards/:id/entries', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      const entry = rabbitTouch({ ...req.body, rate_card_id: req.params.id });
      rabbitUpsertInto(stored.entries, entry);
      writeJSON(rateCardPath(req.params.id), stored);
      res.json(entry);
    });
    expressApp.delete('/api/rabbit/rate-cards/:id/entries/:entryId', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      rabbitRemoveFrom(stored.entries, req.params.entryId);
      writeJSON(rateCardPath(req.params.id), stored);
      res.json({ ok: true });
    });

    // ── Department defaults (per rate card) ────────
    expressApp.get('/api/rabbit/rate-cards/:id/dept-defaults', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      res.json(stored?.dept_defaults || []);
    });
    expressApp.post('/api/rabbit/rate-cards/:id/dept-defaults', (req, res) => {
      const stored = readJSON(rateCardPath(req.params.id), null);
      if (!stored) return rabbitNotFound(res, 'rate card');
      if (!stored.dept_defaults) stored.dept_defaults = [];
      const dept = req.body.department;
      const idx = stored.dept_defaults.findIndex(d => d.department === dept);
      if (idx >= 0) {
        stored.dept_defaults[idx] = { ...stored.dept_defaults[idx], ...req.body };
      } else {
        stored.dept_defaults.push(req.body);
      }
      writeJSON(rateCardPath(req.params.id), stored);
      res.json(stored.dept_defaults);
    });

    // ── Team members (workspace-scoped, like rate cards) ────────
    function getTeamMembersDir() {
      const dir = path.join(getRabbitDataDir(), 'team-members');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function teamMemberPath(id) { return path.join(getTeamMembersDir(), `${id}.json`); }

    expressApp.get('/api/rabbit/workspaces/:workspaceId/team-members', (req, res) => {
      const dir = getTeamMembersDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(m => m.workspace_id === req.params.workspaceId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });
    expressApp.post('/api/rabbit/workspaces/:workspaceId/team-members', (req, res) => {
      const member = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      writeJSON(teamMemberPath(member.id), member);
      res.json(member);
    });
    expressApp.patch('/api/rabbit/team-members/:id', (req, res) => {
      const existing = readJSON(teamMemberPath(req.params.id), null);
      if (!existing) return rabbitNotFound(res, 'team member');
      const updated = { ...existing, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      writeJSON(teamMemberPath(updated.id), updated);
      res.json(updated);
    });
    expressApp.delete('/api/rabbit/team-members/:id', (req, res) => {
      const p = teamMemberPath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });

    // ── Task templates (workspace-scoped, like rate cards) ────────
    function getTaskTemplatesDir() {
      const dir = path.join(getRabbitDataDir(), 'task-templates');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    function taskTemplatePath(id) { return path.join(getTaskTemplatesDir(), `${id}.json`); }

    // List global templates for a workspace
    expressApp.get('/api/rabbit/workspaces/:workspaceId/task-templates', (req, res) => {
      const dir = getTaskTemplatesDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const list = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean)
        .filter(t => t.workspace_id === req.params.workspaceId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });

    // List templates available to a project (global + project-specific)
    expressApp.get('/api/rabbit/projects/:projectId/task-templates', (req, res) => {
      const dir = getTaskTemplatesDir();
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      const all = files.map(f => readJSON(path.join(dir, f), null)).filter(Boolean);
      // Return global (no project_id) + project-specific
      const list = all.filter(t => !t.project_id || t.project_id === req.params.projectId);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      res.json(list);
    });

    expressApp.post('/api/rabbit/workspaces/:workspaceId/task-templates', (req, res) => {
      const template = rabbitTouch({ ...req.body, workspace_id: req.params.workspaceId });
      writeJSON(taskTemplatePath(template.id), template);
      res.json(template);
    });

    expressApp.patch('/api/rabbit/task-templates/:id', (req, res) => {
      const existing = readJSON(taskTemplatePath(req.params.id), null);
      if (!existing) return rabbitNotFound(res, 'task template');
      const updated = { ...existing, ...req.body, id: req.params.id, updated_at: new Date().toISOString() };
      writeJSON(taskTemplatePath(updated.id), updated);
      res.json(updated);
    });

    expressApp.delete('/api/rabbit/task-templates/:id', (req, res) => {
      const p = taskTemplatePath(req.params.id);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      res.json({ ok: true });
    });

    // ── PDF text extraction (used by RABBIT intake pipeline) ──
    // Accepts a JSON body with `{ name, dataUrl }` where `dataUrl` is a
    // base64 data URL of the PDF. Returns `{ text, numPages }`. We
    // lazy-load pdf-parse so server startup isn't penalized when no
    // intake is running.
    expressApp.post('/api/extract-pdf', async (req, res) => {
      try {
        const { dataUrl, name } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') {
          return res.status(400).json({ error: 'dataUrl is required' });
        }
        const comma = dataUrl.indexOf(',');
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        const buffer = Buffer.from(base64, 'base64');
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(buffer);
        res.json({
          name: name || null,
          text: data.text || '',
          numPages: data.numpages || 0,
        });
      } catch (err) {
        console.error('[RABBIT] /api/extract-pdf failed:', err);
        res.status(500).json({ error: err.message || 'extract-pdf failed' });
      }
    });

    // ── Static file serving (SPA fallback) ──
    expressApp.use(express.static(distPath));
    expressApp.get('/{*splat}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });

    const server = expressApp.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });

    server.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════
//  ELECTRON WINDOW
// ═══════════════════════════════════════════════════════════════════
let mainWindow;
let localServer;

async function createWindow() {
  const distPath = path.join(__dirname, '..', 'dist');

  const { server, port } = await startLocalServer(distPath);
  localServer = server;

  const iconPath = path.join(__dirname, '..', 'public', 'logo.ico');
  const hasIcon = fs.existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    icon: hasIcon ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Block browser refresh — reset zoom instead
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isCtrl = input.control || input.meta;
    if ((isCtrl && input.key.toLowerCase() === 'r') || input.key === 'F5') {
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
      mainWindow.webContents.send('zoom-reset-notify', 0);
    }
  });

  // Open external links in system browser instead of new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', (e) => {
    if (mainWindow._forceClose) return;
    e.preventDefault();
    mainWindow.webContents.send('close-requested');
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── RABBIT config IPC (Supabase + future Drive credentials) ──
// These read/write small JSON files inside the rabbit-data root.
// Express routes for actual project data live in §3 (Local Server adapter).
ipcMain.handle('rabbit:read-supabase-config', () => {
  const cfgPath = path.join(getRabbitDataDir(), 'supabase.json');
  return readJSON(cfgPath, null);
});
ipcMain.handle('rabbit:write-supabase-config', (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') throw new Error('rabbit:write-supabase-config: payload must be an object');
  writeJSON(path.join(getRabbitDataDir(), 'supabase.json'), cfg);
  return { ok: true };
});
ipcMain.handle('rabbit:clear-supabase-config', () => {
  const cfgPath = path.join(getRabbitDataDir(), 'supabase.json');
  if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  return { ok: true };
});

// ── RABBIT Google Drive credentials IPC ──
// gdrive-config.json holds { clientId, clientSecret, redirectUri, rootFolderId }
// gdrive-tokens.json holds { accessToken, refreshToken, expiresAt }
// Both are written by the Settings/Connect flow and consumed by the
// googleDriveAdapter in the renderer.
ipcMain.handle('rabbit:read-gdrive-config', () => {
  return readJSON(path.join(getRabbitDataDir(), 'gdrive-config.json'), null);
});
ipcMain.handle('rabbit:write-gdrive-config', (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') throw new Error('rabbit:write-gdrive-config: payload must be an object');
  writeJSON(path.join(getRabbitDataDir(), 'gdrive-config.json'), cfg);
  return { ok: true };
});
ipcMain.handle('rabbit:read-gdrive-tokens', () => {
  return readJSON(path.join(getRabbitDataDir(), 'gdrive-tokens.json'), null);
});
ipcMain.handle('rabbit:write-gdrive-tokens', (_event, tokens) => {
  if (!tokens || typeof tokens !== 'object') throw new Error('rabbit:write-gdrive-tokens: payload must be an object');
  writeJSON(path.join(getRabbitDataDir(), 'gdrive-tokens.json'), tokens);
  return { ok: true };
});
ipcMain.handle('rabbit:clear-gdrive', () => {
  for (const f of ['gdrive-config.json', 'gdrive-tokens.json']) {
    const p = path.join(getRabbitDataDir(), f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  return { ok: true };
});

// ── RABBIT file management IPC ──────────────────────────────
// Config: read/write the default root directory for project files.
ipcMain.handle('rabbit:read-files-config', () => readFilesConfig());
ipcMain.handle('rabbit:write-files-config', (_event, cfg) => {
  if (!cfg || typeof cfg !== 'object') throw new Error('payload must be an object');
  writeFilesConfig({ ...readFilesConfig(), ...cfg });
  return { ok: true };
});

// Directory picker: opens OS file explorer dialog to select a folder.
ipcMain.handle('rabbit:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select folder location',
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// File picker: opens OS file explorer dialog to select files.
ipcMain.handle('rabbit:pick-files', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to add',
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// Streaming file copy: copies a file from source to destination using
// streams for multi-GB support. Reports progress via IPC events.
ipcMain.handle('rabbit:copy-file', async (event, { sourcePath, destDir, destFileName }) => {
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
});

// Get file stats without reading the file
ipcMain.handle('rabbit:get-file-stats', (_event, { filePath }) => {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return { size: stat.size, mtime: stat.mtime.toISOString(), isFile: stat.isFile() };
});

// Open file or folder in OS file explorer
ipcMain.handle('rabbit:open-in-explorer', (_event, { filePath }) => {
  if (fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  return { ok: true };
});

// Pick an image file for asset thumbnail
ipcMain.handle('rabbit:pick-image', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select thumbnail image',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'avif'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Set asset thumbnail: picks source path, generates cached thumbnail via sharp.
// Call AFTER updating the asset's thumbnail_image property in the bundle.
ipcMain.handle('rabbit:generate-asset-thumbnail', async (_event, { assetId, sourcePath }) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('source image does not exist');
  }
  const thumbDir = getThumbCacheDir();
  const thumbPath = path.join(thumbDir, `asset-${assetId}.jpg`);
  await sharp(sourcePath).resize(512).jpeg({ quality: 85 }).toFile(thumbPath);
  return { ok: true, thumbPath };
});

// Clear a cached asset thumbnail
ipcMain.handle('rabbit:clear-asset-thumbnail', (_event, { assetId }) => {
  const thumbPath = path.join(getThumbCacheDir(), `asset-${assetId}.jpg`);
  if (fs.existsSync(thumbPath)) try { fs.unlinkSync(thumbPath); } catch {}
  return { ok: true };
});

// Ensure a project folder exists on disk (called when creating projects or changing root)
ipcMain.handle('rabbit:ensure-project-folder', (_event, { rootDir, projectSlug }) => {
  const folderPath = path.join(rootDir, projectSlug);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  return { ok: true, folderPath };
});

// Window control IPC handlers
ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => {
  if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); }
});
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window-force-close', () => {
  if (mainWindow) { mainWindow._forceClose = true; mainWindow.close(); }
});

// Zoom IPC handlers
ipcMain.handle('zoom-in', () => {
  if (mainWindow) { const wc = mainWindow.webContents; const c = wc.getZoomLevel(); if (c < 5) wc.setZoomLevel(c + 0.5); return wc.getZoomLevel(); }
});
ipcMain.handle('zoom-out', () => {
  if (mainWindow) { const wc = mainWindow.webContents; const c = wc.getZoomLevel(); if (c > -5) wc.setZoomLevel(c - 0.5); return wc.getZoomLevel(); }
});
ipcMain.handle('zoom-reset', () => { if (mainWindow) { mainWindow.webContents.setZoomLevel(0); return 0; } });
ipcMain.handle('zoom-get', () => { if (mainWindow) return mainWindow.webContents.getZoomLevel(); return 0; });

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  app.quit();
});

app.on('activate', () => { if (mainWindow === null) createWindow(); });
