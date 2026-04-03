export const OTTER_HELP_SIDEBAR_ITEMS = [
  { id: 'otter-overview', label: 'Overview' },
  { id: 'otter-getting-started', label: 'Getting Started' },
  { id: 'otter-courses', label: 'Creating Courses' },
  { id: 'otter-subjects', label: 'Subjects & Lessons' },
  { id: 'otter-study', label: 'Study Mode' },
  { id: 'otter-quizzes', label: 'Quizzes & Challenges' },
  { id: 'otter-hotkeys', label: 'Hotkey Reference' },
  { id: 'otter-nodes', label: 'Nodes Reference' },
  { id: 'otter-companion', label: 'Companion' },
  { id: 'otter-import-export', label: 'Import & Export' },
  { id: 'otter-shortcuts', label: 'Keyboard Shortcuts' },
]

// Light-theme style tokens matching HelpPage's L constants
const L = {
  sectionTitle: 'text-sm font-bold text-stone-900 uppercase tracking-wide mb-3',
  bodyText: 'text-xs text-stone-800 leading-relaxed',
  card: 'bg-white/40 p-3 rounded-sm border border-stone-400/30',
  cardTitle: 'text-xs font-bold text-stone-900 mb-2',
  listItem: 'text-[11px] text-stone-700 leading-relaxed',
  listBold: 'text-stone-900',
  notesBox: 'bg-orange-600/10 border border-orange-600/30 rounded-sm p-3',
  notesTitle: 'text-xs font-bold text-stone-900 uppercase tracking-wide mb-2',
}

// Dark-theme style tokens for in-tool help modal
const D = {
  sectionTitle: 'text-sm font-bold text-orange-400 uppercase tracking-wide mb-3',
  bodyText: 'text-xs text-stone-300 leading-relaxed',
  card: 'bg-stone-900 p-3 rounded-sm border border-stone-700',
  cardTitle: 'text-xs font-bold text-orange-400 mb-2',
  listItem: 'text-[11px] text-stone-300 leading-relaxed',
  listBold: 'text-orange-400/70',
  notesBox: 'bg-orange-500/10 border border-orange-500/30 rounded-sm p-3',
  notesTitle: 'text-xs font-bold text-orange-400 uppercase tracking-wide mb-2',
}

