// =============================================================================
// folderPaths.test.js — Session 26.
//
// The planner decides where every folder goes on every backend. It is pure,
// so it is cheap to pin properly — and it needs pinning, because its output
// becomes a `path` that is concatenated onto a filesystem root and onto a
// storage prefix. A wrong string here is a directory in the wrong place, or
// outside the project entirely.
//
// folderParity.test.js covers the OTHER half: that electron/main.cjs's
// unavoidable duplicate of this logic still agrees with it.
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  FOLDER_CATEGORIES, ENTITY_FK_COLUMN,
  projectFolderSlug, categoryForEntityType, entityFolderSlug, entityFolderPath,
  planProjectFolders, planEntityFolder, planFullTree,
} from './folderPaths'

const FILM = { id: 'p1', title: 'Hero Film 2026' }
const GAME = {
  id: 'p2', title: 'Space Game',
  scenes_enabled: true, levels_enabled: true, experiences_enabled: true,
}


describe('projectFolderSlug', () => {
  it('prefers the persisted slug over the title', () => {
    // The point of persisting it: renaming the project must not move the
    // folder out from under everything already filed in it.
    expect(projectFolderSlug({ title: 'Renamed Later', folder_slug: 'Hero-Film-2026' }))
      .toBe('Hero-Film-2026')
  })

  it('falls back to the title when there is no slug yet', () => {
    expect(projectFolderSlug(FILM)).toBe('Hero-Film-2026')
  })

  it('has a fallback for a project with no title at all', () => {
    expect(projectFolderSlug({})).toBe('Untitled-Project')
    expect(projectFolderSlug(null)).toBe('Untitled-Project')
  })
})


describe('planProjectFolders — which categories a project gets', () => {
  it('gives every project a root whose path is empty', () => {
    // The root's path is '' because `path` is measured FROM the root. 0041's
    // folders_root_path_chk ties the two together in the database.
    const root = planProjectFolders(FILM)[0]
    expect(root.kind).toBe('root')
    expect(root.path).toBe('')
    expect(root.parentPath).toBeNull()
    expect(root.slug).toBe('Hero-Film-2026')
  })

  it('creates only the unconditional categories for a plain film project', () => {
    // 🚨 The reveal flags default FALSE (0040), so a film project must NOT
    // get a LEVELS folder. Creating all six always would satisfy "toggling
    // off never deletes" trivially, by never creating anything to delete —
    // and would litter every film project with folders for game features.
    const paths = planProjectFolders(FILM).map(f => f.path)
    expect(paths).toEqual(['', 'ASSETS', 'INVOICES'])
  })

  it('reveals SCENES and SHOTS together on scenes_enabled', () => {
    // One flag, two categories: there is no shots_enabled anywhere in the
    // app, and a SHOTS folder with no SCENES folder makes no sense.
    const paths = planProjectFolders({ ...FILM, scenes_enabled: true }).map(f => f.path)
    expect(paths).toEqual(['', 'ASSETS', 'SCENES', 'SHOTS', 'INVOICES'])
  })

  it('gives a fully enabled project all six', () => {
    expect(planProjectFolders(GAME).map(f => f.path)).toEqual(
      ['', 'ASSETS', 'SCENES', 'SHOTS', 'LEVELS', 'EXPERIENCES', 'INVOICES'],
    )
  })

  it('parents every category on the root', () => {
    for (const f of planProjectFolders(GAME).slice(1)) {
      expect(f.parentPath).toBe('')
      expect(f.kind).toBe('category')
    }
  })

  it('plans NOTHING for a disabled category — which is what makes toggling off safe', () => {
    // Audrey, 2026-08-03: toggling a category off "should only remove it from
    // the R.A.B.B.I.T. view and never delete the folders". This is the
    // mechanism: a disabled category is simply absent from the plan, and both
    // ensure* implementations only ever ADD what the plan names. Neither has
    // a code path that removes a row the plan omits.
    const off = planProjectFolders({ ...GAME, levels_enabled: false })
    expect(off.map(f => f.path)).not.toContain('LEVELS')
  })
})


describe('planEntityFolder — one folder per entity', () => {
  it('gives a scene its own folder under SCENES', () => {
    // Audrey, explicitly: five scenes means FIVE folders under SCENES/, not
    // one shared one.
    const { folder, category } = planEntityFolder(GAME, 'scene', { id: 's1', name: 'WLSN_SC001' })
    expect(category.path).toBe('SCENES')
    expect(folder.path).toBe('SCENES/Wlsn-Sc001')
    expect(folder.parentPath).toBe('SCENES')
    expect(folder.kind).toBe('entity')
    expect(folder.entityType).toBe('scene')
  })

  it('links through the entity type\'s own foreign key column', () => {
    // Five nullable FKs, not a polymorphic id — see 0041. The planner has to
    // put the id on the RIGHT one or folders_entity_type_agrees_chk refuses
    // the row.
    const { folder } = planEntityFolder(GAME, 'level', { id: 'l1', name: 'Level 1' })
    expect(folder[ENTITY_FK_COLUMN.level]).toBe('l1')
    expect(folder.scene_id).toBeUndefined()
  })

  it('carries the entity name as the label, alongside the slug', () => {
    // `label` is what makes "rename the thing, keep the folder" POSSIBLE
    // later without a migration, even though this session chose the opposite.
    const { folder } = planEntityFolder(GAME, 'shot', { id: 'h1', name: 'WLSN_SC001_SH0001' })
    expect(folder.label).toBe('WLSN_SC001_SH0001')
    expect(folder.slug).toBe('Wlsn-Sc001-Sh0001')
  })

  it('names an unnamed entity rather than producing an empty segment', () => {
    // An empty slug violates folders_slug_nonempty_chk, so this is the
    // difference between a folder called Untitled-Scene and a failed write.
    const { folder } = planEntityFolder(GAME, 'scene', { id: 's9' })
    expect(folder.slug).toBe('Untitled-Scene')
    expect(folder.path).toBe('SCENES/Untitled-Scene')
  })

  it('plans an entity folder even when its category is toggled OFF', () => {
    // A scene can exist from before the toggle was flipped. Refusing it a
    // folder because the tab is currently hidden would orphan real content —
    // and the toggle is about VISIBILITY, never about deletion.
    const { folder, category } = planEntityFolder(
      { ...GAME, scenes_enabled: false }, 'scene', { id: 's1', name: 'WLSN_SC001' },
    )
    expect(category.path).toBe('SCENES')
    expect(folder.path).toBe('SCENES/Wlsn-Sc001')
  })

  it('returns null for a type with no category', () => {
    expect(planEntityFolder(GAME, 'phase', { id: 'x' })).toBeNull()
    expect(entityFolderPath('task', { id: 'x' })).toBeNull()
    expect(categoryForEntityType('nonsense')).toBeNull()
  })
})


