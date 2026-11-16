# WILSON — M.O.T.H. (Mapping, Organization & Tagging Hub): Planning Brief

**For:** the controller (Claude Code), to produce a session plan. **Not** a build brief: no code is written from this document directly. **From:** Audrey, design conversation of 2026-11-01. **Tool name:** M.O.T.H. — Mapping, Organization & Tagging Hub, said "Moth" (named by Audrey, 2026-11-01) (working title "the graph tool" below; "the graph tool" below means Moth; WILSON tools carry acronym names like D.O.G., O.T.T.E.R., R.A.B.B.I.T.).

---

## 0. What we are asking you to do

1. Read this brief, then measure the repository against it (`docs/OUTSTANDING.md`, `docs/SYSTEMS_HANDBOOK.md`, `PLAN_TO_1_0.md`, `PLAN_WEEK_2026-11-04.md`, the files tables, tags (0085), notes, bins, realtime and the custom table views (0098, 0099)). Every claim below about the code is a hypothesis until measured (rule 6).
2. Write a **plan document** (`docs/sessions/PLAN_MOTH.md`) that covers **every section of this brief**, with each section either assigned to a session, deferred with a reason, or flagged as a question for Audrey.
3. Split the work into **few, long sessions** (see §11). Each session gets a brief and ends in a hand-off in protocol order so the next session starts cold.
4. Put open decisions to Audrey as **multiple choice**, each option self-contained, the recommended one marked "(Recommended)". Do not start a build session until she has answered the ones that block it.
5. Update the release plan to match Audrey's ruling on where this sits (§12): this tool ships as part of the release.

---

## 1. What the tool is

A **visual world of a project's files and everything connected to them**, in the spirit of Obsidian's graph view, but built for WILSON's real structure: folders inside folders, assets, tasks, scenes, shots, bins, notes and the relationships WILSON already stores.

**Who it is for:** creatives: creative directors, art directors, artists. R.A.B.B.I.T. is the producer's tool; this is the creative's. That changes the brief: **the feel is a feature.** A visually beautiful tool gets used.

**The mood:** clean, airy, dreamlike, almost ethereal. Reference: **Flora AI's** canvas (clean interface, nodes placed freely, soft and spacious). Audrey's phrase for the hover previews: *like looking back through memories*. Build for that mood, not just the mechanics. It must still obey the house contrast rule where it applies (on orange, white or black, never grey) and use the kit (`src/ui/`).

**Editing is in scope from the start.** This is not a read-only viewer: people move files, link things, tag things and build boards inside it.

### 1.1 The look: the light (⭐ Audrey, 2026-11-01)

Moths are drawn to light, so the world has a light at its centre.

- **The glow:** a soft gradient radiating from the centre of the viewport, behind every dot and line.
- **Its size and brightness follow the size of the whole project**, not the folder you are in. It shows the feeling of the overall project and must not jump as you move between folders. One or two items: a faint first flicker, like Claude's glow when it speaks. A large project: a sun, a bright white core with slowly shifting colours around it.
- **Glow colour** is a person's choice in the Settings panel (§3.1).
- **Readability over the core:** any text or dot over the bright centre gets a very subtle soft shadow. It must pop and read easily, and must fade in smoothly, never snap on.
- **Calm mode:** when the system asks for reduced motion, the colour shifts slow down or hold still.
- **Translucent HUD:** the HUD widgets and pop-ups have some transparency so the world shows through (a soft background blur is fine), unlike the other tools' solid panels. Text on them must still pass the contrast tests.
- **Still one family:** corners, borders, spacing, type and colours come from the kit (`src/ui/`) and the existing tokens, so Moth feels unified with Dog, Otter and Rabbit.

---

## 2. The core idea: one engine, many views

Obsidian is flat (every note on one level, connected by tags and links). WILSON has hierarchy. Do not build two features; build **one graph engine** where a **view** chooses three things:

