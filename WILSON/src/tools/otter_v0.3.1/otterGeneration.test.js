// =============================================================================
// otterGeneration.test.js — F6 (A1): one pipeline for O.T.T.E.R.'s five
// generators (prompts.js).
//
// generateCourse and agentGenerateCourse (an outline), generateSingleSubject
// and agentGenerateSingleSubject (a subject on a topic) and
// generateSubjectContent (a stub filled) were two copies of one pipeline plus
// a third. Before they were folded together, a temporary harness ran the
// committed five and the new five side by side with the same fakes (twelve
// scenarios: new and existing courses, a stub fill on software and on a coding
// language, topics with and without node words, a reply that is not JSON, a
// cut-off reply) and compared every request to the model, every read, save,
// merge and share reminder, and what each path shows: identical, byte for
// byte, apart from the three fixes pinned below (the hand-off records it).
// The two requests below are recordings from that run, pinned as literals.
//
// The SAVE stays in each path in Otter.jsx, beside its share reminder (design
// §5.9); NewSubjectShareReminder.test.jsx judges that, unedited.
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('../../cloud/auth/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../cloud/aiProxy', async (importOriginal) => ({ ...(await importOriginal()), callAI: vi.fn() }))

import { callAI } from '../../cloud/aiProxy'
import {
  buildCourseMessage, buildSubjectMessage, generateCourseOutline, generateSubject, createCourse,
  courseStubs, mergeSubjectDocuments, normalizeSections, parseModelJson, subjectSources,
} from './prompts.js'

const OTTER = readFileSync(fileURLToPath(new URL('./Otter.jsx', import.meta.url)), 'utf8')

const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
/** A fake otterFetch over a little library; every call is logged. */
function library(log = []) {
  return async (url, init = {}) => {
    log.push(`${init.method || 'GET'} ${url}${init.body ? ' ' + init.body : ''}`)
    if (init.method === 'POST' && url === '/api/software') return json({ slug: 'new-course' })
    if (url.endsWith('/hotkeys/merge')) return json({ categories: ['merged'] })
    if (url.endsWith('/nodes/merge')) return json({ error: 'No.' }, 403)
    if (init.method === 'POST') return json({ ok: true })
    if (url.endsWith('/subjects')) return json([{ slug: 'a', title: 'Old A' }])
    if (url.endsWith('/hotkeys')) return json({ categories: [{ shortcuts: [{ action: 'Orbit' }] }] })
    return json({ systems: [] })
  }
}
const REFS = [{ url: 'https://r.test', title: 'R', text: 'Ref.' }, { url: 'x', title: 'bad', error: 'no' }]
const answer = (obj, extra = []) => ({ stop_reason: 'end_turn', content: [...extra, { type: 'text', text: JSON.stringify(obj) }] })

beforeEach(() => { callAI.mockReset() })

