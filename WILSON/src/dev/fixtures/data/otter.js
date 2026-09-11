// =============================================================================
// otter.js — one O.T.T.E.R. course: "DaVinci Resolve 19", four subjects, each
// two sections of two or three lessons, with hotkey and function documents,
// a reference list, progress for the reviewer and two quiz attempts.
//
// Rows are shaped like otter_courses / otter_subjects (0022) so the fixtures
// route handler can hand them to the same wire mappers the cloud adapter
// uses (course → toCourseWire, subject → toSubjectWire). Lesson content is
// markdown, the way the generator writes it.
// =============================================================================

import { fid, stamp } from '../ids'
import { WORKSPACE_ID, MEMBER_ID } from './workspace'

export const COURSE_ID = fid('course', 1)

export const COURSE = {
  id: COURSE_ID,
  workspace_id: WORKSPACE_ID,
  owner_id: MEMBER_ID.sofia,
  slug: 'davinci-resolve-19',
  name: 'DaVinci Resolve 19',
  course_type: 'software',
  skill_level: 'intermediate',
  visibility: 'company_standard',
  source_course_id: null,
  created_at: stamp(-60, 10),
  updated_at: stamp(35, 10),
  // Per-course singleton documents (otterRoutes.COURSE_DOCS).
  hotkeys: {
    categories: [
      { category: 'Timeline', shortcuts: [
        { action: 'Blade', key: 'Ctrl+B', windows: 'Ctrl+B', mac: 'Cmd+B', notes: '' }, { action: 'Split clip', key: 'Ctrl+\\', windows: 'Ctrl+\\', mac: 'Cmd+\\', notes: '' },
        { action: 'Ripple delete', key: 'Shift+Delete', windows: 'Shift+Delete', mac: 'Shift+Delete', notes: '' }, { action: 'Insert', key: 'F9', windows: 'F9', mac: 'F9', notes: '' },
        { action: 'Overwrite', key: 'F10', windows: 'F10', mac: 'F10', notes: '' }, { action: 'Snapping', key: 'N', windows: 'N', mac: 'N', notes: '' },
      ] },
      { category: 'Playback', shortcuts: [
        { action: 'Play / stop', key: 'Space', windows: 'Space', mac: 'Space', notes: '' }, { action: 'Shuttle', key: 'J K L', windows: 'J K L', mac: 'J K L', notes: '' },
        { action: 'Previous edit', key: 'Up', windows: 'Up', mac: 'Up', notes: '' }, { action: 'Next edit', key: 'Down', windows: 'Down', mac: 'Down', notes: '' },
      ] },
      { category: 'Colour', shortcuts: [
        { action: 'Grab still', key: 'Ctrl+Alt+G', windows: 'Ctrl+Alt+G', mac: 'Cmd+Option+G', notes: '' }, { action: 'Bypass grades', key: 'Shift+D', windows: 'Shift+D', mac: 'Shift+D', notes: '' },
        { action: 'Add node (serial)', key: 'Alt+S', windows: 'Alt+S', mac: 'Option+S', notes: '' },
      ] },
    ],
  },
  functions: {
    categories: [
      { name: 'Edit page', functions: [
        { name: 'Smart Insert', syntax: 'Edit > Smart Insert (Ctrl+Shift+I)', example: 'Park the playhead between two clips and press Smart Insert to drop the source at the nearest edit.', description: 'Inserts the source clip at the nearest edit point to the playhead.' },
        { name: 'Trim mode', syntax: 'T (Trim Edit Mode)', example: 'Press T, then drag the edge of a clip to ripple or the cut point to roll.', description: 'Ripple, roll, slip and slide with one tool and the pointer position.' },
      ] },
      { name: 'Colour page', functions: [
        { name: 'Primary wheels', syntax: 'Color > Primaries > Wheels', example: 'Lift the shadows a touch, gain the highlights, then re-balance gamma.', description: 'Lift, gamma, gain and offset over the whole image.' },
        { name: 'Power Windows', syntax: 'Color > Window > Circle / Linear / Polygon / Curve', example: 'Draw a soft circle over the face and lift gamma inside it by 0.05.', description: 'Shapes that limit a node\'s correction to part of the frame.' },
        { name: 'Colour Warper', syntax: 'Color > Color Warper > Hue-Saturation', example: 'Drag the orange node toward red to warm the lantern without touching skin.', description: 'A hue/saturation mesh for pushing single colours around.' },
      ] },
    ],
  },
  nodes: { systems: [] },
  reference_urls: { urls: [
    { title: 'Resolve 19 reference manual', url: 'https://docs.example/resolve-19/manual' },
    { title: 'Colour page training', url: 'https://docs.example/resolve-19/colour' },
  ] },
  corrections: { corrections: [] },
}

function lesson(id, title, content, key_takeaways = [], practice_prompt = '') {
  return { id, title, content, key_takeaways, practice_prompt }
}

