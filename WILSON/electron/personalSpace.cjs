'use strict';
// MO1 (MOTH_DESIGN §2.2 DT-1, PSA-05, PSA-06, SEC-7): the signed-out desktop's
// personal space. One per computer and OS user, under userData and OUTSIDE
// rabbit-data, so a shared or copied data folder carries none, and neither the
// migration nor archive-and-clear reaches it:
//   {userData}/personal-space/project.json   the bundle
//   {userData}/personal-space/files          its bodies
//
// The existing files, folders and managed-files routes serve it: main.cjs asks
// `dirFor` before it resolves a project's directory. The project row itself
// never changes after it is made (DELETE and PATCH answer 409), and an ordinary
// project cannot claim to be one (POST and PATCH drop the two fields).

const REFUSAL = 'a personal space cannot be deleted or changed; its files can';
const PROJECT_FIELDS = ['personal', 'personal_owner_id'];

function createPersonalSpace({ fs, path, userDataDir, newId }) {
  const dir = path.join(userDataDir, 'personal-space');
  const bundleFile = path.join(dir, 'project.json');
  const filesDir = path.join(dir, 'files');
  let knownId = null;

  // The id on disk: minted once, read once. No side effects: nothing is created
  // by asking. A file that is there and cannot be read answers `unreadable`,
  // never "none", so nothing writes a new bundle over it.
  function onDisk() {
    if (!fs.existsSync(bundleFile)) return { id: null, unreadable: false };
    try {
      const project = JSON.parse(fs.readFileSync(bundleFile, 'utf-8'))?.project;
      if (project?.personal === true && typeof project.id === 'string' && project.id) return { id: project.id, unreadable: false };
    } catch { /* below */ }
    return { id: null, unreadable: true };
  }
  function currentId() {
    const { id } = onDisk();
    knownId = id;
    return id;
  }
  function isPersonalId(projectId) {
    const known = knownId || currentId();
    return !!known && String(projectId) === known;
  }
  // Only the bundle AT this directory is the personal space: a project in the
  // data folder that says `personal: true` (somebody else's copied bundle) is an
  // ordinary project.
  function isPersonalBundle(bundle) {
    return bundle?.project?.personal === true && isPersonalId(bundle.project.id);
  }
  function dirFor(projectId) {
    if (!isPersonalId(projectId)) return null;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  function filesDirFor(projectId) {
    if (!isPersonalId(projectId)) return null;
    if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
    return filesDir;
  }
  // A new id for the bundle the caller is about to write. Null when one is
  // there, or when one that cannot be read is in the way (the route says so).
  function mint() {
    const { id, unreadable } = onDisk();
    if (id || unreadable) return null;
    knownId = newId();
    return knownId;
  }
  function unreadable() {
    return onDisk().unreadable;
  }
  return { dirFor, filesDirFor, currentId, isPersonalId, isPersonalBundle, mint, unreadable, dir, filesDir };
}

// GET answers `{ project }`, null when there is none, and makes nothing.
// POST is check-and-create in one synchronous handler: two POSTs make one space.
function mountPersonalSpace(expressApp, { space, emptyBundle, readRabbitBundle, writeRabbitBundle }) {
  // Ahead of the project routes (mounted before them), which stay as they were.
  // The row never changes; a relink would point its bodies somewhere else; and a
  // body cannot make an ordinary project into one, or write over this one.
  const refuse = (res) => res.status(409).json({ error: REFUSAL, code: 'personal_space' });
  const stripFields = (body) => {
    if (body && typeof body === 'object') for (const k of PROJECT_FIELDS) delete body[k];
  };
  expressApp.delete('/api/rabbit/projects/:id', (req, res, next) => (space.isPersonalId(req.params.id) ? refuse(res) : next()));
  expressApp.patch('/api/rabbit/projects/:id', (req, res, next) => {
    if (space.isPersonalId(req.params.id)) return refuse(res);
    stripFields(req.body);
    return next();
  });
  expressApp.post('/api/rabbit/projects', (req, res, next) => {
    if (req.body?.id && space.isPersonalId(req.body.id)) return refuse(res);
    stripFields(req.body);
    return next();
  });
  expressApp.post('/api/rabbit/projects/:projectId/files/relink-apply', (req, res, next) => (space.isPersonalId(req.params.projectId) ? refuse(res) : next()));

  expressApp.get('/api/rabbit/personal-space', (req, res) => {
    const id = space.currentId();
    if (!id && space.unreadable()) return res.status(409).json({ error: 'the personal space on this computer could not be read', code: 'unreadable' });
    res.json({ project: id ? (readRabbitBundle(id)?.project ?? null) : null });
  });
  expressApp.post('/api/rabbit/personal-space', (req, res) => {
    const had = space.currentId();
    if (had) return res.json(readRabbitBundle(had)?.project ?? null);
    const id = space.mint();
    if (!id) return res.status(409).json({ error: 'the personal space on this computer could not be read', code: 'unreadable' });
    const now = new Date().toISOString();
    const bundle = emptyBundle({ id, title: 'Personal space', personal: true, status: 'active', created_at: now, updated_at: now });
    // It holds no label from S4a's period, as any project made today
    // (POST /api/rabbit/projects says why this is settled at birth).
    bundle.legalLabelsSettled = { at: now, stripped: [] };
    writeRabbitBundle(id, bundle);
    res.json(bundle.project);
  });
}

module.exports = { createPersonalSpace, mountPersonalSpace };
