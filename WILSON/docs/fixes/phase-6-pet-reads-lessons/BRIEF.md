# PHASE 6 — THE PET CANNOT READ THE O.T.T.E.R. LESSONS

> **Audrey, 2026-08-10, verbatim:**
> *"for the pet. it is responding but its not reading the content. i asked it
> the simple question of how to scale something in blender, which is in the
> blender content in the otter tool but it told me to look it up myself which
> defeats the whole point of the pet. remember the pet should be able to read
> the lessons etc and help answer questions"*
>
> *"it has the content in the otter pages. please make sure the system knows how
> to read the content of the otter pages"*
>
> ✅ **No open questions. No migration. Purely additive.**
> ⚠️ **This is a BUILD, not a repair.** The capability was never there. Scope it
> honestly and do not let it sprawl into an agent framework.

---

## What is NOT wrong

The pet's AI works. Audrey's screenshot shows Tomithy answering fluently, and
*denying* being connected to Claude — *"Nah, I'm just Tomithy… I run on the AI
that comes built into your workspace."* That is a persona flourish from
`COMPANION_PROMPT`, not an error.

**Do not go looking for a broken connection. There isn't one.**

---

## Root cause — the pet has no path to the content

In `src/App.jsx`, the companion's entire system context is assembled inline:

```js
let context = '\n\n--- CURRENT CONTEXT ---';
context += `\n\nCURRENT WILSON PAGE: ${currentPage}`;
context += `\nAVAILABLE PAGES: Home, D.O.G. ...`;
if (currentPage === 'rabbit') { /* hard-coded RABBIT knowledge block */ }
if (petData) { /* pet status, hunger, feedback history */ }
```

That is all of it. **No course, no subject, no lesson, no reference doc, no
retrieval of any kind.**

The irony worth recording: **R.A.B.B.I.T. — not the learning platform — is the
one tool with a knowledge block.** The tool whose entire purpose is lesson
content has none.

And the pet cannot go and fetch it either. Its request body is:

```js
data = await callAI({
  model: modelFor('pet.chat'),
  max_tokens: 1024,
  system: companionPrompt + context,
  messages: trimmedMessages,
  tool: 'companion',
});
```

**No `tools` array.** It is a plain single-shot chat over a static string. Asked
about scaling in Blender it has literally nothing to read, so it deflects — which
is the correct behaviour for a model with no source, and exactly the wrong
outcome for the product.

---

## The finding that decides the approach

🚨 **There is no client-side tool-execution loop anywhere in WILSON.**

The only `tool_use` handling in the codebase is for **server-side** tools — web
search — in `Validator.jsx` and `Otter.jsx`. Even the O.T.T.E.R. agent's `edit`,
`bulk_edit`, `generate_subject` and `generate_course` tools do not run through
one. `Validator.jsx` even names the gap: `stop_reason === 'tool_use'` *"is the
signal for a CLIENT tool"* — as a thing that is not built.

`ai-proxy` **would** forward a `tools` array — its whitelist passes
`body.tools` through. The missing piece is entirely client-side.

**Building the app's first client tool loop to fix a chat gap is the wrong
trade.** Do it with retrieval instead.

---

## The content, and how to reach it

Everything needed is already behind a mode-agnostic adapter — the same one
O.T.T.E.R.'s own pages read through. That is what makes desktop/web parity free.

### Tables

`otter_courses` — one row per course:

| Field | Shape |
|---|---|
| `slug`, `name`, `course_type`, `skill_level` | scalars |
| `visibility` | `personal` \| `shared` \| `company_standard` |
| `hotkeys`, `functions`, `nodes`, `reference_urls`, `corrections` | JSONB reference docs |

`otter_subjects` — one row per subject:

| Field | Shape |
|---|---|
| `title`, `description`, `skill_level`, `subject_order` | scalars |
| `sections` | JSONB, three deep: `sections[] → lessons[] → key_takeaways[]` |
| `section_outlines`, `sources`, `prerequisites` | JSONB |

⚠️ **Size matters here.** The schema comment records *"Largest real subject on
disk is 48 KB"*, with a 4 MB CHECK as a runaway guard. A library of courses will
not fit in a prompt. This is why it is retrieval and not injection-of-everything.

### Adapter methods that already exist

`course.list`, `course.get`, `subject.list({ slug })`,
`subject.get({ slug, sub })`, `doc.get({ slug, doc })`.

**Audrey's Blender question resolves through `doc.get` for `hotkeys` (scale is
`S`) and/or a transform lesson inside a subject's `sections`.** Both are covered
by methods that exist today.

---

## What to build — retrieve, then inject

Keep the pet single-shot. Do the retrieval *before* `callAI` and extend the
context string that is already being assembled.

1. **List what the user can see.** `course.list`. 🚨 **RLS already scopes this**
   to their `personal` + `shared` + `company_standard` courses, so there is no
   new permission model to design and none to get wrong. Do not add one.
2. **Pick the relevant course and subject** by scoring the question's terms
   against course names, subject titles and section/lesson titles. A local
   keyword match is enough — do not reach for embeddings.