const SUBJECT_ROWS = [
  {
    n: 1, slug: 'project-setup-and-media', title: 'Project setup and media', skill_level: 'beginner', estimated_hours: 2,
    description: 'Databases, project settings, and getting camera originals into a media pool without losing metadata.',
    sections: [
      { id: 'section_1', title: 'Before the first clip', description: 'What to set once.', estimated_minutes: 30, lessons: [
        lesson('lesson_1_1', 'Project settings that cannot change later',
          '## Timeline frame rate\n\nThe **timeline frame rate** is fixed the moment a timeline exists. Set it in *Project Settings → Master Settings* before you import anything.\n\n- Salt Hours is 24 fps.\n- Playback frame rate should match.\n\n## Working folders\n\nPut the cache and proxies on the fastest drive you have, and *not* on the camera card.',
          ['Set the timeline frame rate first.', 'Cache and proxies belong on a fast local drive.'],
          'Open a new project and set 24 fps before importing a clip. Then try to change it — read the warning.'),
        lesson('lesson_1_2', 'Databases and where a project lives',
          'Resolve keeps projects in a **database**, not in a file you can see. A disk database is a folder; a PostgreSQL database is a server.\n\nFor a short film one disk database is enough. Back it up with *File → Project Manager → Export Project*.',
          ['A project is a row in a database.', 'Export the project as a .drp to hand it to someone.']),
      ] },
      { id: 'section_2', title: 'The media pool', description: 'Getting the rushes in.', estimated_minutes: 45, lessons: [
        lesson('lesson_2_1', 'Import without copying',
          'Drag a folder into the media pool and Resolve **links** to the files; nothing is copied. If the drive goes away the clips go offline.\n\nUse *Clone Tool* on the Media page when you want a checksummed copy of a camera card first.',
          ['Import links; it does not copy.', 'Clone camera cards with checksums before anything else.'],
          'Clone the A001 card to two destinations with MD5 and read the report.'),
        lesson('lesson_2_2', 'Bins, smart bins and metadata',
          'Bins are folders inside the pool. **Smart bins** are saved searches: every clip with `Scene = 4` and `Good Take = ✓`, updating as you tag.\n\nThe *Metadata* panel is where scene, shot, take and the good-take flag live; the sync bin and the edit index both read them.',
          ['A smart bin is a query, not a folder.', 'Scene / shot / take metadata drives everything downstream.']),
        lesson('lesson_2_3', 'Syncing sound',
          'Select picture and sound clips together and choose *Auto Sync Audio → Based on Timecode*. Waveform sync is the fallback when the recorder was not jammed.',
          ['Timecode sync first, waveform second.']),
      ] },
    ],
  },
  {
    n: 2, slug: 'editing-on-the-edit-page', title: 'Editing on the Edit page', skill_level: 'intermediate', estimated_hours: 3,
    description: 'Three-point editing, trim modes and the tools that make a cut faster than the mouse.',
    sections: [
      { id: 'section_1', title: 'Three-point editing', description: 'In, out, and one more.', estimated_minutes: 40, lessons: [
        lesson('lesson_1_1', 'In and out, source and timeline',
          'A three-point edit needs any three of: source in, source out, timeline in, timeline out. Resolve fills in the fourth.\n\n`I` and `O` mark; `F9` inserts, `F10` overwrites.',
          ['Three points define the edit; Resolve computes the fourth.']),
        lesson('lesson_1_2', 'Replace and fit-to-fill',
          '**Replace** (F11) swaps the clip under the playhead for the source, aligned on the playhead. **Fit to fill** retimes the source to the gap.',
          ['Replace aligns on the playhead, not the in point.']),
      ] },
      { id: 'section_2', title: 'Trimming', description: 'Where the cut actually happens.', estimated_minutes: 60, lessons: [
        lesson('lesson_2_1', 'Ripple, roll, slip, slide',
          'One tool (`T`), four trims, chosen by where you click:\n\n- **Ripple** the edge: the timeline gets longer or shorter.\n- **Roll** the cut: the edit point moves, the length does not.\n- **Slip** the middle of a clip: the content changes, the position does not.\n- **Slide** a clip: the position changes, the neighbours absorb it.',
          ['Where you grab decides the trim.', 'Only ripple changes the running time.'],
          'Take the café two-shot and roll the cut into the reverse by twelve frames without moving anything else.'),
        lesson('lesson_2_2', 'Dynamic trim and JKL',
          'With *Dynamic Trim* on, `J K L` plays the trim live and the edit lands where you stop. It is the fastest way to find a cut on dialogue.',
          ['Dynamic trim lets you hear the cut before you make it.']),
        lesson('lesson_2_3', 'Compound clips and the timeline stack',
          'Compound clips fold a section into one clip; *Decompose in place* unfolds it. Nested timelines keep a live link to their source.',
          ['Compound to tidy; decompose to trim.']),
      ] },
    ],
  },
  {
    n: 3, slug: 'colour-fundamentals', title: 'Colour fundamentals', skill_level: 'intermediate', estimated_hours: 4,
    description: 'Nodes, primaries, scopes, and a grade that survives the DCP.',
    sections: [
      { id: 'section_1', title: 'The node graph', description: 'Order matters.', estimated_minutes: 50, lessons: [
        lesson('lesson_1_1', 'Serial, parallel, layer',
          'A **serial** node feeds the next. **Parallel** nodes see the same input and are summed. **Layer** nodes composite, top over bottom.\n\nStart every clip with: balance → primary → secondary → look.',
          ['Node order is the grade.', 'Balance before look.']),
        lesson('lesson_1_2', 'Reading the scopes',
          'The **waveform** shows exposure per column; the **parade** splits it by channel; the **vectorscope** shows hue and saturation. Skin sits on the skin-tone line.',
          ['Trust the parade over your eye for balance.']),
      ] },
      { id: 'section_2', title: 'A grade for a short film', description: 'Consistency across sixteen shots.', estimated_minutes: 70, lessons: [
        lesson('lesson_2_1', 'Shot matching with stills',
          'Grab a still of the hero shot (`Ctrl+Alt+G`), wipe it over the next, and match with the primaries only. Save the look once, then apply it to the scene.',
          ['Match with a wipe, not from memory.']),
        lesson('lesson_2_2', 'Groups and the timeline node',
          'Put every shot of a scene in a **group** and grade the group\'s pre-clip node once. The **timeline node** carries the whole film\'s look; the DCP output transform goes there and nowhere else.',
          ['One look, one place.', 'Output transforms live on the timeline node.'],
          'Group sc 04 and put the rain-blue look on the group post-clip node.'),
      ] },
    ],
  },
  {
    n: 4, slug: 'delivering-a-dcp', title: 'Delivering a DCP', skill_level: 'advanced', estimated_hours: 2,
    description: 'Render settings, the Kakadu encoder, and what a festival actually checks.',
    sections: [
      { id: 'section_1', title: 'Deliver page', description: 'Presets and what to override.', estimated_minutes: 40, lessons: [
        lesson('lesson_1_1', 'The DCP preset',
          'Choose the **DCP** preset, then: 2K flat (1998×1080) for a 1.85 film, 24 fps, XYZ colour, **Kakadu** JPEG 2000 at 250 Mb/s for a short.\n\nName the package with the standard naming convention; festivals reject unnamed CPLs.',
          ['2K flat, 24 fps, 250 Mb/s is the safe short-film DCP.']),
        lesson('lesson_1_2', 'Audio for the DCP',
          '5.1 goes in as six mono channels in SMPTE order (L R C LFE Ls Rs). A stereo mix goes in as L R with silence on the rest — never as a 2-channel package.',
          ['Six mono channels, SMPTE order.']),
      ] },
      { id: 'section_2', title: 'Checking it', description: 'Before it leaves the building.', estimated_minutes: 30, lessons: [
        lesson('lesson_2_1', 'Validate and play it back',
          'Run the package through a validator (the *DCP Verify* tool or an open source one), then **play the whole thing** in a DCP player. A hash mismatch or a missing asset is a rejection at the festival.',
          ['Validate, then watch every minute.'],
          'Build a ten-second test DCP from sc 01 sh 010 and verify it.'),
      ] },
    ],
  },
]