1. **Which things are dots.** Any mix of: projects, folders, files, assets, tasks, scenes, shots, levels, experiences, bins, notes, tags, boards, (later) people.
2. **Which kinds of lines connect them.** Independently toggleable:
   - **Lives in**: the folder hierarchy (gives the tree view).
   - **Tagged with**: dot to tag dot (gives the flat Obsidian view).
   - **Related to**: WILSON's existing relationships (task to its items via `task_items`, shot to takes, bin file to file, asset links) plus the new hand-drawn and typed links (§6).
3. **How it is laid out.** At least: a free force-directed layout for exploring, and a radial tree (project at the centre, folders branching out).

Examples Audrey named: a **tags-only flat view** of everything; a **project-as-node** view branching to its folders and files.

**Saved views** follow the custom table views pattern (0098): shared per project, the last one used remembered per person. Users can build a view from scratch, save it, and reset.

**Scale:** large projects must not become a hairball. A folder shows as **one dot with a count** until opened. The plan must state a measured budget (dots on screen, frame rate) and how it is met (clustering, level of detail, virtualisation). Replay against a real large project, not a fixture (rule 17).

**Layouts persist.** Creatives think in space: if a person drags a cluster to a corner, it stays there, saved with the view.

---

## 3. The screen: a viewport with a HUD

The graph is a **world you move through** (pan, zoom, fly). The controls are a **heads-up display** fixed to the screen, like a game HUD: the world moves, the widgets do not.

From Audrey's sketch (2026-11-01):

### 3.1 Settings: the view widget (top left) and the Settings panel

⭐ Audrey split settings in two (2026-11-01).

**The toolbar**, like every other tool: **Help** and **Settings** buttons at its right end. Settings is a panel that **slides out from the right**, as in Dog, Otter and Rabbit. It holds the cosmetic options:

- Glow colour (§1.1).
- **Size by:** number of things inside, or recency of change.
- **Colour by** (⭐ brought back): for example file type, tag, or who last touched it.
- Other appearance choices the plan finds.

**The view widget on the HUD (top left)** keeps only what changes how you view the graph:

- Pick a view, save a view, reset to build a new one.
- What shows as dots; line-type toggles (lives in / tagged / related).
- Layout choice.
- **Time slider:** scrub back to see the project as it was at a date; recently changed dots glow softly.
- **Focus depth:** select a dot and show only things one or two steps away; everything else fades into mist.
- **Search** that flies the camera to the match.
- Tag filters (§5): company tags, my personal tags, by tag type.

Board dots keep their own colour whatever colour-by is set to (§7.1).

### 3.2 List view widget (right)

- A **glossary of whatever dot you are inside.** Select the project: it lists everything in it. Select Assets: it updates to the files and folders in Assets.
- **Breadcrumbs** at the top (Project › Assets › Hero) to hop back up.
- In a tags-only view, the list groups by **tag type**, with a count per tag.

### 3.3 Folder widgets (bottom left)

- When you reach the smallest level (a single asset or folder with its files: the 3D model, the concept art, …), a small **scrollable card** shows its contents.
- Cards can be **pinned**: up to **five** at once (⭐ Audrey: five), each scrollable on its own, staying put while you move around the world.
- Drag files **between cards**, or from a card onto the graph.
- Pinned cards are not saved with a view (⭐ Audrey). Instead, a minimal icon in the bottom-left corner opens the folders opened last session; nothing shows until it is pressed, and picking one reopens it as a card.

---

## 4. Interactions

### 4.1 Hover preview

- Rest on a dot about half a second: a preview **blooms** out. Image: enlarges. Video: plays silently. Note or markdown: first lines.
- Press down to drag: the preview vanishes immediately. It never fights with moving.
- Moving away: it fades.

### 4.2 Link versus move (⭐ Audrey's design)

- Drag a dot **near** another: the target **glows**; release inside the glow = **create a link**.
- Drag a dot **onto** another that can contain things (a folder, a board): the target **grows**, as if opening up to receive it; release = **move inside** (a real move of the file).
- A short word by the cursor confirms ("link" / "move into"). **Escape cancels** mid-drag.
- Dragging in empty space only rearranges the picture (saved with the view), never touches data.

### 4.3 All writes go through the existing paths