describe('the requests, as the five paths sent them (recorded)', () => {
  it('a course outline, adding to an existing course, with references', async () => {
    expect(await buildCourseMessage({ fetchImpl: library(), name: 'Blender', context: 'For artists', skillLevel: 'beginner', existingMatch: { slug: 'blender' }, references: REFS }))
      .toBe('Software/Language: Blender\nSkill level: beginner\n\nAdditional context: For artists\n\nIMPORTANT: This software already has the following subjects — do NOT generate duplicates or basics:\n- Old A\nDo NOT include "General Basics" since it already exists. Only generate NEW subjects.\n\nThe user provided these reference materials. Design subjects that align with this content:\n- R (https://r.test): Ref.\n')
  })

  it('a subject on a topic, with what the course already documents and references', async () => {
    expect(await buildSubjectMessage({ fetchImpl: library(), courseSlug: 'blender', course: { name: 'Blender', type: 'software' }, topic: 'Lighting', skillLevel: 'beginner', docs: {}, references: REFS }))
      .toBe('Software/Language: Blender\nType: software\nSkill level: beginner\n\nIf this topic involves node-based workflows (shader nodes, geometry nodes, compositing nodes, etc.), include a "nodes" array alongside "hotkeys" documenting relevant nodes with all inputs, outputs, and types (Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any). Omit "nodes" if the topic does not involve nodes.\n\nSingle topic lesson: Lighting\n\nEXISTING HOTKEYS (DO NOT DUPLICATE):\n- Orbit\nOnly include hotkeys NOT in this list.\n\n\n--- REFERENCE MATERIAL (from user-provided URLs) ---\n\nSource: R (https://r.test)\nRef.\n\nUse the above reference material as primary sources. Cite them where relevant.\n')
  })

  it('a stub filled: its own words, its section outlines, the documents it was given', async () => {
    const msg = await buildSubjectMessage({
      fetchImpl: library(), courseSlug: 'py', course: { name: 'Python', type: 'coding_language' },
      stub: { title: 'Loops', description: 'for and while', section_outlines: [{ title: 'for', description: 'iterating', lesson_count: 2 }] },
      docs: { functions: { categories: [{ functions: [{ name: 'range()' }, null] }] } }, references: [],
    })
    expect(msg).toBe('Software/Language: Python\nType: coding_language\nSubject: Loops\nDescription: for and while\nSkill level: beginner\n\nIMPORTANT: This is a coding language. Include "functions" (not "hotkeys") in your response — list built-in functions, methods, and constructs covered in this subject with full parameter details, return types, and examples.\n\nSection outlines to follow:\n- for: iterating (2 lessons)\n\nEXISTING FUNCTIONS (DO NOT DUPLICATE):\n- range()\nOnly include functions NOT in this list.\n')
  })
})

describe('the model\'s call and its reply', () => {
  it('a subject is asked with web search (one use with references, else three), 12,000 tokens, the key it is given', async () => {
    callAI.mockResolvedValueOnce(answer({ title: 'Lighting', sections: [] }))
    await generateSubject({ fetchImpl: library(), model: 'm:otter.agentSubject', systemPrompt: 'SYS', courseSlug: 'blender', course: null, topic: 'Lighting', skillLevel: 'beginner', docs: {}, references: REFS })
    const body = callAI.mock.calls[0][0]
    expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'system', 'messages', 'tool', 'tools', 'betas'])
    expect(body).toMatchObject({ model: 'm:otter.agentSubject', max_tokens: 12000, system: 'SYS', tool: 'otter', betas: 'web-search-2025-03-05' })
    expect(body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }])
    expect(body.messages[0].content).toMatch(/^Software\/Language: blender\nType: software\n/)
  })

  it('a course outline: no tools; a cut-off reply says so in the course screen\'s words (F6: the agent\'s too)', async () => {
    callAI.mockResolvedValueOnce({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })
    await expect(generateCourseOutline({ fetchImpl: library(), model: 'm', systemPrompt: 'S', name: 'Maya', context: '', skillLevel: 'beginner', existingMatch: null, references: [] }))
      .rejects.toThrow('Response was too long and got cut off. Try a simpler topic.')
    expect(callAI.mock.calls[0][0]).not.toHaveProperty('tools')
  })

  it('a reply that is not JSON says what came back, in each kind\'s words', () => {
    const data = { stop_reason: 'end_turn', content: [{ type: 'thinking' }, { type: 'text', text: 'Sorry, no.' }] }
    expect(() => parseModelJson(data, 'subject')).toThrow('Failed to parse subject JSON. Try again. [end_turn; blocks: thinking, text; 10 chars of text]')
    expect(() => parseModelJson(data, 'course outline')).toThrow('Failed to parse course outline JSON. Try again. [end_turn;')
    expect(parseModelJson({ content: [{ type: 'text', text: 'Here:\n```json\n{"a":1}\n```' }] }, 'subject')).toEqual({ a: 1 })
  })

  it('the stub fill stops on its signal after the reply', async () => {
    const controller = new AbortController()
    callAI.mockImplementationOnce(async () => { controller.abort(); return answer({ sections: [] }) })
    await expect(generateSubject({ fetchImpl: library(), model: 'm', systemPrompt: 'S', courseSlug: 'b', course: null, stub: { title: 'T' }, stubSlug: 't', docs: {}, references: [], signal: controller.signal }))
      .rejects.toThrow('Cancelled')
  })
})

