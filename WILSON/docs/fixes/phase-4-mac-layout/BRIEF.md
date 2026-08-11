# PHASE 4 — MAC VIEWPORT: CONTENT HIDDEN, AND WHITE PAST THE BARS

> **Audrey, 2026-08-10, verbatim:**
> *"when i log in to the app on a macbook (this is a 14 in macbook air) i am
> having an issue where the light orange panel with the content is being hidden
> behind the orange header and footer. i should be able to see all the page
> selections and not need to scroll. please make sure the content is full
> viewable and make sure to instead make the footer and header bars shorter."*
>
> *"small thing, in macbooks, i am able to scroll beyond the pages sometimes. i
> am seeing after the bars that its white. lets make sure the orange header and
> footer bars extend so the user never sees white in the background"*
>
> ✅ **No open questions. No migration. Pure layout and CSS.**
> ⚠️ **Two separate bugs that happen to share a test surface.** Fix both, but
> understand they have nothing to do with each other.

---

## Bug A — the bars are fixed pixels and eat the viewport

### Root cause, confirmed

`PAGE_BARS` in `src/App.jsx` is a hard-coded pixel table with no viewport
awareness whatsoever:

| Page | Top | Bottom | Total chrome |
|---|---|---|---|
| `home` | 268px | 268px | **536px** |
| `settings`, `project-manager`, `rate-card`, `team-members`, `dashboard`, `admin-terminal` | 200px | 150px | **350px** |
| `help` | 140px | 100px | 240px |
| `dog`, `otter`, `rabbit` | 95px | 8px | 103px |

A 14-inch-class Mac laptop is roughly **1470×956** to **1512×982** logical
points. In a browser, chrome (menu bar, tab strip, URL bar) costs another
~90–130px, leaving roughly **830–870px** of viewport.

On Home that leaves about **300px** of content. On the Settings family, about
**500px**. Audrey's Windows display is taller, which is why this only bites on
the Mac — the numbers were chosen on a large screen and never re-checked on a
small one.

**This is why the page selections are unreachable without scrolling, and why the
light orange content panel disappears behind the chrome.**

### The coupling you must not break

🚨 `268px` is not only a layout number. `AuthShell`'s sign-in reveal settles the
bars at **`PAGE_BARS.home`**, and Session 43's `playWelcome` in `App.jsx` picks
them up from exactly there so the two animations read as one continuous
movement. Its comment says so explicitly.

**If you change Home's bar height, `AuthShell` must resolve to the same value.**
Two copies of that number is how "it works like the app" quietly stops being
true — which is the reason S43 introduced the shared `TRANSITION` constant in
the first place. Follow that precedent: **one definition, both consumers.**

⚠️ `COMPRESSED = { top: 'calc(50vh - 20px)', bottom: 'calc(50vh - 20px)' }`
is already viewport-relative. The resting state is the outlier, not the
transition.

---

## Bug B — white behind the page on overscroll

### Root cause, confirmed

`src/index.css` sets **no `background-color` on `html` or `body`**, and **no
`overscroll-behavior`** anywhere.

macOS rubber-band scrolling lets the user drag the document past its bounds, and
what shows through is the default white page canvas. Windows does not
rubber-band, which is why Audrey has only ever seen this on the MacBook.

Her framing — *"make the orange header and footer bars extend"* — describes the
outcome she wants. The mechanism is the page background, not the bars: stretching
the bars would move the problem rather than remove it, because the overscroll
region is outside the app's layout entirely.

---

## What to change

### 1. Make the bars responsive, with a cap

Convert `PAGE_BARS` from fixed pixels to a viewport-relative value bounded by the
current pixel value, so tall screens are unchanged and short screens shrink the
chrome instead of the content. A `min(268px, 22vh)` shape does this.

Requirements:

- **Short screens must shrink the bars, not the content.** That is the explicit
  ask: *"instead make the footer and header bars shorter."*
- **Nothing regresses on a large display.** On Audrey's Windows machine the
  numbers should resolve to what they are today.
- **The content region between the bars gets a sensible minimum** and scrolls
  internally if it genuinely cannot fit, rather than sliding under the chrome.
- 🚨 **Keep one definition of Home's bar height**, shared with `AuthShell`.