export function OtterHelpContent({ helpPage, theme }) {
  const T = theme === 'dark' ? D : L;
  if (helpPage === 'otter-overview') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>O.T.T.E.R. Overview</h3>
        <p className={`${T.bodyText} mb-4`}>
          O.T.T.E.R. (On-demand Training & Technical Education Resource) is an AI-powered learning platform
          for mastering software tools, keyboard shortcuts, and coding languages. Generate structured courses
          with lessons, quizzes, and reference material — all powered by Claude.
        </p>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Key Features</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>AI course generation</span> — Create full course outlines or individual subjects from a single prompt</li>
              <li>• <span className={T.listBold}>Structured lessons</span> — Organized into sections and lessons with content, takeaways, and practice prompts</li>
              <li>• <span className={T.listBold}>Multiple quiz types</span> — Multiple choice, code identification, and code writing challenges</li>
              <li>• <span className={T.listBold}>Hotkey & function reference</span> — Auto-generated reference tables for keyboard shortcuts and API functions</li>
              <li>• <span className={T.listBold}>Nodes reference</span> — Searchable node library for node-based software with color-coded type badges</li>
              <li>• <span className={T.listBold}>Full-text search</span> — Search across all lessons, hotkeys, and functions</li>
              <li>• <span className={T.listBold}>Progress tracking</span> — Mark lessons as complete and track progress per subject</li>
              <li>• <span className={T.listBold}>Import/Export</span> — Share courses between devices or back up your library</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-getting-started') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Getting Started</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Step 1: Set Your API Key</h4>
            <p className={T.listItem}>
              Make sure your Anthropic API key is set in <span className={T.listBold}>System Settings</span>.
              O.T.T.E.R. uses the same shared API key as D.O.G.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Step 2: Create a Course</h4>
            <p className={T.listItem}>
              Click the <span className={T.listBold}>New</span> button in the left sidebar. Choose between creating a
              full course (generates multiple subject outlines) or a single subject (generates detailed lesson content).
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Step 3: Generate Content</h4>
            <p className={T.listItem}>
              Enter a prompt describing what you want to learn. For courses, enter the software/language name.
              For subjects, describe the specific topic. O.T.T.E.R. will generate structured content with lessons.
            </p>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Step 4: Study & Quiz</h4>
            <p className={T.listItem}>
              Read through lessons, mark them complete, then test your knowledge with quizzes. The Quiz Center
              lets you select which courses and subjects to be quizzed on.
            </p>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-courses') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Creating Courses</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Full Course Generation</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Creates multiple subject outlines</span> for a software tool or language</li>
              <li>• <span className={T.listBold}>Choose type:</span> "Software" for tools with shortcuts, "Coding Language" for programming with functions</li>
              <li>• <span className={T.listBold}>Set skill level:</span> Beginner, Intermediate, or Advanced controls depth of content</li>
              <li>• <span className={T.listBold}>Subject outlines are stubs</span> — click "Generate" on each to fill in lesson content</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Single Subject Generation</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Generates complete lesson content</span> for one specific topic</li>
              <li>• <span className={T.listBold}>Auto-generates hotkeys</span> for software-type courses</li>
              <li>• <span className={T.listBold}>Auto-generates functions</span> for coding language-type courses</li>
              <li>• <span className={T.listBold}>Content includes</span> explanations, key takeaways, and practice prompts</li>
            </ul>
          </div>
          <div className={T.notesBox}>
            <h4 className={T.notesTitle}>Tip</h4>
            <p className={T.listItem}>
              You can customize the generation prompts in the O.T.T.E.R. settings panel (hamburger menu icon).
              Edit the system prompt to get different styles of content generation.
            </p>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-subjects') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Subjects & Lessons</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Subject Structure</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Each course contains subjects</span> — individual topics to study</li>
              <li>• <span className={T.listBold}>Subjects contain sections</span> — groups of related lessons</li>
              <li>• <span className={T.listBold}>Sections contain lessons</span> — individual pages of content to read</li>
              <li>• <span className={T.listBold}>Stub subjects</span> are outlines that need content generated</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Managing Subjects</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Delete subjects</span> by hovering and clicking the trash icon</li>
              <li>• <span className={T.listBold}>Undo/Redo</span> subject deletion via the Edit menu</li>
              <li>• <span className={T.listBold}>Add subjects</span> by clicking "+ Add subject" under a course</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-study') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Study Mode</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Reading Lessons</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Select a lesson</span> from the lesson sidebar on the right</li>
              <li>• <span className={T.listBold}>Content is rendered as Markdown</span> with syntax highlighting for code blocks</li>
              <li>• <span className={T.listBold}>Key takeaways</span> are shown at the bottom of each lesson</li>
              <li>• <span className={T.listBold}>Practice prompts</span> give you exercises to try</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Progress Tracking</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Mark lessons complete</span> with the checkmark button</li>
              <li>• <span className={T.listBold}>Progress bar</span> shows completion percentage per subject</li>
              <li>• <span className={T.listBold}>Navigate between lessons</span> using the arrow buttons</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-quizzes') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Quizzes & Challenges</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Quiz Types</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Multiple Choice</span> — Answer questions with 4 options, get immediate feedback and explanations</li>
              <li>• <span className={T.listBold}>Code Identification</span> — Identify what code does or find errors in code snippets</li>
              <li>• <span className={T.listBold}>Code Writing</span> — Write code solutions in an integrated Monaco editor with hints and solutions</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Quiz Center</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Select courses and subjects</span> to include in your quiz</li>
              <li>• <span className={T.listBold}>Choose quiz type(s)</span> — can combine multiple types in one session</li>
              <li>• <span className={T.listBold}>Quizzes are preserved</span> when navigating away and coming back</li>
              <li>• <span className={T.listBold}>Score summary</span> shown at the end of each quiz</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-hotkeys') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Hotkey & Function Reference</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Keyboard Shortcuts (Software Type)</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Auto-generated</span> when subjects are generated for software-type courses</li>
              <li>• <span className={T.listBold}>Organized by category</span> (e.g., File, Edit, View, Navigation)</li>
              <li>• <span className={T.listBold}>Shows Windows and Mac</span> shortcuts side by side</li>
              <li>• <span className={T.listBold}>Merged across subjects</span> — new shortcuts are added to existing categories</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Functions Reference (Coding Language Type)</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Auto-generated</span> when subjects are generated for coding language-type courses</li>
              <li>• <span className={T.listBold}>Organized by category</span> with name, syntax, parameters, returns, and description</li>
              <li>• <span className={T.listBold}>Includes code examples</span> for each function</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-nodes') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Nodes Reference</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>What is the Nodes Page?</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>A searchable library</span> of node definitions for node-based software (Blender, Houdini, ComfyUI, etc.)</li>
              <li>• <span className={T.listBold}>Documents every node</span> with its description, all inputs, all outputs, and usage requirements</li>
              <li>• <span className={T.listBold}>Color-coded type badges</span> for quick visual identification of input/output types (Float, Shader, Geometry, etc.)</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Switching Node Systems</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Use the dropdown</span> at the top to switch between node-based software entries</li>
              <li>• <span className={T.listBold}>Each node system</span> is a separate course (e.g., "Blender 5.0 (Shaders)" vs "Blender 5.0 (Geometry Nodes)")</li>
              <li>• <span className={T.listBold}>Only node_software type</span> courses appear in the Nodes tab dropdown</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Node Cards</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Node name</span> displayed prominently at the top</li>
              <li>• <span className={T.listBold}>Inputs section</span> lists each input with name, type badge, and description</li>
              <li>• <span className={T.listBold}>Outputs section</span> lists each output with name, type badge, and description</li>
              <li>• <span className={T.listBold}>Notes section</span> shows requirements, limitations, or workflow tips</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>How Nodes are Generated</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Auto-generated</span> when subjects are generated for node_software-type courses</li>
              <li>• <span className={T.listBold}>Merged across subjects</span> — new nodes are added to existing categories without duplicates</li>
              <li>• <span className={T.listBold}>Imported/exported</span> along with other course data</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-companion') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Companion</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>AI Pet Companion</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Visible on all pages</span> — your companion follows you across the app</li>
              <li>• <span className={T.listBold}>Click the sprite</span> to open/close the chat window (or press Enter)</li>
              <li>• <span className={T.listBold}>Ask questions</span> about what you're learning — it has context about your courses</li>
              <li>• <span className={T.listBold}>Rate responses</span> with thumbs up/down to help it learn your preferences</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Pet Lifecycle</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Egg</span> — Pet the egg to hatch it (2-4 pets needed)</li>
              <li>• <span className={T.listBold}>Baby</span> — Hatches with random breed and gender. Evolves to adult over time</li>
              <li>• <span className={T.listBold}>Adult</span> — Fully grown. Needs regular feeding and attention</li>
              <li>• <span className={T.listBold}>Death</span> — If hunger reaches 0, pet dies. Ghost appears, allowing you to create a new egg</li>
              <li>• <span className={T.listBold}>8 breeds</span> — Otter, Bird, Octopus, Blob, Rabbit, Pig, Monkey, and the rare Demon (2% chance)</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Pet Mode</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Toggle in System Settings</span> under the Companion section</li>
              <li>• <span className={T.listBold}>When ON:</span> Full Tamagotchi experience with hunger, sleep, and mood</li>
              <li>• <span className={T.listBold}>When OFF:</span> Helper-only chatbot — no mechanics, just a study assistant</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-import-export') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Import & Export</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Exporting</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Edit menu → Export All</span> — Downloads a JSON file with all courses, subjects, progress, hotkeys, functions, and nodes</li>
              <li>• <span className={T.listBold}>Export format</span> is versioned (v2.0) for forward compatibility</li>
              <li>• <span className={T.listBold}>Use for backups</span> or transferring between devices</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Importing</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Edit menu → Import Subjects</span> — Load a previously exported JSON file</li>
              <li>• <span className={T.listBold}>Supports both v2.0 format</span> and legacy single lesson plan exports</li>
              <li>• <span className={T.listBold}>Imported courses are merged</span> into your existing library</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  if (helpPage === 'otter-shortcuts') return (
    <div className="space-y-5">
      <section>
        <h3 className={T.sectionTitle}>Keyboard Shortcuts</h3>
        <div className="space-y-3">
          <div className={T.card}>
            <h4 className={T.cardTitle}>Navigation</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Space</span> — Open search modal (when not typing in an input)</li>
              <li>• <span className={T.listBold}>Enter</span> — Toggle companion chat (when not typing in an input)</li>
              <li>• <span className={T.listBold}>Escape</span> — Close modals and search</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Search</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Arrow Up/Down</span> — Navigate search results</li>
              <li>• <span className={T.listBold}>Enter</span> — Go to selected search result</li>
              <li>• <span className={T.listBold}>Escape</span> — Close search modal</li>
            </ul>
          </div>
          <div className={T.card}>
            <h4 className={T.cardTitle}>Zoom</h4>
            <ul className={`${T.listItem} space-y-1 ml-2`}>
              <li>• <span className={T.listBold}>Ctrl + =</span> — Zoom in</li>
              <li>• <span className={T.listBold}>Ctrl + -</span> — Zoom out</li>
              <li>• <span className={T.listBold}>Ctrl + 0</span> — Reset zoom</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )

  return (
    <div className="text-center py-8 text-stone-600 text-sm">
      Select a topic from the sidebar
    </div>
  )
}
