# WILSON v0.5.4 — Implement NODES Reference Page in O.T.T.E.R.

## Overview

Add a **NODES** reference page to the O.T.T.E.R. tool inside WILSON. This page works exactly like the existing **Hotkeys** and **Functions** reference pages — a searchable, categorized library of node definitions with a dropdown to select which software/node-system to view.

Software like Blender has **multiple node systems** (Shader Nodes, Geometry Nodes, Compositor Nodes, etc.). Each node system should appear as a **separate dropdown entry** so the user sees only nodes from that specific system. For example:
- "Blender 5.0 (Shaders)" — only shader nodes
- "Blender 5.0 (Geometry Nodes)" — only geometry nodes
- "Blender 5.0 (Compositor)" — only compositor nodes
- "Houdini 21 (VOPs)" — only VOP nodes
- "Houdini 21 (SOPs)" — only SOP nodes
- "ComfyUI" — all ComfyUI nodes (single system)
- "TouchDesigner (TOPs)" — only TOP operators
- "TouchDesigner (CHOPs)" — only CHOP operators
- "Unreal Engine 5 (Blueprints)" — Blueprint nodes
- "Unreal Engine 5 (Materials)" — Material nodes

Each node entry must clearly document:
- **What the node does** (description)
- **All inputs** with their variable types and what they accept
- **All outputs** with their variable types and what they produce
- **Any requirements** — what the node needs to work (e.g., "Requires a Geometry input to function", "Must be connected to a Material Output node")

---

## Project Structure

```
WILSON_v0.5.4/
├── electron/
│   └── main.cjs                          ← Express server + API endpoints
├── src/
│   ├── App.jsx                           ← Main app routing, page management
│   ├── index.css                         ← Global styles + animations
│   ├── components/
│   │   ├── Home.jsx                      ← Home page nav items
│   │   ├── SettingsPage.jsx              ← System settings
│   │   ├── HelpPage.jsx                  ← Help page shell
│   │   ├── PetCompanion.jsx              ← Pet overlay
│   │   └── sprites/index.jsx             ← Pet sprites
│   ├── data/
│   │   └── otterHelpContent.jsx          ← O.T.T.E.R. help content
│   └── tools/
│       ├── deck-outline-generator_v0.514/ ← D.O.G. tool (DO NOT MODIFY)
│       └── otter_v0.3/
│           ├── Otter.jsx                 ← Main O.T.T.E.R. component (~3500 lines)
│           └── prompts.js                ← AI generation prompts
├── package.json
└── vite.config.js
```

**Build commands:**
```bash
export PATH="/c/Program Files/nodejs:$PATH"
npm run build        # vite build
npm run package      # vite build + electron-forge package
```

**DO NOT MODIFY:** `public/extensions/Code.gs`, `public/extensions/Sidebar.html`, anything in `deck-outline-generator_v0.514/`

---

## How Hotkeys & Functions Work (The Pattern to Follow)

### Navigation Tabs (Otter.jsx ~line 1578-1616)

O.T.T.E.R. has a horizontal nav bar with tabs: **Search | Library | Quiz | Hotkeys | Functions**

Hotkeys and Functions are actually the SAME view (`currentView === 'hotkeys'`) rendered by ONE function `renderHotkeys()`. The function checks `activeSoftware?.type`:
- If `type === 'coding_language'` → renders Functions view
- Otherwise → renders Hotkeys (keyboard shortcuts) view

Each tab button auto-selects the first matching software entry when clicked:
```jsx
{/* Hotkeys tab */}
<button onClick={() => {
  if (activeSoftware && activeSoftware.type !== 'coding_language') {
    navigateTo('hotkeys');
  } else {
    const first = softwareList.find(sw => sw.type !== 'coding_language');
    if (first) selectSoftware(first.slug);
    navigateTo('hotkeys');
  }
}}>
  <Keyboard className="w-4 h-4" /> Hotkeys
</button>
```

**For NODES: Add a new separate tab and view.** Unlike Hotkeys/Functions which share a view, Nodes should be `currentView === 'nodes'` with its own `renderNodes()` function. The Nodes tab should filter the software dropdown to show only software that has node-based workflows.

### Content View Rendering (Otter.jsx ~line 1624-1629)

