const { app, BrowserWindow, ipcMain, shell } = require('electron');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

function readJSON(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return fallback; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

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