describe('the subject record', () => {
  it('a topic: slugged from its title, the sources the web\'s then the references\', each once', async () => {
    callAI.mockResolvedValueOnce(answer({ title: 'Three-Point Lighting!', sections: [{ lessons: [{ content: 'x' }] }] }, [
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://r.test', title: 'R web' }, { type: 'web_search_result', url: 'https://w.test', title: 'W' }] },
    ]))
    const { record } = await generateSubject({ fetchImpl: library(), model: 'm', systemPrompt: 'S', courseSlug: 'blender', course: { name: 'Blender', type: 'software' }, topic: 'lighting', skillLevel: 'beginner', docs: {}, references: REFS })
    expect(record).toMatchObject({ slug: 'three-point-lighting', title: 'Three-Point Lighting!', software_slug: 'blender', is_stub: false, original_prompt: 'lighting', skill_level: 'beginner', estimated_hours: 1 })
    expect(record.sources).toEqual([{ url: 'https://r.test', title: 'R web' }, { url: 'https://w.test', title: 'W' }])
  })

  it('F6: a takeaway the model sent as one string is kept on EVERY path (the single-subject paths dropped it)', () => {
    const [section] = normalizeSections([{ lessons: [{ title: 'L', content: 'a <cite index="1">b</cite>', key_takeaways: 'Light from three sides.' }] }])
    expect(section.lessons[0]).toEqual({ id: 'lesson_1_1', title: 'L', content: 'a b', key_takeaways: ['Light from three sides.'], practice_prompt: '' })
    expect(section).toMatchObject({ id: 'section_1', title: 'Section 1', description: '', estimated_minutes: 30 })
  })

  it('F6: the node hint carries its type list on every topic path (the agent\'s had lost it)', async () => {
    for (const topic of ['Lighting', 'Geometry nodes']) {
      const msg = await buildSubjectMessage({ fetchImpl: library(), courseSlug: 'b', course: { type: 'software' }, topic, skillLevel: 'x', docs: {}, references: [] })
      expect(msg).toContain('(Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any)')
    }
  })

  it('subjectSources: a URL once, an entry without one dropped', () => {
    expect(subjectSources([{ url: 'u' }, { url: '' }, { url: 'u', title: 'again' }], [{ url: 'v', title: 'V' }])).toEqual([{ url: 'u' }, { url: 'v', title: 'V' }])
  })
})