All views are rendered simultaneously but only one is visible:
```jsx
<main className="flex-1 overflow-hidden relative">
  <div className={currentView === 'library' ? 'h-full' : 'hidden'}>{renderLibrary()}</div>
  <div className={currentView === 'prompt' ? 'h-full' : 'hidden'}>{renderPromptInput()}</div>
  <div className={currentView === 'study' ? 'h-full' : 'hidden'}>{renderStudyView()}</div>
  <div className={currentView === 'quiz' ? 'h-full' : 'hidden'}>{renderQuizCenter()}</div>
  <div className={currentView === 'hotkeys' ? 'h-full' : 'hidden'}>{renderHotkeys()}</div>
</main>
```

**Add:** `<div className={currentView === 'nodes' ? 'h-full' : 'hidden'}>{renderNodes()}</div>`

### Data Loading — selectSoftware() (Otter.jsx ~line 196-231)

When a software entry is selected, ALL its data is fetched in parallel and cached:
```jsx
const selectSoftware = useCallback((slug, forceReload = false) => {
  setActiveSoftwareSlug(slug);
  setExpandedSoftware(slug);
  const cached = softwareCacheRef.current[slug];
  if (cached && !forceReload) {
    setActiveSoftware(cached.meta);
    setSubjectList(cached.subjects);
    setActiveProgress(cached.progress);
    setSoftwareHotkeys(cached.hotkeys);
    setSoftwareFunctions(cached.functions || null);
    return;
  }
  Promise.all([
    fetch(`/api/software/${slug}`).then(r => r.json()),
    fetch(`/api/software/${slug}/subjects`).then(r => r.json()),
    fetch(`/api/software/${slug}/progress`).then(r => r.json()),
    fetch(`/api/software/${slug}/hotkeys`).then(r => r.json()),
    fetch(`/api/software/${slug}/functions`).then(r => r.json()).catch(() => ({ categories: [] })),
  ]).then(([meta, subjects, progress, hotkeys, functions]) => {
    softwareCacheRef.current[slug] = { meta, subjects, progress, hotkeys, functions };
    // ... set state
  });
}, []);
```

**Add** `fetch('/api/software/${slug}/nodes')` to the Promise.all array, add `nodes` to cache object, add `setSoftwareNodes(nodes)` state setter.

### renderHotkeys() — Functions Card Pattern (Otter.jsx ~line 2836-2967)

The Functions view renders categorized cards. Here's the structure:

```jsx
function renderHotkeys() {
  const isCodingLang = activeSoftware?.type === 'coding_language';
  // ... filter logic

  // Functions view (this is the pattern to follow for Nodes):
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header with title + search */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-orange-400">Functions Reference</h2>
          <div className="relative">
            <Search className="w-4 h-4 text-stone-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" value={functionSearch} onChange={e => setFunctionSearch(e.target.value)}
              placeholder="Search functions..."
              className="bg-stone-800 text-white border-2 border-stone-600 rounded-sm pl-9 pr-3 py-2 text-sm focus:border-orange-500 focus:outline-none transition-colors w-64" />
          </div>
        </div>

        {/* Software dropdown */}
        <div className="flex items-center gap-3 mb-6">
          <Braces className="w-4 h-4 text-stone-500 shrink-0" />
          <select value={activeSoftwareSlug || ''} onChange={e => { if (e.target.value) selectSoftware(e.target.value); }}
            className="bg-stone-800 text-white border-2 border-stone-600 rounded-sm px-3 py-2 text-sm focus:border-orange-500 focus:outline-none transition-colors cursor-pointer appearance-none pr-8"
            style={{ /* custom chevron SVG background */ }}>
            {codingLanguages.map(sw => <option key={sw.slug} value={sw.slug}>{sw.name}</option>)}
          </select>
        </div>

        {/* Categories with cards */}
        {filtered.map((cat, i) => (
          <div key={i} className="mb-8">
            <h3 className="text-orange-400 font-bold uppercase tracking-wide text-sm mb-3">{cat.category}</h3>
            <div className="space-y-3">
              {cat.functions.map((f, j) => (
                <div key={j} className="bg-stone-800 border-2 border-stone-600 rounded-sm p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:border-stone-500 transition-colors">
                  <code className="font-mono font-bold text-sm" style={{ color: '#fb923c' }}>{f.name}</code>
                  {/* syntax, parameters, returns, description, example fields */}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### State Variables (Otter.jsx ~line 87-90)

Existing hotkey/function state:
```jsx
// ── Hotkey / Functions state ──
const [hotkeySearch, setHotkeySearch] = useState('');
const [softwareFunctions, setSoftwareFunctions] = useState(null);
const [functionSearch, setFunctionSearch] = useState('');
```

**Add:**
```jsx
// ── Nodes state ──
const [softwareNodes, setSoftwareNodes] = useState(null);
const [nodeSearch, setNodeSearch] = useState('');
```

---

## Node Data Model

### JSON Structure (`_nodes.json`)

```json
{
  "categories": [
    {
      "category": "Shader",
      "nodes": [
        {
          "name": "Mix Shader",
          "description": "Mixes two shader inputs based on a factor value. Used to blend materials like combining a diffuse and glossy shader.",
          "inputs": [
            { "name": "Fac", "type": "Float", "description": "Blend factor between 0 (first shader) and 1 (second shader). Default: 0.5" },
            { "name": "Shader", "type": "Shader", "description": "First shader input" },
            { "name": "Shader", "type": "Shader", "description": "Second shader input" }
          ],
          "outputs": [
            { "name": "Shader", "type": "Shader", "description": "The blended shader result" }
          ],
          "notes": "Must be connected to a Material Output node or another shader mixer. The Fac input can be driven by textures for complex material blending."
        }
      ]
    }
  ]
}
```

### Variable Types and Their Badge Colors

Use colored badges/pills next to each input/output type for quick visual scanning:

| Type | Badge Color | Hex |
|------|------------|-----|
| Float | Blue | `#60a5fa` (blue-400) |
| Integer | Indigo | `#818cf8` (indigo-400) |
| Vector | Purple | `#c084fc` (purple-400) |
| Color | Yellow | `#facc15` (yellow-400) |
| Shader | Green | `#4ade80` (green-400) |
| Geometry | Teal | `#2dd4bf` (teal-400) |
| String | Orange | `#fb923c` (orange-400) |
| Boolean | Red | `#f87171` (red-400) |
| Image | Pink | `#f472b6` (pink-400) |
| Object | Amber | `#fbbf24` (amber-400) |
| Collection | Lime | `#a3e635` (lime-400) |
| Material | Emerald | `#34d399` (emerald-400) |
| Mesh | Cyan | `#22d3ee` (cyan-400) |
| Curve | Rose | `#fb7185` (rose-400) |
| Any | Stone | `#a8a29e` (stone-400) |

Render type badges as small inline pills:
```jsx
const TYPE_COLORS = {
  'Float': '#60a5fa', 'Integer': '#818cf8', 'Vector': '#c084fc',
  'Color': '#facc15', 'Shader': '#4ade80', 'Geometry': '#2dd4bf',
  'String': '#fb923c', 'Boolean': '#f87171', 'Image': '#f472b6',
  'Object': '#fbbf24', 'Collection': '#a3e635', 'Material': '#34d399',
  'Mesh': '#22d3ee', 'Curve': '#fb7185', 'Any': '#a8a29e'
};

// Badge component:
<span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
  style={{ background: `${TYPE_COLORS[type]}20`, color: TYPE_COLORS[type], border: `1px solid ${TYPE_COLORS[type]}40` }}>
  {type}
</span>
```

---

## renderNodes() — Card Layout Specification

Each node card should display:

```
┌─────────────────────────────────────────────────────┐
│ Mix Shader                                          │
│                                                     │
│ Mixes two shader inputs based on a factor value.    │
│ Used to blend materials like combining a diffuse    │
│ and glossy shader.                                  │
│                                                     │
│ INPUTS                                              │
│ ├─ Fac        [Float]    Blend factor (0-1)         │
│ ├─ Shader     [Shader]   First shader input         │
│ └─ Shader     [Shader]   Second shader input        │
│                                                     │
│ OUTPUTS                                             │
│ └─ Shader     [Shader]   The blended result         │
│                                                     │
│ ⚠ Must be connected to a Material Output node.      │
└─────────────────────────────────────────────────────┘
```