export const SUBJECTS = SUBJECT_ROWS.map(({ n, slug, title, skill_level, estimated_hours, description, sections }, i) => ({
  id: fid('subject', n),
  workspace_id: WORKSPACE_ID,
  course_id: COURSE_ID,
  owner_id: MEMBER_ID.sofia,
  slug,
  title,
  description,
  skill_level,
  is_stub: false,
  subject_order: i,
  estimated_hours,
  sections,
  section_outlines: sections.map(s => ({ id: s.id, title: s.title, lesson_count: s.lessons.length })),
  sources: [{ title: 'Resolve 19 reference manual', url: 'https://docs.example/resolve-19/manual' }],
  prerequisites: i === 0 ? [] : [SUBJECT_ROWS[i - 1].slug],
  deleted_at: null,
  deleted_by: null,
  created_at: stamp(-58 + i, 10),
  created_by: MEMBER_ID.sofia,
  updated_at: stamp(35 - i, 10),
  updated_by: MEMBER_ID.sofia,
}))

/** otter_progress row for the reviewer: first subject done, second half way. */
export const PROGRESS = {
  course_id: COURSE_ID,
  completed_lessons: {
    'project-setup-and-media': { completed_lessons: ['lesson_1_1', 'lesson_1_2', 'lesson_2_1', 'lesson_2_2', 'lesson_2_3'], last_accessed: stamp(20, 21) },
    'editing-on-the-edit-page': { completed_lessons: ['lesson_1_1', 'lesson_1_2', 'lesson_2_1'], last_accessed: stamp(37, 22, 15) },
  },
  last_accessed: stamp(37, 22, 15),
}

export const QUIZ_ATTEMPTS = [
  { id: fid('quiz', 1), taken_at: stamp(21, 21, 30), score: 7,  total: 10, courses: ['DaVinci Resolve 19'], question_types: ['hotkeys', 'functions'] },
  { id: fid('quiz', 2), taken_at: stamp(37, 22, 40), score: 9,  total: 10, courses: ['DaVinci Resolve 19'], question_types: ['hotkeys'] },
]
