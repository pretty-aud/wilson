// =============================================================================
// otter.js — two O.T.T.E.R. courses. "DaVinci Resolve 19", four subjects, each
// two sections of two or three lessons, with hotkey and function documents,
// a reference list, progress for the reviewer and two quiz attempts; and
// (post-overhaul S2b, at the end of this file) "C#", a coding language with a
// function library, one generated subject and one stub.
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
      { category: 'Edit page', functions: [
        { name: 'Smart Insert', syntax: 'Edit > Smart Insert (Ctrl+Shift+I)', example: 'Park the playhead between two clips and press Smart Insert to drop the source at the nearest edit.', description: 'Inserts the source clip at the nearest edit point to the playhead.' },
        { name: 'Trim mode', syntax: 'T (Trim Edit Mode)', example: 'Press T, then drag the edge of a clip to ripple or the cut point to roll.', description: 'Ripple, roll, slip and slide with one tool and the pointer position.' },
      ] },
      { category: 'Colour page', functions: [
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

// =============================================================================
// Post-overhaul S2b: a second course, a CODING LANGUAGE ("C#"). The course
// above is 'software', so with fixtures alone the Functions reference had
// never rendered, nor the subject page before its content is generated (no
// stub subject), nor a code fence in a lesson (A3 hand-off §5, trap 17).
//
// Its function library is the GENERATOR's shape after the client's mapping
// (Otter.jsx posts `{ category, functions: [{ name, syntax, parameters,
// returns, description, example }] }`), with one example longer than any
// well so the wrapping shows. The name is "C#" on purpose, and its stored
// slug is what slugify('C#') gives, 'c' — a slug that would read as C. On
// this wire (as in the cloud) a course's slug is its id, so in the app the
// language comes from the name; otterLanguage.test.js proves the name wins
// over a slug of 'c' as well. One generated subject — its first lesson's title is
// long enough that the breadcrumb must shorten its middle at the smallest
// window — and one stub, which the outline page draws.
// =============================================================================
export const CODING_COURSE_ID = fid('course', 2)

export const CODING_COURSE = {
  id: CODING_COURSE_ID,
  workspace_id: WORKSPACE_ID,
  owner_id: MEMBER_ID.sofia,
  slug: 'c',
  name: 'C#',
  course_type: 'coding_language',
  skill_level: 'beginner',
  visibility: 'company_standard',
  source_course_id: null,
  created_at: stamp(-20, 10),
  updated_at: stamp(30, 10),
  hotkeys: { categories: [] },
  functions: {
    categories: [
      { category: 'Strings', functions: [
        { name: 'string.Join', syntax: 'public static string Join(string separator, IEnumerable<string> values)',
          parameters: 'separator (string) — placed between each value\nvalues (IEnumerable<string>) — the strings to join',
          returns: 'string — the values, in order, with the separator between them',
          description: 'Joins a sequence of strings into one, with a separator between each pair.',
          example: 'var shots = new List<string> { "010", "020", "030" };\nstring label = string.Join(", ", shots); // "010, 020, 030"' },
        { name: 'string.IsNullOrWhiteSpace', syntax: 'public static bool IsNullOrWhiteSpace(string? value)',
          parameters: 'value (string?) — the string to test',
          returns: 'bool — true when the value is null, empty, or only white space',
          description: 'The safe test for "nothing was typed": a field of spaces counts as empty.',
          example: 'if (string.IsNullOrWhiteSpace(sceneName))\n{\n    sceneName = $"Scene {sceneNumber:00}";\n}' },
      ] },
      { category: 'Collections', functions: [
        { name: 'Dictionary<TKey, TValue>.TryGetValue', syntax: 'public bool TryGetValue(TKey key, [MaybeNullWhen(false)] out TValue value)',
          parameters: 'key (TKey) — the key to look up\nvalue (out TValue) — the value found, or the default when the key is missing',
          returns: 'bool — true when the dictionary holds the key',
          description: 'Looks a key up once and hands back its value, without throwing when the key is missing.',
          example: 'var takes = new Dictionary<string, int> { ["010"] = 3, ["020"] = 5 };\nif (takes.TryGetValue("020", out int count))\n{\n    Console.WriteLine($"Shot 020 has {count} takes."); // Shot 020 has 5 takes.\n}' },
        { name: 'Enumerable.Where', syntax: 'public static IEnumerable<TSource> Where<TSource>(this IEnumerable<TSource> source, Func<TSource, bool> predicate)',
          parameters: 'source (IEnumerable<TSource>) — the values to filter\npredicate (Func<TSource, bool>) — true for the values to keep',
          returns: 'IEnumerable<TSource> — the values the predicate kept, evaluated lazily',
          description: 'LINQ\'s filter: keeps the values a condition holds for. Nothing runs until the result is enumerated.',
          example: 'var goodTakes = takes.Where(t => t.Rating >= 4 && !t.IsFalseStart).OrderByDescending(t => t.Rating).Select(t => t.Name).ToList(); // one long line, wrapped by the well' },
      ] },
      { category: 'Math', functions: [
        { name: 'Math.Clamp', syntax: 'public static double Clamp(double value, double min, double max)',
          parameters: 'value (double) — the number to limit\nmin (double) — the lowest it may be\nmax (double) — the highest it may be',
          returns: 'double — the value, held between min and max',
          description: 'Holds a number inside a range: anything under min becomes min, anything over max becomes max.',
          example: 'double volume = Math.Clamp(requested, 0.0, 1.0);\nconst int MaxTakes = 99;\nint take = (int)Math.Clamp(next, 1, MaxTakes);' },
      ] },
    ],
  },
  nodes: { systems: [] },
  reference_urls: { urls: [{ title: 'C# language reference', url: 'https://docs.example/csharp/reference' }] },
  corrections: { corrections: [] },
}

const CODING_SUBJECT_ROWS = [
  {
    n: 5, slug: 'types-and-variables', title: 'Types and variables', skill_level: 'beginner', estimated_hours: 2, is_stub: false,
    description: 'Value types and reference types, and what assignment really copies.',
    sections: [
      { id: 'section_1', title: 'Value types and reference types', description: 'What a variable holds.', estimated_minutes: 40, lessons: [
        lesson('lesson_1_1', 'Value types, reference types, and why a struct copies itself when you assign it',
          '## What a variable holds\n\nA **value type** (`int`, `double`, a `struct`) holds its data. A **reference type** (a `class`, a `string`, a `List<T>`) holds a reference to data that lives elsewhere, so two variables can point at the same object and a change through one is seen through the other.\n\n```csharp\nstruct ShotFrame { public int In; public int Out; }\n\nvar a = new ShotFrame { In = 1001, Out = 1048 };\nvar b = a;      // a copy: b is its own frame range\nb.Out = 1060;   // a.Out is still 1048\n```\n\nAssigning a struct copies every field. Assigning a class copies the reference, which is why a list handed to a method can come back changed.\n\n```csharp\nvar takes = new List<string> { "A001" };\nAddTake(takes);                 // the method sees the same list\nConsole.WriteLine(takes.Count); // 2\n\nstatic void AddTake(List<string> list) => list.Add("A002");\n```',
          ['A struct is copied on assignment; a class is shared.', 'Strings are reference types that behave like values: they never change in place.'],
          'Write a struct for a frame range and a class for a shot; assign each to a second variable, change the copy, and print both.'),
        lesson('lesson_1_2', 'Nullable values',
          'A value type cannot be `null` unless you ask for it with `?`: `int? rating` is "a rating, or none yet". Test it with `rating.HasValue`, or read it with a fallback: `rating ?? 0`.',
          ['`int?` is an int that may be missing.']),
      ] },
      { id: 'section_2', title: 'var, const and readonly', description: 'Saying what may change.', estimated_minutes: 30, lessons: [
        lesson('lesson_2_1', 'var is still strongly typed',
          '`var` lets the compiler write the type for you; the variable still has exactly one type, decided at compile time.\n\n```csharp\nvar count = 3;          // int\nvar name = "Salt Hours"; // string\n// count = "three";     // does not compile\n```',
          ['var is inference, not dynamic typing.']),
      ] },
    ],
  },
  {
    n: 6, slug: 'classes-structs-and-records', title: 'Classes, structs and records', skill_level: 'beginner', estimated_hours: 3, is_stub: true,
    description: 'Three ways to define a type, and when each one fits game and production data.',
    sections: [],
    section_outlines: [
      { id: 'section_1', title: 'Classes and objects', description: 'Fields, properties, constructors, and what `new` does.', lesson_count: 3 },
      { id: 'section_2', title: 'Structs and records', description: 'Value semantics, `with` expressions, and equality you get for free.', lesson_count: 2 },
    ],
  },
]

export const CODING_SUBJECTS = CODING_SUBJECT_ROWS.map(({ n, slug, title, skill_level, estimated_hours, is_stub, description, sections, section_outlines }, i) => ({
  id: fid('subject', n),
  workspace_id: WORKSPACE_ID,
  course_id: CODING_COURSE_ID,
  owner_id: MEMBER_ID.sofia,
  slug,
  title,
  description,
  skill_level,
  is_stub,
  subject_order: i,
  estimated_hours,
  sections,
  section_outlines: section_outlines ?? sections.map(s => ({ id: s.id, title: s.title, lesson_count: s.lessons.length })),
  sources: is_stub ? [] : [{ title: 'C# language reference', url: 'https://docs.example/csharp/reference' }],
  prerequisites: i === 0 ? [] : [CODING_SUBJECT_ROWS[i - 1].slug],
  deleted_at: null,
  deleted_by: null,
  created_at: stamp(-19 + i, 10),
  created_by: MEMBER_ID.sofia,
  updated_at: stamp(30 - i, 10),
  updated_by: MEMBER_ID.sofia,
}))