Follow this JSX pattern for each card:
```jsx
<div className="bg-stone-800 border-2 border-stone-600 rounded-sm p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] hover:border-stone-500 transition-colors">
  {/* Node name */}
  <div className="font-mono font-bold text-sm mb-2" style={{ color: '#fb923c' }}>{node.name}</div>

  {/* Description */}
  <p className="text-xs mb-3 whitespace-pre-wrap" style={{ color: '#a8a29e' }}>{node.description}</p>

  {/* Inputs */}
  {node.inputs?.length > 0 && (
    <div className="mb-3">
      <span className="text-xs font-bold uppercase tracking-wide block mb-1.5" style={{ color: '#78716c' }}>Inputs</span>
      <div className="space-y-1">
        {node.inputs.map((inp, k) => (
          <div key={k} className="flex items-start gap-2 text-xs">
            <span className="font-mono shrink-0 w-28 truncate" style={{ color: '#d6d3d1' }}>{inp.name}</span>
            <TypeBadge type={inp.type} />
            <span style={{ color: '#a8a29e' }}>{inp.description}</span>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* Outputs */}
  {node.outputs?.length > 0 && (
    <div className="mb-3">
      <span className="text-xs font-bold uppercase tracking-wide block mb-1.5" style={{ color: '#78716c' }}>Outputs</span>
      <div className="space-y-1">
        {node.outputs.map((out, k) => (
          <div key={k} className="flex items-start gap-2 text-xs">
            <span className="font-mono shrink-0 w-28 truncate" style={{ color: '#d6d3d1' }}>{out.name}</span>
            <TypeBadge type={out.type} />
            <span style={{ color: '#a8a29e' }}>{out.description}</span>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* Notes/Requirements */}
  {node.notes && (
    <div className="border-t border-stone-700 pt-2 mt-2">
      <span className="text-xs italic" style={{ color: '#78716c' }}>{node.notes}</span>
    </div>
  )}
</div>
```

---

## Backend Changes (electron/main.cjs)

### 1. Add Nodes Endpoints (~after line 224, after Functions endpoints)

```javascript
// ── Nodes endpoints ──
expressApp.get('/api/software/:slug/nodes', (req, res) => {
  const data = readJSON(path.join(getSoftwareDir(), req.params.slug, '_nodes.json'), { categories: [] });
  res.json(data);
});

expressApp.post('/api/software/:slug/nodes/merge', (req, res) => {
  const filePath = path.join(getSoftwareDir(), req.params.slug, '_nodes.json');
  const existing = readJSON(filePath, { categories: [] });
  const incoming = req.body.categories || [];
  const normalizeCat = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const inCat of incoming) {
    const catName = inCat.category || 'General';
    const inNodes = inCat.nodes || [];
    const catNorm = normalizeCat(catName);
    let existCat = existing.categories.find(c => normalizeCat(c.category) === catNorm);
    if (!existCat) { existCat = { category: catName, nodes: [] }; existing.categories.push(existCat); }
    for (const node of inNodes) {
      const normName = (node.name || '').toLowerCase().trim();
      if (!existCat.nodes.some(n => (n.name || '').toLowerCase().trim() === normName)) {
        existCat.nodes.push(node);
      }
    }
  }
  writeJSON(filePath, existing);
  res.json(existing);
});
```

### 2. Initialize `_nodes.json` on Software Creation (~line 127-128)

Add after the existing `_functions.json` initialization:
```javascript
if (!fs.existsSync(path.join(swPath, '_nodes.json'))) writeJSON(path.join(swPath, '_nodes.json'), { categories: [] });
```

### 3. Add to Export-All Endpoint (~line 254-255)

Add `nodes` to the export data alongside hotkeys and functions:
```javascript
const nodes = readJSON(path.join(swDir, slug, '_nodes.json'), { categories: [] });
// ...
return { meta: { slug, ...meta }, hotkeys, functions, nodes, progress, quizHistory, subjects };
```

---

## AI Prompt Changes (prompts.js)

### Add Node Generation to SUBJECT_GENERATION_PROMPT

For software entries that are node-based, the AI should generate relevant nodes alongside lessons. Add a new section to `SUBJECT_GENERATION_PROMPT` (and `SINGLE_SUBJECT_PROMPT`):

