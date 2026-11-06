# SESSION 43 launch prompt — THE DESIGN PASS

> **The last session before S38.** Everything S33–S42 added has been built for
> correctness and never looked at as a whole. This session looks at it.
>
> 🚨 **THIS IS A DESIGN POLISH. IT CHANGES NO SCHEMA, NO DATA, NO BEHAVIOUR.**
> Audrey, 2026-08-10, verbatim: *"DO NOT CHANGE THE ACTUAL SCHEMAS AND CONTENT.
> THIS SHOULD JUST BE A DESIGN POLISH. THE TABLES, THE INPUT SECTIONS ARE GOOD.
> THEY JUST NEED TO LOOK BETTER REMEMBER TO NOT CHANGE THE FUNCTIONALITY."*
> The single exception is stated in A5, and it is a removal she asked for.

> **STATE — re-measure; this block decays** (last refreshed after **S42**,
> 2026-08-10): migrations **0000–0058** on dev, staging AND prod (next free
> **0059**); pgTAP **66 suites / 1180 assertions** (next suite **67**); vitest
> **1409 / 58 files**. CI green on `abb7aae`.
> 🚨 **Read the working tree, never this block and never memory.**
>
> ⚠️ **EVERY ITEM EXCEPT A5 SHOULD NEED NO MIGRATION AND NO NEW pgTAP SUITE.**
> If you find yourself writing SQL for A1, A2, A3, A4, A6, A7, A8 or any of
> Phase B, stop and re-read the rule above — you have almost certainly found a
> behaviour change wearing a design costume.
>
> 🚨 **A5 IS THE EXCEPTION AND IT IS A REAL ONE.** Audrey's invite-only
> requirement turns out to sit on top of a **public, anon-callable
> company-creation endpoint** (see A5). Closing that is a security fix, not
> polish, and depending on how the invite is issued it may need a
> `platform_audit` CHECK widening — i.e. a migration. **A5 may be too big for
> this session. It is scoped so it can be lifted out cleanly: do A1–A4 and
> A6–A8, ship the checkpoint, and give A5 its own session if it does not fit.**

---

## Start ritual

1. **Load the `wilson-app` skill** and read `visual-language.md`. It is the
   authority on tokens; this brief is the authority on what is currently wrong.
2. **Load the `design-direction` skill and the `laws-of-ux` skill.** Audrey
   asked for both by name. `design-direction` will tell you to consult
   `laws-of-ux` on every interface task — do it, and tie each law to a **named
   element and a decision**, not to a paragraph of intent.
3. **Re-measure**: `git log --oneline -3`, `git status --short`,
   `supabase/.temp/linked-project.json` (must say wilson-dev).
4. **Read `docs/OUTSTANDING.md`** — two entries below are yours to close.
5. **Re-verify every `file:line` in this brief by SYMBOL.** S42 moved several.

---

## Why this exists

Audrey, 2026-08-10, on the login screen:

> *"when you added the username input it messed up the layout. it used to just
> be the single line for the password and it was a reference to the log in for
> the incredibles."*

And on everything else:

> *"in team members there is a white box and white header for the box that
> doesnt fit the visual language. there is also a lot of light gray in all of
> these pages which make it very hard to read against the orange."*

**The through-line is one sentence: the app has a visual language and the newer
screens stopped speaking it.** Auth grew a second input and lost its shape.
Admin, Settings and Resources were built as functional surfaces and inherited a
neutral grey that does not survive contact with `#f4a261`.

---

## 🚨 THE COLOUR RULE — read this before writing a single style

Audrey, verbatim, in capitals:

> *"DO NOT USE GRAY TEXT AGAINST ORANGE AS IT IS HARD TO SEE ONLY WHITE OR
> BLACK."*

> *"keep the orange make the light text black instead."*

**On orange, text is white or black. There is no third option and no "just this
one muted caption".** Grey-on-orange is the single defect that appears on every
screen in this brief, and it is why "hard to read" is the complaint rather than
"ugly".

**MEASURED 2026-08-10** — occurrences of the stone/grey ramp (`#a8a29e`,
`#78716c`, `#d6d3d1`, `#e7e5e4`, `#57534e`, `text-stone-400/500`) in the files
this session touches:

| File | Hits | | File | Hits |
|---|---|---|---|---|
| `UsersSection.jsx` | 34 | | `LogsSection.jsx` | 21 |
| `TeamMembersPage.jsx` | 31 | | `SettingsPage.jsx` | 17 |
| `StorageSection.jsx` | 28 | | `ChangeRequestsSection.jsx` | 13 |
| `CompanySection.jsx` | 11 | | `CreateUserDialog.jsx` | 9 |
| `ModelsSection.jsx` | 8 | | `DiagnosticsSection.jsx` | 6 |
| `AdminTerminalPage.jsx` | 5 | | the rest | 8 |

**~191 occurrences.** Not all of them sit on orange — a grey on dark stone
(`#1c1917`) is fine and must stay. **Fix the ones on orange; leave the ones on
dark.** A blanket find-and-replace is the wrong instrument and will wreck the
dark surfaces, which are currently correct.

⚠️ **Contrast, stated as numbers so it is checkable rather than felt.**
`#f4a261` against `#a8a29e` is roughly **1.4:1** — below every threshold there
is. Black on `#f4a261` is about **9.6:1**; white on `#ea580c` is about
**3.9:1**, which passes for large/bold text and is what `AUTH_TEXT_STYLE`
already uses at 20.5px/600. **So: black on light orange, white on dark orange,
and never grey on either.**

---

# PHASE A — LOGIN AND ONBOARDING

**Do this first, deploy it, and stop.** Audrey wants to look at it on the beta
before Phase B starts (see the checkpoint).

## What exists now, measured

- **`src/cloud/auth/AuthShell.jsx`** owns the whole animation: the two `#ea580c`
  panels, the `#f4a261` content background, the logo card, and the phase machine
  `logo-in → logo-hold → logo-out → idle → split → revealing → done`. It also
  exports `AUTH_TEXT_STYLE` and `AuthCursor`.
- Panels sit at `50vh` in `idle`, open to `SPLIT_BAR_HEIGHT = '28vh'`, and
  compress to `REVEAL_BAR_HEIGHT = '268px'` — which **deliberately matches
  `PAGE_BARS.home` in `App.jsx`** so Home's bars take over invisibly.
- **`LoginScreen.jsx`** has stages `'auth' | 'mfa' | 'workspace'`. Stage `auth`
  renders USERNAME and PASSWORD **in one form** — that is the layout complaint.
- 🚨 **`resolveLogin()` ALREADY ACCEPTS AN OPTIONAL `workspace_slug`** and
  forwards it to the `resolve-login` Edge Function. **The company-first flow in
  A1 therefore needs no new endpoint, no schema change and no migration.**
  Confirm the function honours it before designing around it.
- Password masking is a plain `type="password"` (`LoginScreen.jsx:401`), so the
  browser draws its own dots.
- `AuthCursor` (`AuthShell.jsx:304`) is used at **`NewCompanyWizard.jsx:389,
  464, 480`** and **`NewUserWelcome.jsx:285`**. Those are the blinking lines.

## A1 — Company first, then person

Audrey:

> *"first the user should enter the company name. when the user enters the
> company name, it allows the user to log into the company app. after the user
> enters the company and the system confirms the company exists, then the user
> should see the name and password entry."*

**Two steps, one line visible at a time.** That restores the single-line shape
the screen had before, and it is also the correct information architecture: the
company scopes the person, so asking for it first matches the mental model
rather than the database.

| Step | Shows | On submit |
|---|---|---|
| 1. COMPANY | one input | confirm the company exists; advance |
| 2. SIGN IN | username + password | existing auth path, unchanged |

**Laws that bite here, with the decision each one forces:**

- **Hick's Law** — one decision per screen. Step 1 has exactly one input and one
  action; the workspace chooser (stage `workspace`) becomes unreachable for the
  common single-company case, because the company is already known.
- **Chunking** — the company is a different *kind* of fact from the credential.
  Splitting them is what lets each step be one line.
- **Goal-Gradient** — step 2 must show the confirmed company name as a small
  header above the inputs. It is progress made visible, and it is also the only
  way the user can tell they are signing into the right place.
- **Doherty Threshold** — the existence check must give feedback under 400ms or
  show a state. It is a network call; treat it as one.

🚨 **DO NOT WEAKEN THE ENUMERATION DEFENCE.** `LoginScreen.jsx`'s header
documents it: the same generic error for every failure, and a fake-email sign-in
attempt so timing looks identical for unknown usernames. A company step that
answers "no such company" instantly and distinctly hands an attacker a customer
list. **Decide deliberately** — a constant-time reply with the same generic
copy, or accept that company slugs are not secret and say so in the code. Either
is defensible; drifting into the second by accident is not.