3. **Fetch only what matched** — `subject.get` for the top subject(s), `doc.get`
   for the course's `hotkeys` / `functions` where the question looks like a
   "how do I…" question.
4. **Inject a bounded slice** into `context`, under a clear heading in the same
   style as the existing `RABBIT KNOWLEDGE` block.

### Non-negotiables

- 🚨 **Hard character cap with visible truncation.** One 48 KB subject is fine;
  four are not. Cap it, and make the truncation explicit in the injected text so
  the model knows it is seeing an excerpt.
- 🚨 **Check the status on every retrieval call.** `otterFetch` and `fetch`
  **resolve for every status** — a 404 or an RLS 403 becomes a silent empty
  result, and the pet will confidently answer from nothing. This exact failure
  mode *is* the bug being fixed; do not rebuild it one layer down.
- 🚨 **Empty retrieval must be stated, not papered over.** If nothing matched,
  the pet should say it could not find it in her courses. **It must not invent an
  answer, and it must not deflect as though it never had access.** Both of those
  are the current failure.
- **Do not hard-code course knowledge.** The RABBIT block is a static string
  because RABBIT's structure is fixed. Course content is user data that changes
  every time she edits a lesson — reading it live is the entire point.
- **Cite the source.** When the pet answers from a lesson, it should say which
  course and subject. That is how Audrey will be able to tell retrieval worked at
  all, and it is how she will spot a stale answer.

### Watch the budget

The pet currently runs `max_tokens: 1024` for its reply, and trims history to 40
messages at 2000 chars each. Injected content is **input** tokens, so the reply
cap is unaffected — but the retrieval must not push the request past the model's
window when a long conversation is already in flight. Trim retrieval and history
together, not independently.

---

## What NOT to change

- ❌ **Do not build a client tool loop.** That is a real piece of architecture
  and it deserves its own session with its own brief, not a side effect of this
  one.
- ❌ Do not change `callAI`, `aiProxy.js`, or `ai-proxy`'s whitelist.
- ❌ Do not change `COMPANION_PROMPT`'s personality. Audrey likes Tomithy. The
  problem was never the voice.
- ❌ Do not fork the O.T.T.E.R. adapter or add an O.T.T.E.R.-reading path that
  bypasses it. One definition.
- ❌ Do not add a `visibility` tier or touch RLS. The scoping is already correct.
- ❌ Do not remove the RABBIT knowledge block.
- ❌ No migration.

---

## Risks — what this could break

- **Latency on every message.** The pet is currently one round trip. Retrieval
  adds reads before it. If `course.list` runs on every keystroke-to-send, chat
  will feel slower. Cache the course/subject *index* for the session; fetch
  bodies on demand.
- **Cost.** Injecting lesson content into every message multiplies input tokens
  across every pet conversation, and `ai-proxy` meters spend per workspace.
  Retrieve only when the question looks like it needs content — chat about the
  pet's hunger should not drag a subject in.
- 🚨 **The rate limiter.** `ai-proxy` is rate-limited per workspace. Extra reads
  are Postgres, not Anthropic, so they do not count against it — but confirm that
  before assuming.
- **The pet is on every page**, not just O.T.T.E.R. Decide deliberately whether
  retrieval runs everywhere or only where it makes sense, and say which in the
  close-out.
- ⚠️ **A confidently wrong answer is worse than a deflection.** Today the pet
  says "look it up yourself", which is useless but honest. If retrieval returns a
  near-miss lesson and the pet answers from it as though it were exact, Audrey
  loses the ability to trust any answer. The empty-and-near-miss cases matter
  more than the happy path.

---

## Definition of done

- [ ] Asked "how do I scale something in Blender", the pet answers from the
      Blender course content
- [ ] It names the course and subject it answered from
- [ ] Asked about something not in any course, it says so plainly
- [ ] It never answers from a course the user cannot see
- [ ] Every retrieval call checks its status
- [ ] Injected content is capped and truncation is explicit
- [ ] Chat latency is acceptable on a normal-sized library
- [ ] Identical on desktop and web
- [ ] No client tool loop introduced; `callAI` untouched

---

## Test plan (Audrey)

1. **Ask the original question:** *"how do I scale something in blender"*. It
   should answer from your Blender course, and tell you which part it read.
2. **Ask something only in a lesson body**, not a hotkey — something you know is
   buried inside a subject's text. That tests the deep read, not just the
   reference docs.
3. **Ask about a course you have not made** — something like a Nuke question if
   you have no Nuke course. It should say it cannot find that in your courses.
   **It should not make something up.**
4. **Edit a lesson in O.T.T.E.R., then ask about it.** The pet should reflect the
   edit — it is reading live, not from a snapshot.
5. **As `tester` in your other browser**, ask about a course that is yours and
   not shared. The pet should not be able to see it.
6. **Just chat to it normally** about nothing in particular. It should still feel
   like Tomithy, and it should not have got slower.

⚠️ Point 3 is the one I most want your judgement on. A pet that invents a
plausible answer is worse than the one you have now, and you are the only person
who can tell the difference.