**Add this to the FOR SOFTWARE section of both prompts, as an additional option:**

```
FOR NODE-BASED SOFTWARE (type: "node_software"):
Same structure as SOFTWARE, but replace "hotkeys" with "nodes":
"nodes":[{"category":"...","nodes":[{"name":"Node Name","description":"What this node does and when to use it","inputs":[{"name":"Input Name","type":"Float|Integer|Vector|Color|Shader|Geometry|String|Boolean|Image|Object|Collection|Material|Mesh|Curve","description":"What this input accepts and its default value"}],"outputs":[{"name":"Output Name","type":"...","description":"What this output produces"}],"notes":"Any requirements, compatible modes, or important details about using this node"}]}]

CRITICAL NODE RULES:
- Only include nodes that are DIRECTLY RELEVANT to the subject being taught
- Each node must have ALL its inputs and outputs documented with correct types
- Type must be one of: Float, Integer, Vector, Color, Shader, Geometry, String, Boolean, Image, Object, Collection, Material, Mesh, Curve, Any
- Include "notes" for any node that has requirements or gotchas (e.g., "Requires a mesh input", "Only works in EEVEE")
- Max 3 categories, max 6 nodes per category
- Node names must match the exact names used in the software
```

### Add NODES_GENERATION_PROMPT (optional, for standalone node library generation)

```javascript
export const NODES_GENERATION_PROMPT = `You are O.T.T.E.R., documenting a node-based software's node library. Return ONLY a raw JSON object. No markdown, no backticks.

{"categories":[{"category":"Category Name","nodes":[{"name":"Node Name","description":"Clear description of what this node does, when to use it, and how it fits into typical workflows","inputs":[{"name":"Input Name","type":"Float|Integer|Vector|Color|Shader|Geometry|String|Boolean|Image|Object|Collection|Material|Mesh|Curve|Any","description":"What this input accepts, default value if applicable"}],"outputs":[{"name":"Output Name","type":"...","description":"What this output produces"}],"notes":"Requirements, limitations, compatible render engines, or workflow tips. Leave empty string if none."}]}]}

CRITICAL RULES:
- Document EVERY input and output for each node — do not skip any
- Use the EXACT node names as they appear in the software
- Type values must be one of the standard types listed above
- Group nodes into logical categories matching the software's own organization
- Include practical workflow notes where helpful
- Max 8 categories, max 10 nodes per category
- Total response must fit under 8000 tokens
- Raw JSON only. No markdown wrapping.`;
```

---

## Otter.jsx — Full Change List

### 1. Add Lucide Icon Import (~line 7-13)

Add `GitBranch` or `Workflow` or `Share2` icon (for the Nodes tab):
```jsx
import { /* existing imports */, Share2 } from 'lucide-react';
```

(`Share2` resembles a node graph — or use `GitBranch`, `Workflow`, or `Network` depending on what's available in the lucide-react version)

### 2. Add State Variables (~after line 90)

```jsx
// ── Nodes state ──
const [softwareNodes, setSoftwareNodes] = useState(null);
const [nodeSearch, setNodeSearch] = useState('');
```

### 3. Update selectSoftware() (~line 208-215)

Add nodes fetch to Promise.all:
```jsx
Promise.all([
  fetch(`/api/software/${slug}`).then(r => r.json()),
  fetch(`/api/software/${slug}/subjects`).then(r => r.json()),
  fetch(`/api/software/${slug}/progress`).then(r => r.json()),
  fetch(`/api/software/${slug}/hotkeys`).then(r => r.json()),
  fetch(`/api/software/${slug}/functions`).then(r => r.json()).catch(() => ({ categories: [] })),
  fetch(`/api/software/${slug}/nodes`).then(r => r.json()).catch(() => ({ categories: [] })),  // ADD THIS
]).then(([meta, subjects, progress, hotkeys, functions, nodes]) => {  // ADD nodes
  softwareCacheRef.current[slug] = { meta, subjects, progress, hotkeys, functions, nodes };  // ADD nodes
  // ... existing setters
  setSoftwareNodes(nodes);  // ADD THIS
});
```

Also update the cache-hit path to restore nodes:
```jsx
if (cached && !forceReload) {
  // ... existing
  setSoftwareNodes(cached.nodes || null);  // ADD THIS
  return;
}
```

### 4. Add "Nodes" Nav Tab (~after line 1616, after Functions tab)

```jsx
{/* Nodes */}
<button
  onClick={() => {
    // Select first node-capable software if current isn't one
    const nodeCapable = softwareList.filter(sw => sw.type === 'node_software');
    if (nodeCapable.length > 0) {
      if (!activeSoftware || activeSoftware.type !== 'node_software') {
        selectSoftware(nodeCapable[0].slug);
      }
    }
    navigateTo('nodes');
  }}
  className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
    currentView === 'nodes'
      ? 'text-orange-400 border-orange-500 bg-stone-900'
      : 'text-stone-400 border-transparent hover:text-stone-300 hover:bg-stone-700'
  }`}
