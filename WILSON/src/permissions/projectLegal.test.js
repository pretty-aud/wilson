// =============================================================================
// projectLegal.test.js — post-overhaul S4d (migration 0092).
//
// canSeeProjectLegal is the client mirror of can_access_project_legal(uuid):
// the money gate OR a workspace-level manager, without a seat. Audrey,
// 2026-10-08, asked who else should see Legal files besides workspace admins
// and the project's managers: "Also workspace managers, without taking a
// seat." Money does NOT widen (D8), so the two gates differ in exactly one
// row of the role table and nowhere else — and every money site keeps asking
// the money gate while every Legal site asks the Legal one. The second half
// is pinned on the SOURCE, because a gate that reads right and is wired to
// the wrong predicate looks identical on screen.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { canSeeProjectLegal, canSeeProjectMoney, canOnProject, PROJECT_ACTIONS, PROJECT_ROLES } from './projectRoleMatrix'

const APP_ROLES = ['admin', 'manager', 'user', null]
const SEATS = [...PROJECT_ROLES, null]

describe('canSeeProjectLegal — who may see a Legal file (0092)', () => {
  it('is not a project action — Legal, like money, has no unstaffed opening and no ready opening', () => {
    expect(PROJECT_ACTIONS).not.toContain('project.legal.read')
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: null, isStaffed: false })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: null, ready: false })).toBe(false)
    // …while the write gate does open an unstaffed project (the contrast).
    expect(canOnProject({ appRole: 'user', projectRole: null, isStaffed: false }, 'project.entity.write')).toBe(true)
  })

  it('lets a workspace admin see Legal files, with any seat or none', () => {
    for (const seat of SEATS) expect(canSeeProjectLegal({ appRole: 'admin', projectRole: seat }), String(seat)).toBe(true)
  })

  it('lets a project manager see Legal files, whatever the app role', () => {
    for (const appRole of APP_ROLES) expect(canSeeProjectLegal({ appRole, projectRole: 'manager' }), String(appRole)).toBe(true)
  })

  // 🚨 THE ONE ROW THAT CHANGED. Audrey, 2026-10-08: "Also workspace managers,
  // without taking a seat."
  it('lets a workspace MANAGER see Legal files WITHOUT a manager seat — a member seat, a reviewer seat or none', () => {
    for (const seat of ['member', 'reviewer', null]) {
      expect(canSeeProjectLegal({ appRole: 'manager', projectRole: seat }), String(seat)).toBe(true)
      // …and the same person still sees no money (D8; projectMoney.test.js).
      expect(canSeeProjectMoney({ appRole: 'manager', projectRole: seat }), String(seat)).toBe(false)
    }
  })

  it('does not let a member or a reviewer see Legal files, nor someone with no seat and no app role above user', () => {
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: 'member' })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: 'reviewer' })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: null })).toBe(false)
    expect(canSeeProjectLegal({ appRole: null, projectRole: 'member' })).toBe(false)
  })

  it('fails CLOSED on an empty or missing context, like money', () => {
    expect(canSeeProjectLegal({})).toBe(false)
    expect(canSeeProjectLegal(null)).toBe(false)
    expect(canSeeProjectLegal(undefined)).toBe(false)
    expect(canSeeProjectLegal({ appRole: null, projectRole: null })).toBe(false)
  })

  it('gives unknown app roles and unknown seats no way in', () => {
    expect(canSeeProjectLegal({ appRole: 'platform_operator', projectRole: null })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'MANAGER', projectRole: null })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'user', projectRole: 'MANAGER' })).toBe(false)
    expect(canSeeProjectLegal({ appRole: 'manager ', projectRole: null })).toBe(false)
  })

  it('is a SUPERSET of the money gate, and differs from it on exactly the app-manager rows', () => {
    const differing = []
    for (const appRole of APP_ROLES) {
      for (const projectRole of SEATS) {
        const ctx = { appRole, projectRole }
        const legal = canSeeProjectLegal(ctx)
        const money = canSeeProjectMoney(ctx)
        // Everyone money admits, Legal admits.
        if (money) expect(legal, `${appRole}/${projectRole}`).toBe(true)
        if (legal !== money) differing.push(`${appRole}/${projectRole}`)
      }
    }
    // A workspace manager with a member seat, a reviewer seat or none: the
    // three rows — and only those — where the two gates part.
    expect(differing.sort()).toEqual(['manager/member', 'manager/null', 'manager/reviewer'])
  })
})

// ── The sites: every Legal decision reads the Legal gate; every money
//    decision still reads the money gate ───────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8').replace(/\r\n/g, '\n')
// Comment lines stripped, so a right-looking line in a comment above a wrong
// one cannot satisfy a pin (legalSurfaces.test.js, planted fault R1-8).
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