⚠️ **Back must work.** From step 2, the user has to be able to correct the
company without a page reload. Keep the entered company in state.

## A2 — The animation must match the app

Audrey:

> *"lets make sure the transition animation of the orange blocks closing and
> opening to show the light orange works correctly and smoothly like it does
> with the page transitions in the app."*

**The reference is `App.jsx`'s `EASE` and `PAGE_BARS` — not a new curve.**
`AuthShell` already ends on `268px` to match `PAGE_BARS.home`; the step-to-step
motion inside the shell should feel like the same system.

- Step 1 → step 2 is a **content** change, not a page change. The bars should
  move (a small, deliberate re-open as the content grows from one input to two),
  not jump.
- **160–240ms** with `cubic-bezier(0.2, 0, 0, 1)` for the content swap;
  the existing `REVEAL_EASE` and `900ms` height transition stay for the
  shell's own open/close. Do not animate a bar height and a content opacity on
  different curves at the same time — that is what reads as "not smooth".
- ⚠️ `SPLIT_BAR_HEIGHT` is `28vh` and its comment justifies that number by the
  content it has to clear ("LOGIN + 2 labels + 2 inputs + button + link").
  **A1 changes that content, so re-derive the number and update the comment.**
  Leaving a stale justification is how the next session trusts a figure that no
  longer holds.
- `prefers-reduced-motion: reduce` must deliver the end state instantly. Check
  whether the shell honours it today; if not, that is a small, correct addition.

## A3 — Asterisks, not dots

Audrey:

> *"instead of the white dots use the astericks/star that the original app used
> for the password type. so instead of dots/circles it should be **** but how
> you had it before."*

`type="password"` renders `●` because the browser decides. To get `*`:

- `-webkit-text-security: square` is **not** it (that is a square), and
  `disc` is the dot you already have. There is no CSS value for an asterisk.
- **The honest options are:** (a) a masked-value technique — keep the real value
  in state, render `'*'.repeat(value.length)` in a `type="text"` field, or
  (b) a font/`::first-line` trick, which is fragile.

🚨 **(a) HAS A PASSWORD-MANAGER COST AND YOU MUST NOT DISCOVER IT LATE.** A
`type="text"` field is not recognised as a password by browsers or managers:
autofill, "save password", and the reveal toggle all change behaviour, and some
managers will refuse to fill it. **Establish what breaks BEFORE building it**,
and if it breaks saved logins, say so to Audrey rather than shipping a prettier
field that stops her password manager working. The look is worth a lot; it is
not worth silently breaking sign-in for the beta testers.

⚠️ Whatever you choose, `autocomplete`, `name`, and the on-screen keyboard type
must still say "password", and the value must never reach the DOM as plain text.

## A4 — Keep the bars

> *"remember to keep the orange bars for header and footer to keep with the
> visual language of the app."*

Non-negotiable and already true — **the risk is that a layout rewrite quietly
drops them.** They are `AuthShell`'s job, and `AuthShell` should stay the only
thing that draws them. If a screen needs different spacing, change
`SPLIT_BAR_HEIGHT`; do not add a second set of bars in a child.

## A5 — Invite-only company onboarding

Audrey, 2026-08-10:

> *"lets remove the new company button. right now, any one can login and create
> their own company. it needs to be invite only for now."*

...and, refining it:

> *"lets make it that the operator and wilson overall admin can send this as a
> link for when they establish a new company in the operator console for the new
> company to set up their workspace."*

> 🚨 **THIS ITEM IS NOT DESIGN POLISH AND MUST NOT BE TREATED AS SUCH.** It is a
> security fix plus a flow change. It is written here because it belongs to the
> same screens, but it has its own risk profile, its own tests, and possibly its
> own migration. **If it cannot be done properly inside S43, do A1–A4 and A6–A8,
> ship the checkpoint, and give this its own session.** Half-closing it is worse
> than leaving it: a hole everyone believes is shut gets no further attention.

### 🚨 The finding that changes the shape of this

**REMOVING THE BUTTON DOES NOT CLOSE SELF-SERVE COMPANY CREATION.**