>
  <Share2 className="w-4 h-4" /> Nodes
</button>
```

### 5. Add renderNodes() View (~after line 1629)

```jsx
<div className={currentView === 'nodes' ? 'h-full' : 'hidden'}>{renderNodes()}</div>
```

### 6. Implement renderNodes() Function (~before renderSettingsPanel())

Full implementation following the `renderHotkeys()` pattern. Filter the software dropdown to only show `type === 'node_software'` entries. Search filters across node name, description, and input/output names. Render categorized cards with the layout described in the Card Layout Specification section above.

### 7. Add Nodes to AI Generation Flow

In the generation functions (where hotkeys/functions are merged after subject generation), add a parallel merge call for nodes:

Find where hotkeys are merged after generation (search for `hotkeys/merge` in Otter.jsx) and add a matching block for nodes:
```jsx
if (data.nodes?.length > 0) {
  await fetch(`/api/software/${activeSoftwareSlug}/nodes/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories: data.nodes })
  });
}
```

---

## Software Type: 'node_software'

The existing `_meta.json` has a `type` field that is either `"software"` or `"coding_language"`. Add a third type: `"node_software"`.

When a user creates a new course and selects a node-based software, the type should be set to `"node_software"`. This type is used to:
1. Filter the Nodes tab dropdown (only show `type === 'node_software'`)
2. Determine which AI prompt section to use (nodes instead of hotkeys)
3. Show the Nodes tab as active/relevant

**Note about the dropdown display names**: When a software has multiple node systems, each system is stored as a separate software entry with a descriptive name. For example:
- Slug: `blender-5-shaders`, Name: `Blender 5.0 (Shaders)`, Type: `node_software`
- Slug: `blender-5-geometry-nodes`, Name: `Blender 5.0 (Geometry Nodes)`, Type: `node_software`
- Slug: `comfyui`, Name: `ComfyUI`, Type: `node_software`

The user creates these as separate courses, each with their own subjects, lessons, and node library.

---

## Help Page Update (src/data/otterHelpContent.jsx)

Add a "Nodes Reference" item to `OTTER_HELP_SIDEBAR_ITEMS` and a corresponding content section in `OtterHelpContent` explaining:
- What the Nodes page is
- How to switch between software/node systems via the dropdown
- How node cards display inputs, outputs, and types
- How nodes are auto-generated with lessons and can also be manually managed

---

## Companion Prompt Update (prompts.js)

Update the `COMPANION_PROMPT` nav bar tabs line to include Nodes:
```
- Nav bar tabs: Library (all courses gallery), Quiz (multiple choice, code ID, code writing), Hotkeys/Functions reference, Nodes reference (for node-based software)
```

---

## Verification Checklist

After implementation:

1. `npm run build` — no errors
2. `npm run package` — creates working Electron app
3. **Nodes tab visible** in O.T.T.E.R. nav bar (after Functions)
4. **Dropdown shows only node-based software** (type === 'node_software')
5. **Search works** — filters across node names, descriptions, input/output names
6. **Node cards render correctly** — name, description, inputs with type badges, outputs with type badges, notes
7. **Type badges are color-coded** per the color table
8. **Data persists** — `_nodes.json` files saved and loaded correctly
9. **AI generation includes nodes** — when generating subjects for node_software, nodes are included and merged
10. **Export includes nodes** — export-all endpoint includes node data
11. **Empty state** — selecting a non-node software or one with no nodes shows appropriate message
12. **Help page updated** — Nodes section documented
