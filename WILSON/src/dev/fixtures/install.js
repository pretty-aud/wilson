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
import { createStore, clone, now, findById, applyGameVariant, applyMemberVariant, applyWorkspaceManagerVariant, applyNetworkStorageVariant, applyMothTagsVariant, fixturePerson, fixtureVariant, binsFixtureMode, connectionFixtureMode, storageFixtureMode } from './store'
import { createRabbitFixturesAdapter } from './rabbitFixturesAdapter'
import { createOtterFixturesHandler } from './otterFixturesRoutes'
import { createGatewayFixtures, gatewayFixtureMode } from './gatewayFixtures'
// GW3: the gateway's doors in the page (the probe, the tickets, the bytes).
import { createGatewayDoorsStub } from './gatewayDoors'
import { createAIFileStoreFixture, aiFilesFixtureMode } from './aiFileStoreFixture'
import { PERMISSIONS, PROFILE, WORKSPACE_ID } from './data/workspace'
import { PROJECT } from './data/project'
import { BUILTIN } from '../../lib/aiModels'

// `variant: 'game'` (the page loaded with `?fixtures=game`) switches Salt
// Hours' levels and experiences on — B4's walk screens for those two views.
// `variant: 'member'` (S4b) seats the reviewer as a plain project member, so
// the money gate's absences can be seen (store.applyMemberVariant).
// `variant: 'manager'` (S4d) makes her a workspace manager with a member
// seat: the Legal gate's presences beside the money gate's absences
// (store.applyWorkspaceManagerVariant).
// `bins: 'browser'` (BC3, `?bins=browser`) makes the bins answer as the cloud
// does in a browser: no row reachable (store.binsFixtureMode).
// `connection: 'files-down' | 'offline'` (FX11, `?connection=…`) is what the
// connection dot hears: amber, then red (store.connectionFixtureMode).
// `storage: 'network'` (MO1, `?storage=network`) is a company on its office server (store.applyNetworkStorageVariant).
// MO3 (walkthrough 96): `variant: 'tags'` (`?fixtures=tags`) seeds Session 3's notes, typed tags and links
// (store.applyMothTagsVariant); `person` (`?as=theo`) acts as another fixture person (store.fixturePerson).
export function buildDevFixtures({ variant = null, bins = null, connection = null, storage = null, person = null } = {}) {
  const store = createStore()
  const userId = person?.user_id || PERMISSIONS.userId
  if (variant === 'game') applyGameVariant(store)
  if (variant === 'member') applyMemberVariant(store, userId)
  if (variant === 'manager') applyWorkspaceManagerVariant(store, userId)
  if (variant === 'tags') applyMothTagsVariant(store)
  if (storage === 'network') applyNetworkStorageVariant(store, userId)
  const appRole = variant === 'member' ? 'user' : variant === 'manager' ? 'manager' : (person?.app_role || PERMISSIONS.role)
  const identity = { userId, workspaceId: WORKSPACE_ID, appRole }
  const adapterOptions = { browser: bins === 'browser', connection }
  let rabbitAdapter = null
  const gatewayDoors = createGatewayDoorsStub(store, identity)

  return {
    label: PROJECT.title,
    store,
    permissions: { ...PERMISSIONS, userId, role: appRole },
    profile: { ...PROFILE, ...(person ? { email: person.email } : {}) },
    bins: true,
    // What workspaceStorage.js answers. Null: as before, it asks the real client, which a fixtures build has not got.
    workspaceStorage: store.workspaceStorage ?? null,

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
      if (!rabbitAdapter) rabbitAdapter = createRabbitFixturesAdapter(store, identity, adapterOptions)
      return rabbitAdapter
    },

    otter: createOtterFixturesHandler(store, identity),

    /**
     * GW1: what src/cloud/gatewayApi.js answers from — Settings, Storage,
     * File gateway and the Bins inspector's one line, without a database.
     * `?gateways=empty` starts before the company's first gateway.
     */
    gateways: createGatewayFixtures(store, identity, { mode: gatewayFixtureMode(), doors: gatewayDoors }),

    /**
     * GW3: what the Bins tab's gateway adapter talks to instead of a gateway
     * on the network — the probe, the tickets, the bytes (a bundled clip of
     * random frames), the renewal — so port 5289 plays a clip "through the
     * gateway" with no listener. `?gateway=outside` puts the viewer's mark
     * over every player; `?gateway=none|unseen|unreachable` are §2's cases.
     */
    gatewayDoors,

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
          return { user_id: m.user_id, project_id: m.project_id, projects: p ? { title: p.title, deleted_at: p.deleted_at ?? null, personal_owner_id: p.personal_owner_id ?? null } : null }
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

    /**
     * FX12: what src/cloud/aiFiles.js's list and sweep answer from (the Admin
     * Terminal's "The AI's file store" card), since the real store is reached
     * only signed in. `?aiFiles=empty|error` are the card's other states.
     */
    aiFiles: createAIFileStoreFixture({ mode: aiFilesFixtureMode() }),
  }
}

installDevFixtures(buildDevFixtures({ variant: fixtureVariant(), bins: binsFixtureMode(), connection: connectionFixtureMode(), storage: storageFixtureMode(), person: fixturePerson() }))