describe('a course\'s stubs, and its creation', () => {
  const OUTLINE = [
    { title: 'General Basics of Blender', subject_order: 1 }, { title: 'Modeling', skill_level: 'advanced' }, { title: 'Old A' }, { title: 'Shading' },
  ]
  it('adding to a course: what it holds (by slug or title) and a new "General Basics" are skipped; orders follow its highest', () => {
    const stubs = [...courseStubs(OUTLINE, { existingSubs: [{ slug: 'x', title: 'Old A', subject_order: 6 }], existingMatch: { slug: 'blender' }, skillLevel: 'beginner' })]
    expect(stubs.map(s => [s.slug, s.subject_order, s.skill_level])).toEqual([['modeling', 7, 'advanced'], ['shading', 8, 'beginner']])
    expect(stubs[0]).toMatchObject({ is_stub: true, sections: [], section_outlines: [], prerequisites: [], description: '', estimated_hours: 1 })
  })

  it('a new course keeps every subject, General Basics first', () => {
    expect([...courseStubs(OUTLINE, { existingSubs: null, existingMatch: null, skillLevel: 'b' })].map(s => s.slug))
      .toEqual(['general-basics-of-blender', 'modeling', 'old-a', 'shading'])
  })

  it('an outline entry without a title stops the run where it stands, as it always did', () => {
    const run = courseStubs([{ title: 'Ok' }, {}], { existingSubs: null, existingMatch: null, skillLevel: 'b' })
    expect(run.next().value.slug).toBe('ok')
    expect(() => run.next()).toThrow(TypeError)
  })

  it('createCourse: the body, and a refusal in its own words', async () => {
    const log = []
    expect(await createCourse(library(log), { name: 'Houdini', type: 'software', skillLevel: 'beginner', visibility: 'company' })).toBe('new-course')
    expect(log).toEqual(['POST /api/software {"name":"Houdini","type":"software","skill_level":"beginner","visibility":"company"}'])
    await expect(createCourse(async () => json({ error: 'You may not create company courses.' }, 403), { name: 'x' })).rejects.toThrow('You may not create company courses.')
  })
})

describe('the merges', () => {
  it('hotkeys (a flat list grouped), functions, nodes, in order; a refused merge is not drawn', async () => {
    const log = []
    const onHotkeys = vi.fn()
    const onNodes = vi.fn()
    await mergeSubjectDocuments(library(log), 'blender', {
      hotkeys: [{ context: 'View', action: 'Zoom', key: 'Z' }],
      functions: [{ name: 'Math', functions: [{ name: 'abs', returnType: 'number' }] }, { functions: [] }],
      nodes: [{ system: 'Geometry Nodes' }],
    }, { onHotkeys, onNodes })
    expect(log).toEqual([
      'POST /api/software/blender/hotkeys/merge {"categories":[{"category":"View","shortcuts":[{"action":"Zoom","windows":"Z","mac":"Z","notes":""}]}]}',
      'POST /api/software/blender/functions/merge {"categories":[{"category":"Math","functions":[{"name":"abs","syntax":"abs","parameters":"","returns":"number","description":"","example":""}]}]}',
      'POST /api/software/blender/nodes/merge {"categories":[{"system":"Geometry Nodes"}]}',
    ])
    expect(onHotkeys).toHaveBeenCalledWith({ categories: ['merged'] })
    expect(onNodes).not.toHaveBeenCalled()
  })
})

describe('the five paths ride the pipeline, each under its own model key', () => {
  const body = (name) => {
    const start = OTTER.indexOf(`const ${name} = useCallback(`)
    return start < 0 ? null : OTTER.slice(start, OTTER.indexOf('\n  }, [', start))
  }
  it.each([
    ['generateCourse', 'generateCourseOutline', 'otter.course'],
    ['agentGenerateCourse', 'generateCourseOutline', 'otter.agentCourse'],
    ['generateSubjectContent', 'generateSubject', 'otter.subjectContent'],
    ['generateSingleSubject', 'generateSubject', 'otter.singleSubject'],
    ['agentGenerateSingleSubject', 'generateSubject', 'otter.agentSubject'],
  ])('%s calls %s with %s', (name, fn, key) => {
    const b = body(name)
    expect(b, `${name} not found`).not.toBeNull()
    expect(b).toContain(`await ${fn}({`)
    expect(b).toContain(`model: modelFor('${key}')`)
    // No path keeps a copy of the request, the parse or the slug rule.
    expect(b).not.toMatch(/callAnthropicAPI\(|JSON\.parse\(|replace\(\/\[\^a-z0-9\]\+\/g/)
  })

  it('the slug rule is slugify everywhere in Otter.jsx', () => {
    expect(OTTER).not.toMatch(/toLowerCase\(\)\.trim\(\)\.replace\(\/\[\^a-z0-9\]\+\/g/)
  })
})
