# 23 — UI overhaul, D2: the sign-in family, onboarding, Help, and Home's type

**What this is.** Wave 2's second bundle (`docs/design/UI_OVERHAUL_PLAN.md` §5,
bundle D2). Eleven surfaces that had drifted apart now run on the tokens and
the kit Foundation built: the four sign-in screens, the onboarding wizard, the
MFA panels, the invite dialog, the workspace switcher, Help, the update prompt
and the degraded-model banner. Home's type moves with them; nothing else on
Home moves.

Your words, 2026-08-10, in capitals: *"DO NOT USE GRAY TEXT AGAINST ORANGE AS
IT IS HARD TO SEE ONLY WHITE OR BLACK."* The auth screens already obeyed that.
Help did not — three of its inks were greys on orange and two of them failed —
and the one notice built to be impossible to miss, the degraded-model warning,
measured **1.34:1**. Those are the two real defects in this bundle. Everything
else is the same screens, in one voice.

Written 2026-09-11 against `feat/ui-overhaul`, session branch
`ui/d2-auth-help-home`. Nothing here touches data, a query or a migration.

**Before you start.** `git checkout feat/ui-overhaul && git pull --ff-only &&
npm install && npm run dev`. Leave `VITE_DEV_AUTOLOGIN` **unset** for steps 1
to 4 so the sign-in screen actually shows; set `VITE_DEV_AUTOLOGIN=tester` for
steps 5 onward. Screenshots of everything below are in
`docs/sessions/handoffs/img/` at both 1440x900 and 1280x700.

---

| # | Do | You should see |
|---|----|----------------|
| 1 | Open the app with no autologin and let the intro finish. | **Login**, in sentence case, at 20px Geist. It was `LOGIN` at 24px with heavy letter-spacing — the transition title's voice used for a page heading. **COMPANY** stays upper: a field label is the one small role that keeps capitals, and it is now 11px/600 with lighter tracking instead of 11px/700 with twice as much. The **Continue** button is the app's filled primary — the darker orange with white, 36px tall, 3px corners — instead of a 12px uppercase 6px-cornered one. `d2-signin-step1-*.png`. |
| 2 | Type a company and continue. Then press **Tab** into the fields. | Both fields are **240px wide and the two rules line up**. They did not before: the password field was 4px longer than the username field, because both were sized in `ch` and `ch` means a different thing in a monospace face. A black focus ring appears around the focused field — the auth screens had **no focus indicator at all**, because each input set `outline: none` inline and an inline outline beats every stylesheet. `d2-signin-step2-*.png`. |
| 3 | Type a password and watch the asterisks. | Same as before, which is the point. The asterisks are a monospace overlay drawn over a real password field so your password manager still works, and the caret has to land exactly at the end of them. That alignment depends on the face and the size, and this session changed both. It is re-measured at **0.00px** on every axis, at both window sizes. |
| 4 | Click **Forgot password?**, then **Change company**. | One voice. The two wizards shouted their errors in bold uppercase where the other two spoke them; every message on all four screens is now a sentence. The links under the button are 12px sentence case instead of 10px uppercase — 10px was below the floor the type system sets. |
| 5 | Set `VITE_DEV_AUTOLOGIN=tester`, restart, and look at **Home**. | The six labels are **16px, weight 600, sentence case**, in the same black, in Geist — they were 14px bold uppercase with wide tracking, which is the same typographic object as every table header in the app. Layout, icons, spacing, the six buttons and the Resources column are untouched. `d2-home-*.png`. **See decision 1 below.** |
| 6 | Menu → **RESOURCES** → **HELP**. Click **Wilson**, then **About Wilson**. | The sidebar's brown panel is gone: items are black on the page's own orange with one hairline down its right edge, and each tool shows the subtitle it has always defined and never rendered. Body copy is 14px and **stops at 72 characters** — it ran to about 190. The cards are the warm well instead of the white cards you have twice asked us to stop using. Bullets are real list markers, so a wrapped line starts under the text instead of under the bullet. `d2-help-wilson-*.png`. |
| 7 | Still in Help, click **D.O.G.** | **This section still looks like the old one**, and that is expected: D.O.G.'s and O.T.T.E.R.'s help content lives in their own files and belongs to their lane, not this one. Help's own chrome, the Project Manager section and the Wilson section are what this bundle restyled. `d2-help-1440x900.png` shows the seam. |
| 8 | **System Settings → Profile**, and look at the two-factor panel. | Its section heading and the workspace switcher's above it are now the same object — they were two copies of one hand-typed string, and there are 43 of those in the app. The explanatory paragraph is 14px sentence case; it was **10px uppercase**, which the review called the least readable block of text in the application. The QR code keeps its white border on purpose — every other white surface in the app is gone, but a scannable code is not a UI surface. |
| 9 | If you can reach it: **Team Members → Invite User**. | The invite card is the shared dialog now, so it matches every other dialog in the app rather than being a pale card of its own. Escape closes it, a click outside closes it, and it locks while it is sending — all three are what it did before or what you ruled in. **One difference:** with the cursor in a field, the first Escape clears that field and the second closes the dialog. That is the kit's rule (Escape in a field means "undo this edit"), and it is deliberate. |
| 10 | Optional: `npx vitest run`. | **112 files, 2,2xx tests, green.** `authContrast.test.js` went from 10 cases to 50 — every new ink measured on the surface it actually sits on, each with a control that proves the threshold means something. A new `authSelectors.test.js` checks that every text and label the Playwright suite selects on still exists, because Playwright itself cannot run without a live server and a test account. |