describe('paths are safe to concatenate onto a root', () => {
  // 0041 refuses a traversal segment outright (folders_path_shape_chk), and
  // materializeFolderDirs contains the join. This is the first line: the
  // planner must not GENERATE one, whatever the entity is called.
  const HOSTILE = [
    '../../etc/passwd', '..', 'a/b', 'a\\b', '/absolute', 'trailing/',
    './relative', 'C:\\Windows',
  ]

  it.each(HOSTILE)('produces a contained path for an entity named %j', (name) => {
    const { folder } = planEntityFolder(GAME, 'scene', { id: 's1', name })
    expect(folder.path).not.toMatch(/(^\/|\/$|\/\/|\.\.|\\)/)
    expect(folder.path.startsWith('SCENES/')).toBe(true)
    expect(folder.path.split('/')).toHaveLength(2)
  })

  it('never lets an entity escape its own category', () => {
    for (const name of HOSTILE) {
      expect(entityFolderSlug('scene', { name })).not.toMatch(/[/\\]/)
    }
  })
})


describe('planFullTree — reconciling a project that predates 0041', () => {
  const bundle = {
    assets:      [{ id: 'a1', name: 'Hero Ship' }],
    scenes:      [{ id: 's1', name: 'WLSN_SC001' }, { id: 's2', name: 'WLSN_SC002' }],
    shots:       [{ id: 'h1', name: 'WLSN_SC001_SH0001' }],
    levels:      [{ id: 'l1', name: 'Level 1' }],
    experiences: [{ id: 'e1', name: 'Launch Party' }],
  }

  it('plans the categories plus one folder per entity', () => {
    const paths = planFullTree(GAME, bundle).map(f => f.path)
    expect(paths).toContain('ASSETS/Hero-Ship')
    expect(paths).toContain('SCENES/Wlsn-Sc001')
    expect(paths).toContain('SCENES/Wlsn-Sc002')
    expect(paths).toContain('SHOTS/Wlsn-Sc001-Sh0001')
    expect(paths).toContain('LEVELS/Level-1')
    expect(paths).toContain('EXPERIENCES/Launch-Party')
  })

  it('emits each path exactly once', () => {
    // Duplicates would hit folders_project_path_uniq and take the whole
    // reconcile down. The planner drops them so the write does what it can.
    const paths = planFullTree(GAME, bundle).map(f => f.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('drops a collision rather than emitting two folders for one path', () => {
    // Two scenes whose names slugify identically — "Scene One" and
    // "scene  one" — are a real possibility once names are user-editable.
    const clashing = { scenes: [{ id: 's1', name: 'Scene One' }, { id: 's2', name: 'scene  one' }] }
    const paths = planFullTree(GAME, clashing).map(f => f.path)
    expect(paths.filter(p => p === 'SCENES/Scene-One')).toHaveLength(1)
  })

  it('lists a parent before its children, so parent_id always resolves', () => {
    // Both ensure* implementations look the parent up in a map they are
    // filling as they go. A child planned first would get parent_id null and
    // silently detach from the tree.
    const plan = planFullTree(GAME, bundle)
    const seen = new Set()
    for (const f of plan) {
      if (f.parentPath !== null) {
        expect(seen.has(f.parentPath), `${f.path} planned before ${f.parentPath}`).toBe(true)
      }
      seen.add(f.path)
    }
  })

  it('handles an empty bundle without inventing entity folders', () => {
    expect(planFullTree(FILM, {}).map(f => f.path)).toEqual(['', 'ASSETS', 'INVOICES'])
  })
})


describe('the category list itself', () => {
  it('covers exactly the entity types the tree knows about', () => {
    const withEntities = FOLDER_CATEGORIES
      .filter(c => ENTITY_FK_COLUMN[c.entityType])
      .map(c => c.entityType)
    expect(withEntities.sort()).toEqual(
      ['asset', 'experience', 'level', 'scene', 'shot'],
    )
  })

  it('uses only uppercase, separator-free slugs', () => {
    for (const c of FOLDER_CATEGORIES) {
      expect(c.slug).toBe(c.slug.toUpperCase())
      expect(c.slug).not.toMatch(/[/\\\s]/)
    }
  })
})
