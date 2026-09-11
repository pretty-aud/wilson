// =============================================================================
// install.js — the ONE entry point for the fixture backends.
//
// main.jsx dynamic-imports this file, on a line guarded by
// `import.meta.env.DEV && devFixturesConfigured()`, BEFORE React renders, so
// by the time RabbitProvider's boot effect calls selectAdapter() the registry
// is filled and the choice is synchronous. Nothing else imports this module or
// anything under src/dev/fixtures/ (devFixtures.test.js pins that), which is
// what lets `vite build` drop the whole directory.
// =============================================================================

import { installDevFixtures } from '../devFixtures'
import { createStore, clone, now, findById } from './store'
import { createRabbitFixturesAdapter } from './rabbitFixturesAdapter'
import { createOtterFixturesHandler } from './otterFixturesRoutes'
import { PERMISSIONS, PROFILE, WORKSPACE_ID } from './data/workspace'
import { PROJECT } from './data/project'
import { BUILTIN } from '../../lib/aiModels'

export function buildDevFixtures() {
  const store = createStore()
  const identity = { userId: PERMISSIONS.userId, workspaceId: WORKSPACE_ID }
  let rabbitAdapter = null

  return {
    label: PROJECT.title,
    store,
    permissions: { ...PERMISSIONS },
    profile: { ...PROFILE },
    bins: true,

    /**
     * modelSources.loadApprovedModels: what the pickers may offer (the
     * platform_approved_models shape). Derived from the registry's built-in
     * floors — a model id is written in exactly one file in src/
     * (noHardcodedModels.test.js), and this is not it.
     */
    approvedModels: Object.entries(BUILTIN).map(([tier, model_id], i) => ({
      model_id,
      label: `${model_id} (built-in ${tier.toLowerCase()})`,
      hint: tier === 'REASONING' ? "The registry's reasoning floor." : "The registry's fast floor.",
      sort_order: i,
      validation: null,
    })),

    /** One adapter per session — the provider's adapterRef holds it. */
    rabbitAdapter() {
      if (!rabbitAdapter) rabbitAdapter = createRabbitFixturesAdapter(store, identity)
      return rabbitAdapter
    },

    otter: createOtterFixturesHandler(store, identity),

    /** What useWorkspaceMembers / ProfileSection read and write. */
    workspace: {
      listMembers() { return clone(store.members) },
      getMember(userId) { const m = store.members.find(r => r.user_id === userId); return m ? clone(m) : null },
      /** PostgREST-shaped answer so the hook's success path is unchanged. */
      updateMember(userId, fields) {
        const i = store.members.findIndex(r => r.user_id === userId)
        if (i === -1) return { data: null, error: { message: 'no such member' } }
        store.members[i] = { ...store.members[i], ...fields, updated_at: now() }
        return { data: clone(store.members[i]), error: null }
      },
      memberById(id) { return findById(store.members.map(m => ({ ...m, id: m.user_id })), id) },
      /** TeamMembersPage's per-member project list: PostgREST-shaped rows. */
      listProjectMemberships() {
        const data = store.projectMembers.map(m => {
          const p = findById(store.projects, m.project_id)
          return { user_id: m.user_id, project_id: m.project_id, projects: p ? { title: p.title, deleted_at: p.deleted_at ?? null } : null }
        })
        return { data: clone(data), error: null }
      },
    },

    /** userState.js's cloud mirror of the pet and the prompt settings. */
    userState: {
      getPet() { return store.userPet ? clone(store.userPet) : null },
      setPet(pet) { store.userPet = clone(pet) },
      getSettings() { return store.userSettings ? clone(store.userSettings) : null },
      setSettings(s) { store.userSettings = clone(s) },
    },
  }
}

installDevFixtures(buildDevFixtures())