Every move, link, tag or create goes through the same mutators and adapters as the rest of WILSON (the R.A.B.B.I.T. adapter layer, the files paths), so **undo, edit history, permissions, the lockstep matrix and realtime all apply**. A reviewer can look but not rearrange; denied actions are shown greyed with the reason (`GatedAction`), and `ready` is honoured (`writeGate.test.js`).

---

## 5. Tags

### 5.1 Two tiers (⭐ Audrey)

- **Company tags**: shared by everyone in the company; **controlled by admins** (create, rename, merge, retire).
- **Personal tags**: any person can create their own; private to them.

### 5.2 Keeping it clean

- **Typed tags:** every tag has a type, e.g. *Character: Mira*, *Location: Harbour*, *Software: Blender 5.0*. Tags of one type share a shape and appearance in the graph.
- **Autocomplete** from existing tags; **near-duplicate warning** ("charcter").
- **Typing a personal tag that matches a company tag** nudges the person to use the company tag.
- **Personal tags never travel.** Sharing a file shares the file, not the sharer's personal tags; the receiver never sees them, so two people's "Blender 5.0" never collide.
- **Promotion:** a person nominates a personal tag to become a company tag; an admin approves (mirror O.T.T.E.R.'s nominations, 0064/0069). On approval, matching personal tags fold into the company tag everywhere.
- **Admin merge/rename** applies everywhere at once.

### 5.3 In the graph

A tag can itself be a dot; everything tagged orbits it. That gives the flat Obsidian view for free.

WILSON already has file tags (0085). The plan must measure them and decide whether to **extend** them (types, tiers, wider targets than files) or add alongside, without breaking the Files page.

---

## 6. Relationships and inline linking

### 6.1 Tags versus relationships

- **Tags say what something is.** **Relationships say how two things connect** ("Mira is the sister of Jonah"). Keep them separate.
- A relationship is a line between two dots with an **optional label**. Created by the glow gesture (§4.2) or by typing (§6.2).

### 6.2 Typing links anywhere there is text (⭐ Audrey's idea)

- In **notes** and in **descriptions/notes fields on R.A.B.B.I.T. items** (assets, tasks, scenes, shots, …):
  - `#` adds a tag.
  - `[[` links to a specific thing: a note, an asset, a shot, a file.
- Picking from the list creates the relationship; the line appears in the graph.
- Every item gets a **"Mentioned in"** section (backlinks), so links work both ways.
- The picker **only offers what the person can see**. A link to something the reader cannot see renders as plain text, not a hint.

### 6.3 Notes that cross projects

- New: **workspace-level notes**, not bound to one project, linkable to many (e.g. a coding method, a lighting approach used across four shows). In the graph, projects are islands and these notes are **bridges** between them.
- Today notes are **owner-only with no admin bypass** (private personal content). Workspace notes need sharing; reuse O.T.T.E.R.'s tiers: **personal / shared / company standard**.
- A note linked to a **private project** must not reveal that project to people who cannot see it.
- Links from a person's private notes appear only in **their** graph.

---

## 7. Boards

### 7.1 What a board is (⭐ Audrey)

- A FigJam/Miro-style canvas that **is a folder**. Opening a board dot opens the board.
- **Boards have their own colour** in the graph: the clearest signal that a dot is a place you can step into and work in.
- A **sticky note is a markdown file** in that folder. A **dropped image or video is a real file** in that folder. So the board and the Files page always agree.
- **Embeds from other folders** are **references, not copies**, the way a bin file references footage where it sits.
- **Missing embed:** if the source is deleted or moved, show a **tile with a stop sign** in the middle and a clear sentence ("This file is missing — it may have been moved or deleted").

### 7.2 The toolkit (researched against Miro and FigJam)

- **Shapes:** rectangle, rounded rectangle, circle, oval, triangle, diamond, star, hexagon, arrow shapes, speech bubble; flowchart shapes (process, decision, document, database, terminator, …). Plan to list the final set.
- **Shape style:** fill colour, outline colour, outline **solid / dashed / dotted**, outline thickness, rotation, resize, text inside.
- **Connectors:** straight, curved, elbowed; **solid / dashed / dotted**; **thickness slider**; **arrowhead per end** (none, arrow, open, dot, …); text label on the line.
- **Also:** frames (named sections), free pen drawing, text boxes, sticky notes, snapping and alignment guides, stacking order.

### 7.3 How a board is saved

- **One record per element** in the database (a new table, e.g. `board_elements`), not one blob per board. Each holds: kind, position, size, rotation, stacking order, style (fill, outline, dash pattern, thickness, arrowheads, text).
- **Connectors store their endpoints as element ids** (and anchor), not coordinates: move a shape and its lines follow.
- **Stickies, images, videos and embeds** are elements that **point at a `files` row**; the content lives in the file, the element holds placement and colour.
- Why per-element: two people editing different shapes never overwrite each other; changes broadcast per element; undo and edit history work per element; a drag does not rewrite the whole board.
- Databases live in Supabase (Audrey's standing rule); media stays in the company's chosen storage. Deleting the board's layout records never deletes a file.
- New tables need RLS (the 0014 parent-join pattern where it fits), a pgTAP suite each and their `RLS_TABLES` line **before** anything depends on them (migration rule 10).

### 7.4 Live together (⭐ required)

People must be able to be on a board **at the same time** with **live cursors**, like FigJam.

- **Cursors and "who's here"** use Supabase Realtime **client broadcast and presence**, not database writes.
- **Element changes** are saved as records and broadcast, consistent with WILSON's broadcast-from-database approach; merge last-writer-wins per element (as `state/realtimeMerge.js` does per field). ⭐ Stickies use a soft lock (Audrey, 2026-11-01): while someone types in a sticky it shows their name and a soft glow, and nobody else can edit it until they click away. The lock must release on its own if that person disconnects. Live co-typing (Yjs) stays for longer notes, where WILSON already uses it.
- **The board channel must be authorised**: only people who can see the board may join or send (Realtime authorisation on `realtime.messages`, or equivalent). A private project's board must not reach the workspace channel (compare OUTSTANDING A-R1-04).
- **Cost rules (Audrey is cost-sensitive):** cursor positions about 10 per second, never every frame, smoothed on the receiving end; **send nothing when still**; join the board's channel only while it is open. Measured context: Free includes 2 million messages and 200 peak connections a month, Pro 5 million and 500, $2.50 per extra million; **fan-out counts per receiver**. The plan states the expected messages per person-hour and checks it against the plan in use. Audrey to confirm the spend cap is on.

### 7.5 The board window (⭐ Audrey)

- **One panel that expands inside the tool**, never a separate window or a page change with a tool-to-tool animation.
- **Three sizes:** a smaller framed window over the graph; filling the viewport; fully maximised across the whole tool.
- **A clear way back:** a button and Escape snap straight back to the graph.
- **Pull-away to close** (small framed size only): grab the frame's edge and drag outward; the frame shrinks as you pull; past a set distance it collapses back into its dot. **Resizing is on the corners only** so the two never clash.
- Note handbook rule 54: the kit Dialog does not portal; plan the panel's layering accordingly.

---

## 8. Security and boundaries

- **Legal and finance stay out.** The money-gated folders (`INVOICES`, `FINANCE`, `LEGAL`, `rabbit_money_segment()`) live in their own world. This tool is for the working files in the company's chosen storage. **⭐ Ruled (Audrey, 2026-11-01): money-gated folders and files are excluded from the graph and boards entirely, for everyone, leadership included** (producers and admins already see them in R.A.B.B.I.T. and the Files page). Embeds must refuse them.
- **Nothing appears that the person cannot already see.** No greyed or locked dot that reveals a file exists. RLS is the boundary; the client draws only what it reads.
- **Private projects:** visible only to creator and admins, including their notes' links and boards.
- **Personal tags and private notes** never leak into another person's graph.
- Every new table, function and channel gets its tests with **planted controls** that bite.

---

## 9. Previews and storage (what works where)

- **Desktop app:** previews work (reads the office NAS directly).
- **Web, Petal cloud or the company's S3:** previews work (thumbnails via `storage-read-urls`).
- **Web, company on an office NAS:** no browser previews today. The file gateway only plays **vetted bin clips**; it serves no thumbnails or ordinary files, does no transcoding (ProRes and similar won't play in a browser), and works from outside the office only with the admin switch on.
- **For this tool now:** show a clear state, **"Preview available on the desktop app"**, never a blank dot.
- ⭐ **Teaching the gateway to serve thumbnails and preview files is a separate session after the release** (Audrey, 2026-11-01). It touches the signed-ticket and vetting design. List it in the plan as post-1.0.

---

## 10. What the plan must cover (checklist)

The plan is complete only when each line below is assigned, deferred with a reason, or asked:

1. Data model: views, layouts, pinned cards, tags (types, tiers, nominations), relationships (labels, both directions), workspace notes, boards, board elements; migrations and suites numbered from whatever is free when the session starts (F7 had claimed 0107 and suite 110 but now runs after Moth, so measure what is free).
2. RLS and gates for every new table; exclusion of money-gated content; private projects; personal tags; private notes.
3. The graph engine and rendering library choice, with a measured performance budget and the bundle impact (**lazy-load the tool**; the main bundle is already about 5 MB; every hand-off states the size).
4. The HUD: settings, list view with breadcrumbs, up to five pinned folder cards.
5. Interactions: hover bloom, glow-to-link, grow-to-move, Escape, writes through existing mutators.
6. Tags: tiers, types, autocomplete, duplicate warning, nudge to company tag, promotion, admin merge/rename; relation to existing file tags (0085).
7. Inline `#` and `[[` in notes and R.A.B.B.I.T. descriptions; backlinks; the picker's visibility rule.
8. Workspace notes with personal / shared / company-standard tiers.
9. Boards: toolkit, per-element save, file-backed stickies and media, reference embeds, stop-sign missing state, board colour.
10. Live boards: presence, cursors, authorised channels, cost rules with a measured message estimate.
11. The board window: three sizes, way back, pull-away close, corner resize.
12. Desktop and web behaviour per storage mode (§9), including the desktop-only preview state.
13. The lockstep invariant if any project-role rule changes; `GatedAction` and `ready` everywhere.
14. Tests: mounted React tests for the HUD and board window, pgTAP for every table, planted controls, a real-data replay for scale.
15. Docs: the Systems Handbook, `CHANGELOG.md`, `RELEASE_TESTING.md` if UI strings ship, `OUTSTANDING.md` at each session's end, one walkthrough per session for Audrey.
16. The **caller check** (rule 19): every new export has a caller before commit.
17. Post-1.0 list: gateway previews; anything else deferred.

---

## 11. Session shape

⭐ Audrey prefers **a few long sessions** over many short ones ("not 20 sessions"). Recommendation for the plan to test against the code:

- **Session 0 — Design and plan** (a separate read-only planning pass, run from ASTRA\_MOTH\_PLAN\_PROMPT.md, that produces PLAN\_MOTH.md): measure, write the plan, the data model, and Audrey's questions. No code.
- **Session 1 — The graph and its views:** engine, layouts, saved views, the HUD (settings, list view, folder cards), hover previews, glow/grow interactions, moves through existing paths, storage-mode preview states.
- **Session 2 — Tags, links and notes:** typed company and personal tags, nominations, inline `#` and `[[`, backlinks, workspace notes with tiers.
- **Session 3 — Boards, live:** board elements, the toolkit, file-backed stickies, embeds, missing state, the board window, presence and cursors.
- **After the release — Gateway previews** for NAS companies on the web.

Each build session may be long; if one stalls it gets "continue", not a new session. Each ends with a hand-off (protocol order, at most 200 lines) so the next session can start cold, plus the two closing items in chat: the remaining sessions, and a plain-English breakdown for Audrey. The **two adversarial review rounds** stay for every build session. If the plan finds a session too large, it says why and proposes the smallest split, not a long list.

---

## 12. Audrey's decisions and open questions

**Ruled by Audrey, 2026-11-01:**

1. **Release position.** What has been called 1.0 is the baseline, and it is already reached. This tool is now **part of the release**: the release and the v1.0.0 tag wait until it is built. Work starts now, not after a tag.
2. **The week plan moves.** Optimisation waves 2–4 in `PLAN_WEEK_2026-11-04.md` (F4–F12) run **after** this tool is built, so they optimise the finished code. Wave 1 stays done. The plan updates `PLAN_WEEK_2026-11-04.md` and `PLAN_TO_1_0.md` to say so. Flag one thing that does not move: TPN-AI-009's AI-files sweep is still due before 2026-11-09.
3. **Legal and finance are hidden in this tool for everyone.** Producers see them in R.A.B.B.I.T. and the Files page.
4. **Pinned folder cards are not saved with views.** A minimal recent-folders icon replaces that (§3.3).
5. **Name:** M.O.T.H., Mapping, Organization & Tagging Hub, said "Moth".

**Also ruled:**

6. **Sticky notes when two people edit the same one at once:** a soft lock with the editor's name and a glow; Yjs co-typing stays for longer notes (§7.4).

---

## 12a. More of Audrey's rulings (2026-11-01)

1. **Desktop-only projects appear in Moth.** No live boards or cursors there (one person, working alone). Data already in Supabase still comes from Supabase; data and files stored only on that computer show their latest state. The plan states what each feature does on a local project.
2. **Moth reopens on the person's last view**, from the second visit on.
3. **"What do you want to map?" window:** shown on the very first visit (the empty state) and whenever the person presses the new-view button in the view widget. Simple. It includes two quick starts: **everything by tags** and **everything by folders**, across every project the person is assigned to and can see. Projects appear as islands; workspace notes bridge them.
4. **Jumping to other tools:** items in Moth can open in their own tool (a task or asset in Rabbit, a course in Otter, …) after a short confirmation ("You're about to leave Moth and open Otter"). WILSON has exactly one cross-tool event today (`wilson:open-otter-course`); the plan names the new ones.
5. **Deleting from Moth is allowed**, with a confirmation, the usual undo, and a **trash view** in Moth listing what was thrown away, through the existing soft-delete and restore paths.
6. **Lower-powered machines:** a lighter fallback (simpler glow, fewer effects, reduced detail) so it stays smooth on older laptops; the plan states how it is chosen.
7. **A personal space:** people need their own files, boards and webs for work not tied to one project (for example preparing a pitch). ⭐ Ruled: each person gets one personal space, a single folder that counts as just them, holding everything they have not shared. Items can later be moved into a project. WILSON's private projects (0072) may be the base; the plan measures and decides.

8) **"Move to…" without dragging** (⭐ Audrey): the view widget offers a **Move to** action on the selected item(s). It opens a simple picker (projects and folders the person can write to, with search, plus their personal space) so people who are not comfortable dragging never lose a file. It uses the same move path as drag and drop: confirmation where needed, undo, edit history, permissions.

9. **Personal space privacy:** only its owner sees it in Moth. Workspace admins can reach it from the **Files view only** (an IT and leadership need, for example when someone leaves), never in Moth. The plan states the RLS shape and tests both sides.
10. **Personal space storage:** personal files live in the **company's chosen storage**, like project files, so a move into a project never relocates the file body.
11. **Pen and touch, adaptive:** boards and the graph support pen drawing, finger panning and pinch-to-zoom. The moment a pen or finger touches the screen, the interface **adapts**: larger touch targets and slightly changed icons and buttons that are easier to hit. The moment a mouse moves again, it **switches back** to the mouse-and-keyboard layout. The switch animates smoothly, never snaps, and must not flicker on devices that send both kinds of input.

## 13. House rules that apply

Model stated on each session's first line (code on Opus 5.5; design and reviews on Fable). The brief's list is the scope; findings outside it go to `OUTSTANDING.md`. Merge the checked commit by hash. Ask before merging to `main` or tagging. Never commit a secret (the repo is public). Measure before asking her to rule. Never let a diagnosis read as a fix. Where this brief and ASTRA\_MOTH\_PLAN\_PROMPT.md disagree on how to plan, follow the prompt; the design decisions in this brief still stand.