---

## Decisions this bundle needs from you

**1. Home's labels (step 5) — the one judgement call.** Your brief says Home
is fonts only. The plan's critic ruled the fonts-only version of Home's finding
is *"16px, weight 600, sentence case, zero tracking, `LIGHT_INK` … that is the
whole type change"*, and that is what shipped. The narrow reading of "fonts"
is family, size and weight — which would keep the labels UPPERCASE while every
button, tab and title in the rest of the app goes sentence case. I took the
critic's reading because Home would otherwise be the only screen still
shouting. **If you want the capitals back it is one class string in
`Home.jsx`, twice.** Say the word.

**2. Home's hover colour (Q19).** Untouched, as your default says. The
measurement, so the decision is one line and not another session: the hover
fill composites to `#ba7a46`; **white on it is 3.52:1** and fails, while the
resting state is black at 8.48:1 — so the state you are actually reading is
the less legible one. Two ways out: the hover label goes black (**4.96:1**,
and the page keeps one ink), or the fill darkens to `rgba(120,70,30,0.8)`.
Both are one token. Both numbers are in the test already.

**3. The icon-to-label ratio on Home.** At 16px sentence case the 32px icons
now dominate; 24px would restore the proportion. Icon size is not type, so it
was not touched. Yours if you want it.

**4. The degraded-model banner's new home.** It is a dark strip now, above the
orange bar, because on the orange it measured 1.34:1 and there is no readable
amber on orange. It is the first thing in the app to use the shared Banner. If
a dark strip above the orange frame reads wrong to you, say so — the
alternative is black text on a plain orange strip, which is legible but looks
like part of the chrome rather than a warning.

---

## What this bundle deliberately did not do

- **Help's bar heights.** Help sits at 140/100 where every other resource page
  sits at 200/150 — an outlier nobody had noticed. Changing it means changing
  seven light pages at once, which changes the card-on-a-desk proportion you
  chose, so it belongs to one decision with a before/after, not to this bundle.
- **The D.O.G. and O.T.T.E.R. help content** (step 7), and the operator
  console's sign-in screen, which is a fifth auth surface sharing nothing with
  the other four and is out of scope by your Q14 ruling.
- **The page transition**, untouched per Q18, including the title's size and
  tracking.
