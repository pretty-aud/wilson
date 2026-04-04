# O.T.T.E.R. Lesson Validator — Implementation Prompt

## Project Context

**App:** WILSON — Electron + Vite + React 19 + Tailwind CSS 4
**Tool:** O.T.T.E.R. (learning platform tool inside WILSON)
**Repo:** `C:\Users\Audrey\Documents\My_Work\Dev_Work\wilson`
**Working branch:** `feature/otter-validator`
**Otter source:** `WILSON/src/tools/otter_v0.3.1/`
**Build:** `cd WILSON && npm run build` (from the WILSON folder)
**Package:** `cd WILSON && npm run package`
**npm path:** `export PATH="/c/Program Files/nodejs:$PATH"`

---

## Feature Overview

Build a **Lesson Validator** agent for the Otter app. This agent reviews lesson content for factual accuracy by cross-referencing with online sources, grades each lesson, and offers to fix incorrect information with user approval.

---

## Architecture

### New Files to Create

```
WILSON/src/tools/otter_v0.3.1/
├── Validator.jsx          # Main validator component
├── validatorPrompts.js    # System prompts for the validator agent
```

### Files to Modify

```
WILSON/src/tools/otter_v0.3.1/Otter.jsx
  - Add 'validator' to the view system
  - Add toolbar button (right end of toolbar)
  - Import and render <Validator />
  - Pass required props down
```

---

## Tech Stack & Patterns

- **State:** All `useState` + `useRef` (no Redux, no Context). Follow existing Otter patterns.
- **Styling:** Tailwind CSS 4 utility classes + inline `style={{}}` for specific colors. The app uses a stone/orange palette:
  - Backgrounds: `bg-stone-900`, `bg-stone-800`, `bg-stone-700`
  - Borders: `border-stone-600`, `border-stone-700`
  - Text: `text-stone-300`, `text-stone-400`, `text-stone-500`
  - Accent: `text-orange-400`, `bg-orange-600`, `border-orange-700`
  - Inline colors: `#fb923c` (orange), `#d6d3d1` (light stone), `#a8a29e` (mid stone), `#78716c` (dim stone), `#44403c` (dark stone)
  - Shadow pattern: `shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]`
- **Icons:** `lucide-react` — all icons the app uses are imported from here
- **API calls:** Direct `fetch()` to Anthropic API (no SDK wrapper). See API section below.

---

## UI Specification

### 1. Toolbar Button

Add a button to the **right end** of the existing Otter toolbar (`<nav>` element). Place it after the last existing button (Nodes/Functions/Braces).

- Icon suggestion: `ShieldCheck` or `ClipboardCheck` from lucide-react
- Label: "Validate" (same style as other toolbar buttons)
- Sets `currentView` to `'validator'`
- The button should be visible at all times (no conditional on software type)

### 2. Validator View — Full Page Layout

This is a **full-page view** that replaces the content area (same pattern as study, hotkeys, nodes views). Rendered conditionally:

```jsx
<div className={currentView === 'validator' ? 'h-full' : 'hidden'}>{renderValidator()}</div>
```

The view has a **left sidebar + right detail panel** layout (like the search modal).

### 3. Left Sidebar (280-300px wide)

The sidebar has three sections stacked vertically:

#### Section A: Validation Setup (top)
- **Dropdown select** for validation scope:
  - "Full Validation" — validates all lessons across all loaded subjects for the active software
  - "Targeted Validation" — user picks specific lessons
- When "Targeted Validation" is selected, show a **hierarchical multi-select** below:
  - Grouped by: **Subject > Section > Lesson**
  - Expand/collapse for subjects and sections
  - Checkboxes on each lesson (multi-select)
  - "Select All" / "Deselect All" buttons
  - Show count of selected lessons
- **"Start Validation" button** — kicks off the queue

#### Section B: Validation Queue (middle)
- Shows lessons currently being validated
- Each item shows: lesson title, status indicator
- Statuses: `queued` (gray), `in-progress` (orange pulse/spinner), `completed` (green check), `failed` (red)
- Active lesson has a spinner icon

#### Section C: Completed Audits (bottom)
- Selectable list of completed audit results
- Each item shows: lesson title, letter grade badge (colored: A=green, B=blue, C=orange, D=red, F=red), accuracy percentage
- Clicking an audit loads its detail in the right panel

### 4. Right Detail Panel — Audit Report

When a completed audit is selected, the right panel shows:

#### Header
- Lesson title
- Software > Subject > Section breadcrumb
- **Letter grade** (large, colored badge)
- **Accuracy percentage** (e.g., "87% accurate — 13% of content flagged")
- Overall summary paragraph from the AI

#### Findings List
- Each finding is a card showing:
  - The specific claim/statement that was checked
  - Verdict: Accurate / Inaccurate / Unverifiable
  - Source(s) referenced by the AI
  - Explanation of what's wrong (if inaccurate)
- Accurate findings can be collapsed/dimmed; inaccurate ones are prominent

#### Fix Action
- **"Fix Issues" button** — triggers the agent to propose corrections
- When clicked, the agent generates fixes for all inaccurate findings
- Each fix shows a **side-by-side A/B comparison**:
  - Left panel: "Current" — the original content with the incorrect section highlighted
  - Right panel: "Proposed" — the corrected content with changes highlighted
  - Use `bg-red-500/10` for removed text, `bg-green-500/10` for new text
- Below each comparison:
  - **"Accept Fix"** button (green) — applies this specific fix to the lesson
  - **"Decline Fix"** button (red/gray) — skips this fix
- **"Accept All Fixes"** button at the top for bulk approval

### 5. Empty / Default States
- When no audit is selected: "Select an audit from the list or start a new validation"
- When queue is empty: "Configure a validation above to get started"

---

## API Integration

### Model-Agnostic Design

The validator must be **model-agnostic**. Create an API helper function that abstracts the provider:

```javascript
// In Validator.jsx or a separate utility
async function callValidatorAPI({ apiKey, model, systemPrompt, messages, signal }) {
  // For now: Anthropic API
  // Structure this so swapping to OpenAI/Gemini later only changes this function
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 8096,
      system: systemPrompt,
      messages,
    }),
    signal,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}
```

### Web Search for Fact-Checking

Use Anthropic's **web search tool** capability to let the model verify claims against online sources. When calling the API for validation, include the web search tool:

```javascript
body: JSON.stringify({
  model,
  max_tokens: 8096,
  system: systemPrompt,
  messages,
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5
  }],
})
```

The model will automatically search the web during its response to verify lesson claims. The response may include `tool_use` and `tool_result` blocks — parse accordingly to extract the final text response.

### API Key

The API key is passed as a prop from Otter:

```jsx
<Validator
  apiKey={apiKey}
  softwareList={softwareList}
  activeSoftwareSlug={activeSoftwareSlug}
  softwareCacheRef={softwareCacheRef}
  subjectCacheRef={subjectCacheRef}
/>
```

---

## Data Access

### Lesson Data Shape

```javascript
// A lesson object:
{
  id: "lesson_1_1",           // Unique within subject
  title: "Introduction to X",
  content: "...",              // Markdown, 350-650 words
  key_takeaways: ["...", "...", "..."],  // Exactly 3
  practice_prompt: "..."       // 1-2 sentence exercise
}

// Lessons live inside sections, inside subjects:
// Subject > sections[] > lessons[]
```

### Accessing Lessons from Cache

```javascript
// Get all subjects for a software:
const cached = softwareCacheRef.current[activeSoftwareSlug];
const subjects = cached?.subjects || [];

// Get full subject with sections & lessons:
const fullSubject = subjectCacheRef.current[`${softwareSlug}/${subjectSlug}`];
// fullSubject.sections[i].lessons[j] gives you each lesson

// You may need to fetch a subject if not cached:
const fullSub = await fetch(`/api/software/${swSlug}/subjects/${subSlug}`).then(r => r.json());
subjectCacheRef.current[`${swSlug}/${subSlug}`] = fullSub;
```

---

## Queue / Execution System

### Design

Each lesson validation is its own independent API call. When the user starts a validation (all or selected), build a queue array of lesson references and process them **one at a time, sequentially, in the background**.

```javascript
const [validationQueue, setValidationQueue] = useState([]);
// Each queue item:
{
  id: `${subjectSlug}/${lessonId}`,
  softwareSlug,
  subjectSlug,
  sectionTitle,
  subjectTitle,
  lessonId,
  lessonTitle,
  status: 'queued' | 'in-progress' | 'completed' | 'failed',
}

const [auditResults, setAuditResults] = useState([]);
// Each result:
{
  id: `${subjectSlug}/${lessonId}`,
  lessonTitle,
  subjectTitle,
  sectionTitle,
  softwareSlug,
  subjectSlug,
  lessonId,
  grade: 'A' | 'B' | 'C' | 'D' | 'F',
  accuracyPct: 87,         // 0-100
  summary: "...",           // AI-generated summary
  findings: [
    {
      claim: "The statement that X...",
      verdict: 'accurate' | 'inaccurate' | 'unverifiable',
      source: "https://...",
      explanation: "This is incorrect because..."
    }
  ],
  fixes: null,              // Populated later when user requests fixes
}
```