describe('the Legal sites ask the Legal gate; the money sites keep the money gate (0092)', () => {
  const EXPLORER = '../components/Resources/ProjectFilesExplorer.jsx'
  const ADAPTER = '../tools/rabbit_v0.1.0/adapters/supabaseAdapter.js'
  const FIXTURES = '../dev/fixtures/rabbitFixturesAdapter.js'
  const TAGS = '../tools/rabbit_v0.1.0/fileTags.js'
  const HELP = '../tools/rabbit_v0.1.0/rabbitHelpContent.jsx'

  it('the Files tab offers Add as Legal on canSeeLegal, which reads canSeeProjectLegal — never on canSeeMoney', () => {
    const src = code(read(EXPLORER))
    expect(src).toMatch(/const canSeeLegal = noRoles \|\| \(isOpenProject\s*\?\s*canSeeProjectLegal\(\{ appRole, projectRole: ctx\?\.myProjectRole \}\)\s*:\s*\(appRole === 'admin' \|\| appRole === 'manager'\)\)/)
    expect(src).toMatch(/const legalOffered = onTab && canSeeLegal\b/)
    expect(src).not.toMatch(/const legalOffered = onTab && canSeeMoney\b/)
    expect(src).toContain("import { canSeeProjectMoney, canSeeProjectLegal } from '../../permissions/projectRoleMatrix'")
    // The money gate is still read beside it, for the money things on the tab.
    expect(src).toMatch(/const canSeeMoney = noRoles \|\| \(isOpenProject\s*\?\s*canSeeProjectMoney\(\{ appRole, projectRole: ctx\?\.myProjectRole \}\)/)
  })

  it('CONTROL: the old wiring (Add as Legal on the money gate) does not pass the pin above', () => {
    const old = 'const legalOffered = onTab && canSeeMoney'
    expect(old).not.toMatch(/const legalOffered = onTab && canSeeLegal\b/)
  })

  it('the cloud adapter asks can_access_project_legal before a Legal upload, and never names the money RPC', () => {
    const src = code(read(ADAPTER))
    expect(src).toMatch(/async function canAccessProjectLegal\(client, projectId\) \{[\s\S]*?client\.rpc\('can_access_project_legal', \{ p_project: projectId \}\)/)
    expect(src).toMatch(/if \(legal\) \{\s*if \(!\(await legalFilesAvailable\(client\)\)\) throw new Error\(LEGAL_UNAVAILABLE\);\s*if \(!\(await canAccessProjectLegal\(client, projectId\)\)\) throw new Error\(LEGAL_GATE_REFUSAL\);\s*\}/)
    expect(src).not.toContain("'can_access_project_money'")
    expect(src).not.toMatch(/canAccessProjectMoney\(/)
  })

  it('the dev fixtures gate a Legal row and its events on passesLegalGate (money OR a workspace manager), and money rows on the money gate', () => {
    const src = code(read(FIXTURES))
    expect(src).toMatch(/const passesLegalGate = \(projectId\) => passesMoneyGate\(projectId\) \|\| appRole === 'manager'/)
    expect(src).toMatch(/const isLegalRow = \(f\) => isLegalFile\(f\) && !f\?\.is_financial/)
    expect(src).toMatch(/const readableFiles = \(rows\) => rows\.filter\(f => !isMoneyFile\(f\) \|\| passesMoneyGate\(f\.project_id\) \|\| \(isLegalRow\(f\) && passesLegalGate\(f\.project_id\)\)\)/)
    expect(src).toMatch(/async listFileEvents\(fileId\) \{[\s\S]*?if \(f && isMoneyFile\(f\) && !passesMoneyGate\(f\.project_id\) && !\(isLegalRow\(f\) && passesLegalGate\(f\.project_id\)\)\) return \[\]/)
    // The budget, bid versions and rates in the fixtures still read the money gate alone.
    expect(src).toMatch(/budgetVersions: passesMoneyGate\(projectId\)/)
    expect(src).not.toMatch(/budgetVersions: passesLegalGate/)
  })

  it('the three sentences name the Legal audience, and the help page says the same', () => {
    const tags = read(TAGS)
    for (const name of ['LEGAL_HINT', 'LEGAL_ADD_HINT', 'LEGAL_GATE_REFUSAL']) {
      const line = tags.split('\n').find((l) => l.startsWith(`export const ${name} = `))
      expect(line, name).toMatch(/project managers, workspace managers and workspace admins/)
    }
    const help = read(HELP)
    expect(help).toContain('For project managers, workspace managers and workspace admins: puts files into the project')
    expect(help).toContain('only project managers, workspace managers and workspace admins can see a Legal file (invoices stay with project managers and workspace admins)')
  })

  it('no money site asks the Legal gate: the Budget tab, the Control Panel, the Timeline, the Budget view, the invoice attachment', () => {
    for (const rel of [
      '../tools/rabbit_v0.1.0/Rabbit.jsx',
      '../tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx',
      '../tools/rabbit_v0.1.0/views/TimelineView.jsx',
      '../tools/rabbit_v0.1.0/views/BudgetView.jsx',
      '../components/Budget/InvoiceAttachment.jsx',
    ]) {
      expect(read(rel), rel).not.toMatch(/canSeeProjectLegal|can_access_project_legal|canSeeLegal/)
    }
  })
})