`supabase/functions/provision-workspace/index.ts` describes itself, in its own
header, as **"Self-serve company onboarding"** and **"Public endpoint.
Rate-limited aggressively (3/h/IP)"**. It creates a `workspaces` row, an
`auth.users` row and an admin `workspace_members` row.

**It is callable by anyone with the anon key, which the web app ships.** So
today the button is a convenience, not the gate — and after S43 removes the
button, anybody who has ever opened devtools on the beta can still create a
company three times an hour. **The measured caller list is exactly three lines,
all in the file being removed from the login flow** (`NewCompanyWizard.jsx:5,
38, 69), which is what makes closing it tractable.

### The good news: almost all the plumbing already exists

| Need | Already built |
|---|---|
| Operator creates a company | **`operator-workspaces` has a `create` action** (`:430`), behind `requirePlatformOperator`, writing `workspace.created` to `platform_audit` |
| Emailed invite link | **`invite-member` uses `admin.inviteUserByEmail`**, minting a Supabase invite token and sending the `invite.html` template |
| The app handling that link | **`recoveryLink.js` already parses `type=invite`** — and carries a hard-won fix for invites specifically, where the parser returned null and told the invitee *"This link has already been used, or it has expired."* |

**So the flow Audrey describes is mostly assembly, not invention:** the operator
creates the company in the console, the first admin is invited by email, they
click the link and set their own password.

⚠️ **That is also a BETTER security posture than the original plan.** Her first
message said she would *"share with the company the login information"* — this
version means Petal never knows the customer's password, and the credential is
never sent over chat or email. Worth saying out loud so the change is understood
as an improvement rather than extra work.

### What S43 must decide, and what it must not guess

1. **`provision-workspace`: gate it or delete it?** Once nothing calls it,
   deleting is cleanest and leaves no dormant public endpoint. Gating it behind
   `requirePlatformOperator` keeps a path that `operator-workspaces.create`
   already covers. **Confirm nothing else calls it** — measured today as three
   lines in one file — then recommend deletion to Audrey and let her choose.
2. **Who sends the invite?** `invite-member` resolves the caller from **token
   claims plus a LIVE `workspace_members` row plus MFA step-up**. An operator
   creating a brand-new company **has no membership in it**, so that function
   cannot serve this as written. Either `operator-workspaces` gains an
   `invite_admin` action, or `create` mints the invite itself.
   🚨 **A new `platform_audit` action value means widening its CHECK, which is a
   MIGRATION** (the 0028 → 0031 → 0055 chain). If it comes to that, S43 has left
   design-polish territory — say so and re-scope rather than quietly writing SQL.
3. **What happens to `NewCompanyWizard`?** Its unique job was letting the
   *company* choose its own name, slug and admin credentials. Under the new flow
   the operator names the company and Supabase handles the credential, so most
   of the wizard has no work left. **Do not delete it reflexively and do not
   keep it reflexively** — establish what remains (workspace display name?
   branding? nothing?) and act on that.
4. ⚠️ **Check for a ROUTE, not just a button.** A self-serve path that is merely
   unlinked is not "invite only".

⚠️ **`NewCompanyWizard` is three of the four `AuthCursor` call sites (A6).** If
it survives in any form it still needs that treatment.

### ✅ SETTLED: platform operator ONLY, and not shipped to the app at all

Audrey, 2026-08-10, asked directly whether *"wilson overall admin"* meant the
platform operator console:

> *"correct this is for the platform operator only. this is not to be seen in
> the actual wilson app."*

**So the requirement is not "hide it from workspace admins". It is "the WILSON
app must not contain it".** Two different jobs, and the second is the one asked
for.

🚨 **THE BUILD ALREADY ENFORCES THIS, AND THAT IS THE MECHANISM TO USE.**
`vite.config.js` produces two surfaces selected by `--mode`:
`input: mode === 'admin' ? 'admin.html' : 'index.html'`, with
`__WILSON_SURFACE__` defined as `'admin'` or `'app'`. Company creation belongs
under **`src/admin/`**, reachable only from the operator entry point — so it is
**not bundled into the app at all**, rather than bundled and hidden.

**A permission check is the weaker answer here and should not be the only one.**
`perms.role === 'admin'` hides a control from the wrong person; it still ships
the code, the route and the endpoint call to every customer's browser. Audrey
asked for absence, not concealment.

**What this settles, concretely:**

- The **in-app Admin Terminal** (`src/components/AdminTerminal/`) gains **no**
  company-creation affordance. It is a *workspace*-admin surface — a workspace
  admin creating other companies would be a privilege escalation.
- `NewCompanyWizard.jsx` currently lives in `src/cloud/onboarding/`, which is app
  territory. Whatever survives of it (decision 3 above) **moves under
  `src/admin/` or goes**. It must not be left importable from the app entry.
- The one thing that legitimately stays on the app surface is the **invitee's**
  side: someone who receives the link is not an operator, and they land in the
  normal app to set their password. That is `recoveryLink.js` + the existing
  invite handling, and it is already there.
- ⚠️ **Verify by BUILD, not by reading.** After the move, `npm run build` and
  confirm the wizard's identifiers are absent from the app bundle. A grep over
  source proves nothing about what shipped — and "not to be seen in the actual
  wilson app" is a claim about the bundle.

## A6 — The blinking lines on onboarding

Audrey:

> *"this is where we had the lines blinking on each text line. it had the
> blinking lines to right of the text box and it made no sense. you were trying
> to show the place where the user could type but it didnt come out correctly."*

`AuthCursor` renders a blinking `_` and is placed **next to** inputs at
`NewCompanyWizard.jsx:389, 464, 480` and `NewUserWelcome.jsx:285`.

**The idea was right and the execution inverted it.** A terminal cursor belongs
*inside* the field at the insertion point, or nowhere. Beside a real input it
competes with the input's own caret, so the screen shows two cursors and neither
means anything.

**Do:** remove the decorative cursor from beside real inputs, and let the native
caret do the job. Keep the terminal feel with the **field treatment** — a
baseline rule, monospace value, the uppercase label — not with a second blinking
glyph.

✅ **THIS ALSO CLOSES AN OPEN `OUTSTANDING.md` ENTRY.** *"Welcome page has a
phantom cursor — REPORTED. A black cursor blinks permanently, unattached to any
input... Likely the shared `AuthCursor` from `AuthShell.jsx` — that is a guess,
confirm in the DOM first."* The guess is now well supported by the call-site
measurement, **but the entry's own instruction stands: confirm in the DOM before
claiming it fixed.**

## A7 — Login and onboarding must look like one system

> *"make sure for the login and the onboarding look alike. it needs to be the
> same visual language."*

**Law of Similarity, applied concretely:** the same label style, the same field
height, the same rule weight, the same button, the same error position, on
`LoginScreen`, `NewUserWelcome` and `NewCompanyWizard`. If a value is used
twice, it belongs in `AuthShell` beside `AUTH_TEXT_STYLE` — which is already the
established home for shared auth typography.

**Law of Proximity:** label sits tight to its field; field groups sit far apart.
The gap between a label and its input should be visibly smaller than the gap
between two fields. This is the cheapest fix on these screens and the one that
will do the most for "the layout looks wrong".

## A8 — The nav panel hover is dead, and the cause is measured

Audrey, 2026-08-10, with a screenshot of the hamburger nav open:

> *"the hover over animation of turning the text grayish when hovering over the
> options is not working. when i hover over home, dog, otter, rabbit, etc i
> should see the text gray out when i hover over them just like it works when i
> see the selections when resources is pressed and i see the options in the
> resources section. so it should work the same."*

🚨 **THIS IS NOT IN `Home.jsx`.** The screenshot is the **hamburger nav
overlay**, which lives in **`App.jsx`** — `getNavStripItems()` (`:1355`),
`getResourcesNavItems()` (`:1381`), rendered at **`:1621`** (resources
sub-column) and **`:1640`** (main strip). `Home.jsx`'s two-column menu is a
DIFFERENT surface with icons and a background pill. Confirm which one you are
editing before you touch anything — the two look nothing alike and only one of
them is the complaint.

**THE CAUSE, MEASURED.** Both columns carry the same Tailwind class
`transition-opacity hover:opacity-70`. The difference is one line:

| Column | Inline `style` | Hover works? |
|---|---|---|
| Resources sub-column (`:1625-1626`) | no `opacity` | ✅ yes |
| Main strip (`:1658-1665`) | `opacity: dimmed ? 0.35 : 1` | ❌ **no** |

**An inline style beats a class selector.** `hover:opacity-70` is a class, so on
the main strip it is overridden on every render and the element is pinned at
`opacity: 1`. The resources column has no inline opacity, so its hover survives.
That asymmetry is precisely what Audrey is describing, and it is not a missing
animation — it is a specificity collision.

**The fix must keep BOTH states**, because `dimmed` is doing real work: it fades
the main strip to `0.35` while the resources column is open (visible in the
screenshot — `RESOURCES` stays white, everything else recedes). So hover and
dimmed have to resolve in ONE place.

Track hover in state and compute a single opacity, rather than letting a class
and an inline style argue:

- dimmed → `0.35`
- hovered → `0.7` (matches the resources column exactly, per Audrey's "it should
  work the same")
- otherwise → `1`

...and drop `hover:opacity-70` from the main strip once the inline value owns
it, so there is no second source of truth. **Law of Similarity:** the two
columns are the same control and must respond identically.

⚠️ **Do not "fix" this by removing the inline opacity alone.** That restores
hover and silently kills the dimmed state, which is the thing that tells the
user which column is live.

⚠️ **`hover:` is mouse-only.** Add the matching `focus-visible` state in the
same change — this nav is keyboard-reachable and currently gives a keyboard user
nothing.

✅ **THE DIMMED/HOVER GREY HERE IS NOT THE BANNED GREY.** It is white at reduced
opacity on dark orange, as a deliberate interactive state on large bold type.
The colour rule at the top of this brief governs *content* text — labels,
captions, table cells — on orange surfaces. **Do not delete this nav's greys
while enforcing that rule.**

---

## 🚩 CHECKPOINT — deploy and stop

Audrey:

> *"AFTER YOU ARE DONE WITH THE LOGIN PAGES. set it up on the
> beta.petalstudios.co/wilson deploy so i can test it out. After i can confirm
> that these pages look good."*

**Commit Phase A, push to `feat/multi-user-v1`, confirm the Vercel deploy, and
tell her it is ready. Do not start Phase B until she has looked.**

**What she is checking:** the two-step login, the asterisks, the animation, the
onboarding screens matching it, the removed company button, and **A8's nav hover
— which is on every page, so it is the easiest of the lot to confirm.**

⚠️ **The beta is STAGING-backed and auto-deploys on push.** A broken login on
that branch locks her out of her own beta, so this is the one screen where
"green tests" is not enough — **click through it yourself in the preview**
before saying it is ready.

⚠️ **Two CI traps that S42 hit in consecutive pushes** (both in the traps
section below): the local npm writes lockfiles CI rejects, and anything reading
`import.meta.env.VITE_*` is empty on the runner.

---

# PHASE B — ADMIN TERMINAL, SYSTEM SETTINGS, RESOURCES

**Only after Audrey confirms Phase A.**

> *"i want to work in the admin terminal, the system settings, and the resources
> pages. right now i need all of these to have the same visual language as
> well."*

## Surfaces

| Surface | Files |
|---|---|
| Admin Terminal | `src/components/AdminTerminal/` — 13 files, `AdminTerminalPage.jsx` + 12 sections |
| System Settings | `src/components/SettingsPage.jsx` — five tabs |
| Resources | `src/components/Projects/`, `RateCard/`, `TeamMembers/` |

## B1 — The white box in Team Members

> *"in team members there is a white box and white header for the box that
> doesnt fit the visual language."*

**Law of Common Region, and the trap inside it.** A bounded area does read as a
group — but a white card on this palette is the laziest way to get one and the
only one that breaks the language. **Replace the card, keep the region:** a
hairline rule, a shared grid column, consistent gutters, or a small shift of the
existing surface colour all group just as well and cost no new ink.

The table itself is correct and must not change — columns, sort, inline edit,
the pronoun and employment-type controls all stay exactly as they are.

## B2 — The grey

Work the table at the top of this brief. **Per file, decide for each occurrence
whether it sits on orange or on dark stone**, and only change the first group.

**Von Restorff:** once everything is legible, the emphasis that used to come
from "darker grey vs lighter grey" is gone. Re-establish hierarchy with **weight
and size**, not with a third colour. If a fourth ink is being reached for, the
hierarchy is broken somewhere else.

## B3 — One system across three surfaces

**Miller's Law** on the Admin Terminal: it has twelve sections. Nobody holds
twelve. Group them — and if that argues for changing the *navigation*, propose
it to Audrey rather than doing it, because navigation is behaviour.

**Law of Similarity across surfaces:** a table in Team Members, a table in
Users, and a table in Logs should be the same table. Same header treatment, same
row height, same zebra (or no zebra), same empty state. Today they are three
tables that happen to be near each other.

---

## Design direction

**Inks: 3** (`#ea580c` dark orange, `#f4a261` light orange, `#1c1917` stone) plus
white and black as text. **Families: 1** system sans, with a mono reserved for
values that benefit from it (IDs, byte counts, keys) — which the terminal
aesthetic already implies and which `AUTH_TEXT_STYLE` half-establishes.

**Density is correct.** These are working screens for an operator. Do not pad
them into a marketing page; tighten the gutters, set the type well, and let the
tables be dense. Whitespace here is structural, not decorative.

**Banned, unless Audrey asks:** gradients, drop shadows, blur panels, rounded
"friendly" corners as a mood, decorative icons, a fourth ink.

**Motion:** 100–160ms for state changes, 160–240ms for interactive response,
and the existing `App.jsx` curve for anything page-level. Nothing new invented.

---

## 🚨 What must NOT change

Stated once, and it governs every line above:

- **No migration. No schema change. No new pgTAP suite** — **except A5**, whose
  scope is stated in its own section and whose SQL, if any, is confined to
  widening the `platform_audit` action CHECK. Nothing else in this session has
  any business touching the database.
- **No table columns added, removed or renamed.** No sort order, no filter
  semantics, no pagination behaviour.
- **No input field added or removed** — except the A1 split, which reorders
  existing fields across two steps, and the A5 removal Audrey asked for.
- **No permission gate touched.** `canWrite*`, `canSeeProjectMoney`,
  `is_platform_operator` and every `ready` check stay exactly as they are.
  🚨 A greyed control that becomes legible must not become *enabled*.
- **No copy rewritten** beyond what a layout change forces. The over-quota
  messages in particular are load-bearing — S41 and S42 both fixed sentences
  that offered remedies which could not work. Do not "tidy" them.

---

## Verification

1. **`npm test`** — 58 files / 1409 tests, and **run it with
   `.env.development`, `.env.local` and `.env.staging` hidden**, which is what
   CI does.
2. **`node scripts/tap-all.mjs`** — 66 suites / 1180. Should be untouched; if a
   pgTAP assertion moves, you have changed behaviour.
   ⚠️ Suite 35 fails against staging for pre-existing reasons — see
   `OUTSTANDING.md`. It is not yours unless you choose to fix it.
3. **Look at every screen you touched, in the running app**, at 1400×900 and at
   the 1024×700 minimum. vitest mounts no React and Playwright only covers auth,
   so **your eyes are the instrument** — and reset the viewport afterwards.
4. **Contrast-check every text colour you changed** against the surface it
   actually sits on, not the one you assumed.

---

## Standing traps

🚨 **TWO WAYS CI FAILS WHILE EVERY LOCAL CHECK IS GREEN. S42 hit both.**
- The local npm (11/Node 24) is a major version ahead of CI's (10/Node 20) and
  omits an optional transitive dependency CI requires. After any dependency
  change: **`npx --yes npm@10 ci`**.
- Vitest runs in mode `test`; this repo has no `.env`, `.env.test` or
  `.env.test.local`, so `import.meta.env.VITE_*` is a developer's gitignored
  `.env.local` and is **empty on the runner**. Never read env into a
  module-level `const` — it cannot be stubbed after import.

⚠️ **`preview_pane_hygiene`**: reset the viewport after `resize_window`, and
never let scaffolding impersonate the design. Audrey reads pane artefacts as
broken code.

Never `supabase config push`. `git add -A` sweeps untracked files into a PUBLIC
repo. Never interpolate content into a shell command. Count `<!--` / `-->` after
editing long markdown.

---

## Close-out ritual

1. `docs/OUTSTANDING.md` — the phantom-cursor entry should close (A6). Add
   nothing that is merely cosmetic-and-unfinished; that belongs in the master
   plan.
2. Sequence table in `MASTER_PLAN_S19_ONWARD.md` — S43 done, **S38 next and
   last**.
3. `docs/SYSTEMS_HANDBOOK.md` — if any shared token or component is introduced,
   it belongs in the visual-language section, not only in the component.
4. **Refresh the STATE block of `SESSION_38_prompt.md`** with the numbers you
   leave behind, and update the Claude auto-memory in the same pass.
5. **Close out in the chat** with the remaining-session list and a plain-English
   breakdown. Never let a diagnosis read as a fix.