### Processing Loop

```javascript
// Use useRef to track abort controller
const abortRef = useRef(null);

// Process queue with useEffect watching the queue
useEffect(() => {
  const next = validationQueue.find(q => q.status === 'queued');
  if (!next || validationQueue.some(q => q.status === 'in-progress')) return;

  // Mark as in-progress, call API, parse result, mark as completed
  // Add result to auditResults
}, [validationQueue]);
```

The user can navigate away from the validator view while the queue processes. The queue continues in the background. When they return, all completed audits are visible.

---

## System Prompts (validatorPrompts.js)

Create two main prompts:

### 1. VALIDATION_PROMPT

Used to audit a single lesson. The model should:
- Read the lesson content carefully
- Use web search to verify factual claims
- Identify specific statements that are accurate, inaccurate, or unverifiable
- Assign a letter grade (A-F) and accuracy percentage
- Return structured JSON

Tell the model to respond in this JSON format:

```json
{
  "grade": "B",
  "accuracyPct": 82,
  "summary": "Overall assessment...",
  "findings": [
    {
      "claim": "The specific statement being evaluated",
      "verdict": "accurate|inaccurate|unverifiable",
      "source": "URL or source name",
      "explanation": "Why this is correct/incorrect"
    }
  ]
}
```

### 2. FIX_PROMPT

Used when the user clicks "Fix Issues". The model receives:
- The original lesson content
- The list of inaccurate findings
- Instructions to produce corrected content

Tell the model to respond in this JSON format:

```json
{
  "fixes": [
    {
      "findingIndex": 0,
      "original": "The exact text being replaced",
      "proposed": "The corrected replacement text",
      "explanation": "What was changed and why"
    }
  ]
}
```

---

## Applying Fixes to Lesson Data

When the user accepts a fix:

1. Get the current lesson from the subject cache
2. Apply the text replacement (original -> proposed) in the lesson content
3. Save the updated subject back to storage via the existing storage API:
   ```javascript
   // Otter uses an Express server for storage:
   await fetch(`/api/software/${swSlug}/subjects/${subSlug}`, {
     method: 'PUT',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(updatedSubject),
   });
   ```
4. Update the subject cache ref so the UI reflects the change

---

## Integration Points in Otter.jsx

### 1. Add import at top of Otter.jsx

```javascript
import Validator from './Validator';
```

### 2. Add toolbar button (after the last existing button in the <nav>)

```jsx
<button
  onClick={() => setCurrentView('validator')}
  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-bold transition-colors border-r-2 border-stone-600 ${
    currentView === 'validator' ? 'bg-orange-600 text-white' : 'text-stone-400 hover:text-white hover:bg-stone-700'
  }`}
  title="Lesson Validator"
>
  <ShieldCheck className="w-4 h-4" />
  <span className="hidden xl:inline">Validate</span>
</button>
```

Add `ShieldCheck` to the lucide-react import at the top of Otter.jsx.

### 3. Add view rendering (alongside the other view divs)

```jsx
<div className={currentView === 'validator' ? 'h-full' : 'hidden'}>
  <Validator
    apiKey={apiKey}
    softwareList={softwareList}
    activeSoftwareSlug={activeSoftwareSlug}
    softwareCacheRef={softwareCacheRef}
    subjectCacheRef={subjectCacheRef}
  />
</div>
```

### 4. Add `ShieldCheck` to the lucide-react import line

---

## Important Notes

- **DO NOT modify** `public/extensions/Code.gs` or `public/extensions/Sidebar.html`
- Follow the existing code style: functional components, hooks, Tailwind utility classes
- All colors must use the existing stone/orange palette
- The validator should be fully self-contained in `Validator.jsx` — it receives everything it needs via props
- Version remains at 0.5.6 for now (will bump when feature is complete)
- Test the build before considering the feature complete: `npm run build`
- When parsing AI JSON responses, always wrap in try/catch — the model may return malformed JSON
- Use `AbortController` for all API calls so they can be cancelled if the user navigates away or starts a new validation