⚠️ Watch the `dog` / `otter` / `rabbit` rows: their bottom bar is already 8px.
A `vh` floor must not make those *taller* than they are now.

### 2. Paint the page background and stop the bounce

In `src/index.css`, set the background on `html, body` to the bar colour, and add
`overscroll-behavior: none`.

🚨 **Source the colour from whatever the bars already use — do not eyeball a new
orange.** Read the bar's own background value in `App.jsx` and reuse it. A second
near-miss orange is worse than the white, because it reads as a rendering fault
rather than an empty region.

⚠️ Note `#f4a261` is the *page-transition overlay* background, not necessarily
the bar colour. Check before reusing it.

### 3. Verify at the real size

🚨 **Reset the viewport after resizing.** Audrey reads leftover preview-pane
artefacts as broken code. Do not leave the pane at a phone width.

Check at minimum:

- **1470×956** and **1512×982** — the 14-inch Mac class, desktop app
- The same, minus ~110px — the same machines in a browser
- Audrey's Windows resolution — the regression check
- Every page in the `PAGE_BARS` table, not just Home

---

## What NOT to change

- ❌ Do not change the transition choreography. `TRANSITION` and the
  fade/compress/hold/expand chain are S43's and are correct.
- ❌ Do not change the `COMPRESSED` value.
- ❌ Do not restyle the bars, the nav strip, or the content panel. Session 43
  was the design pass and it is signed off. **This is a sizing fix only.**
- ❌ Do not fix the overscroll white by stretching the bars.
- ❌ Do not add a scrollbar to `body` to "solve" the content overflow. Audrey:
  *"i should be able to see all the page selections and not need to scroll."*

---

## Risks — what this could break

- 🚨 **The sign-in → welcome animation.** This is the highest-risk item in the
  phase. `AuthShell`'s reveal and `playWelcome` both depend on Home's resting bar
  height. If they disagree by even a few pixels, the bars will visibly jump at
  the moment the user arrives — the first thing anyone sees after signing in.
  **Test the full sign-in flow, not just the page.**
- **Page transitions at small heights.** `COMPRESSED` is `calc(50vh - 20px)`.
  On a short viewport, check the compressed state still fully covers the content
  and the title stays legible.
- **The pet sprite and companion panel** are positioned relative to the bars.
  Confirm the pet is not clipped or floating at the new heights.
- **`overscroll-behavior: none` also disables pull-to-refresh** on touch devices
  and can affect nested scroll chaining. Verify scrollable regions inside
  R.A.B.B.I.T.'s timeline and O.T.T.E.R.'s lesson pane still scroll normally.
- ⚠️ The Settings family shares one row set. Changing it changes six pages at
  once — check all six, not just System Settings.

---

## Definition of done

- [ ] On a 14-inch Mac, every page selection on Home is visible without scrolling
- [ ] The light orange content panel is never behind the header or footer
- [ ] Bars are shorter on short screens and unchanged on Audrey's Windows display
- [ ] No white is reachable by overscrolling, top or bottom
- [ ] Sign-in → welcome animation is continuous, with no jump in bar height
- [ ] All six Settings-family pages checked, plus Home, Help, D.O.G., O.T.T.E.R.,
      R.A.B.B.I.T.
- [ ] Home's bar height has exactly one definition in the codebase
- [ ] Preview pane returned to a normal desktop viewport

---

## Test plan (Audrey)

**This one is best tested on the MacBook** — it is the machine that shows both
bugs. Please check the desktop app and the beta.

1. **Sign in and watch the animation.** The bars should close, say WELCOME, and
   open onto Home as one smooth movement. Tell me if anything jumps or snaps.
2. **On Home, look at the page selections.** All of them should be visible
   without scrolling.
3. **Check the content panel** on Home, System Settings, Projects, Rate Card,
   Team Members, Dashboard and Help. The light orange panel should never be
   tucked behind the orange bars.
4. **Try to scroll past the top and bottom of each page.** You should never see
   white — the background should stay orange all the way.
5. **Open D.O.G., O.T.T.E.R. and R.A.B.B.I.T.** and confirm nothing there got
   shorter or taller that should not have.
6. **Then check your Windows machine** — it should look exactly as it does now.
   If anything moved there, that is a regression and I want to know.

If the bars end up too short for your taste, that is a number I can tune — tell
me which page and whether you want more or less.
