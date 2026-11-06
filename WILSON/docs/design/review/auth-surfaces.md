# Review — Auth surfaces (AuthShell + LoginScreen + ForgotPasswordWizard + ResetPasswordWizard + MfaSection), onboarding (NewUserWelcome), the two session-level overlays (UpdatePrompt, InviteMemberDialog), the two chrome-level notices (ModelWarningBanner, WorkspaceSwitcher), the Help page, and Home's typography only


Part 2 of `../UI_OVERHAUL_REVIEW_2026-09-11.md`. Numbers and colour values here are the reviewer's; where the critic (Part 3) or `../UI_OVERHAUL_PLAN.md` corrects one, the plan wins. Constraint-flagged findings are decisions for Audrey (plan §2), not work.

Files reviewed: `src/cloud/auth/AuthShell.jsx`, `src/cloud/auth/LoginScreen.jsx`, `src/cloud/auth/ForgotPasswordWizard.jsx`, `src/cloud/auth/ResetPasswordWizard.jsx`, `src/cloud/auth/MfaSection.jsx`, `src/cloud/auth/InviteMemberDialog.jsx`, `src/cloud/auth/WorkspaceSwitcher.jsx`, `src/cloud/auth/authContrast.test.js`, `src/cloud/onboarding/NewUserWelcome.jsx`, `src/components/HelpPage.jsx`, `src/components/UpdatePrompt.jsx`, `src/components/ModelWarningBanner.jsx`, `src/components/Home.jsx`, `src/components/lightSurface.js`, `src/data/dogHelpContent.jsx (token block + light-theme override sheet)`, `src/data/otterHelpContent.jsx (token block)`, `src/admin/OperatorLogin.jsx (fifth auth surface, read for uniformity)`, `src/layout/pageBars.js`, `src/index.css (auth-step, scrollbars, no font, no focus)`, `src/App.jsx (banner mount, transition title, content padding, gate mounting)`, `src/tools/rabbit_v0.1.0/views/bins/binUi.jsx (Kbd, for the shortcut-bar comparison)`


## Job

This is not one surface, it is five jobs wearing one costume, and the costume is the problem. (1) AuthShell + LoginScreen: get a known person into their workspace, one decision per step, primary action Sign in. (2) ForgotPassword / ResetPassword: get a locked-out person a working password, primary action Send reset link / Set password. (3) NewUserWelcome: capture a display name, primary action Get started, and the other four controls are optional decoration around one required field. (4) MfaEnrollGate: get an admin enrolled, primary action Activate MFA. (5) HelpPage: let someone find one answer about one tool, primary action is not a button at all, it is landing on the right page in the left column, which means the sidebar IS the primary element and it is currently the least legible thing on the screen. Home's job is settled and out of scope except its type. UpdatePrompt, InviteMemberDialog, ModelWarningBanner and WorkspaceSwitcher each have exactly one clear action and each invents its own chrome to express it. Every one of these jobs is answerable, so no pass stops here, but note the one that is genuinely unclear: MfaEnrollGate presents Activate MFA, Set up later and Sign out instead as three peers, so that screen currently has no single action.


## What works

- The AUTH_* kit is the best-argued piece of design in the repo and its STRUCTURE should be promoted app-wide almost verbatim: one ink with hierarchy from size and weight (AuthShell.jsx:355), an error ink derived from an existing danger value rather than a fourth colour (AuthShell.jsx:360), a named label-to-field gap ratio of 5px to 18px (AuthShell.jsx:388-389), and an AuthField component so the pairing cannot drift (AuthShell.jsx:555). That is exactly the component-layer argument the system review makes, already built, already shipped, already tested.

- authContrast.test.js turns a taste rule into a failing test with a white control. This is the pattern the whole overhaul should copy: a rule that is only written down gets broken, a rule that fails a test does not. The control assertion (white measures under 3:1 on the well) is what makes the passing assertion mean anything.

- AuthPasswordInput solves a real problem correctly and at measured precision: a real type=password input so password managers still work, transparent text so the browser still lays out and measures the bullets, and a monospace overlay so the caret cannot drift (AuthShell.jsx:595-686). Nothing in the overhaul should touch its mechanism, only its size step, and then only with a re-measurement.

- The step animation is right and for the right reason: a keyed element with a CSS entrance at 200ms in the interactive band, with the reduced-motion fallback as a media query rather than a branch (index.css:53-58). It also correctly refuses to animate the bars against the content.

- LoginScreen's two-link row with a middle dot (LoginScreen.jsx:594-616) is the correct treatment for two peer tertiary actions, and it is the pattern MfaEnrollGate should have used and did not.

- OtterHelpContent carries a proper light/dark token pair chosen by prop (otterHelpContent.jsx:15-37). It is the template DogHelpContent should follow and does not.


## Findings (38)

**AUTH-01 · HIGH · Colour** — The degraded-model warning renders at about 1.3:1 on the orange root, so the one notice built to be impossible to miss is invisible  
**constraint: palette-decision** · law: Selective Attention

- Problem: ModelWarningBanner paints amber text #b45309 on a 14 percent amber tint, and it mounts as the first child of the authenticated column whose parent background is #ea580c (App.jsx:1913, App.jsx:1921). The tint composites to roughly #e2570c, so the text measures about 1.34:1 and the 35 percent border about 1.2:1. The component header says it exists because a model died and the failure reached users as a generic try again with nowhere to look. It is now a second place with nothing to look at, and it breaks Audrey's rule twice over: an amber grey on an orange surface.

- Why it matters: This is the cheapest high-severity fix on the surface, one token, and it is a correctness defect rather than a taste one. Selective Attention: a notice the eye cannot resolve is not a notice.

- Change: Give the banner the raised dark surface it needs to exist on, not a tint of the ground it sits on. Paint the strip paper-raised #232020 full-bleed at 44px with a 1px signal-tinted bottom rule, set the icon and text to the dark warning token #f59e0b, body at the 13px Dense step sentence case, and keep the 16px AlertTriangle. Assert the ratio in authContrast.test.js the same way the auth inks are asserted.

- Evidence: `src/components/ModelWarningBanner.jsx:40` — `backgroundColor: 'rgba(180, 83, 9, 0.14)', borderBottom: '1px solid rgba(180, 83, 9, 0.35)', color: '#b45309',`<br>`src/App.jsx:1913` — `<div style={{ height: '100vh', backgroundColor: '#ea580c', overflow: 'hidden' }}>`




**AUTH-02 · HIGH · System** — AuthShell carries the only sans-serif family declaration in the app, and it is Apple-first on a Windows product

- Problem: There are 69 fontFamily declarations in src and 68 of them are monospace. The single sans declaration is AUTH_TEXT_STYLE.fontFamily at AuthShell.jsx:371, an -apple-system / BlinkMacSystemFont stack that resolves to Segoe UI on Audrey's machines by accident of fallback order. Every other surface inherits Tailwind's preflight default. The login screen is therefore the one surface in WILSON that opts out of whatever face the app loads, and it is the first screen every user sees.

- Why it matters: When Geist or Inter lands, updating this line instead of deleting it leaves auth on a private stack forever, and nobody will notice because the fallback still renders something reasonable. That is exactly how eighteen sessions shipped white-on-light-orange.

- Change: Delete the fontFamily key from AUTH_TEXT_STYLE entirely so the auth family inherits the app face. Keep the explicit mono stack inside AuthPasswordInput's metrics object (AuthShell.jsx:611), because that one is load-bearing for caret alignment, and pin it to the chosen Geist Mono / JetBrains Mono stack in the same edit. Add a test that AUTH_TEXT_STYLE has no fontFamily key.

- Evidence: `src/cloud/auth/AuthShell.jsx:371` — `fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',`<br>`src/cloud/auth/AuthShell.jsx:638` — `fontFamily: AUTH_TEXT_STYLE.fontFamily,`




**AUTH-03 · HIGH · System** — There is no focus indicator anywhere on any auth surface, and the auth inputs explicitly delete the browser's  
law: Jakob's Law

- Problem: index.css contains zero :focus or :focus-visible rules. AUTH_INPUT_STYLE sets outline: none (AuthShell.jsx:434) and AuthPasswordInput repeats it (AuthShell.jsx:662). MfaSection's code field adds focus:outline-none with no replacement (MfaSection.jsx:208). Because the kit is inline styles, a :focus state cannot be expressed there at all, so this is structural rather than an oversight. A keyboard user tabbing the login screen sees nothing move.

- Why it matters: Accessibility is specified with the component, not audited afterwards. It also hurts sighted mouse users: the company step auto-focuses its field and there is no visible proof of it, which is the one thing that would tell a user they can just start typing.

- Change: Add one global rule to index.css: :focus-visible { outline: 2px solid var(--signal); outline-offset: 2px; border-radius: inherit; } and delete every outline: none and focus:outline-none on this surface. On the auth well the signal ring reads against #f4a261 at an acceptable edge contrast; if it does not satisfy Audrey, use a 2px AUTH_INK ring on light and a 2px signal ring on dark, chosen by the same surface class the rest of the system uses.

- Evidence: `src/cloud/auth/AuthShell.jsx:434` — `borderBottom: '1px solid ${AUTH_INK}', outline: 'none', caretColor: AUTH_INK,`<br>`src/cloud/auth/MfaSection.jsx:208` — `className="px-3 py-2 text-sm font-mono rounded-sm focus:outline-none text-center"`




**AUTH-04 · HIGH · Typography** — The AUTH_* kit's structure should become the app-wide tokens; its CASE and TRACKING should not, because six of its eight exports are uppercase and letterspaced  
law: Von Restorff Effect

- Problem: Every text role the auth family owns inherits textTransform uppercase and a tracking value from AUTH_TEXT_STYLE (AuthShell.jsx:365-372): title 24px/0.18em, label 11px/0.22em, button 12px/0.18em, quiet button 10px/0.18em, link 10px/0.16em, hint 10px/0.16em. Only the input value and the error opt out. So on the login screen a page title, a field label, a button, a hint and a link are the same typographic object at five sizes. That is the flat field of small caps the system review names, in its purest form, on the first screen of the product.

- Why it matters: This answers the question the brief asks directly. The kit's ARCHITECTURE is right and should be promoted: one ink, one gap ratio, AuthField, a shared field kit, a contrast test. Its TYPOGRAPHY is the defect the overhaul exists to remove, and promoting it unchanged would export the 2003 control-panel look to every other surface rather than fixing it here.

- Change: Rewrite AUTH_TEXT_STYLE to carry colour and weight only, no textTransform and no letterSpacing, then re-derive each role on the shared scale: AUTH_TITLE_STYLE becomes 20/600/sentence/+0.01em, AUTH_LABEL_STYLE becomes 11/600/UPPER/+0.06em (the Label role keeps its case, it is one of the two that earn it), AUTH_INPUT_STYLE becomes 14/400/sentence/0, AUTH_BUTTON_STYLE becomes 14/600/sentence/0 at 36px tall, AUTH_BUTTON_QUIET_STYLE the same at 28px, AUTH_LINK_STYLE 13/400/sentence with the underline kept, AUTH_HINT_STYLE 12/400/sentence, AUTH_ERROR_STYLE 13/400/sentence in AUTH_ERROR_INK. Uppercase survives in exactly one place on this surface, the field label.

- Evidence: `src/cloud/auth/AuthShell.jsx:365` — `export const AUTH_TEXT_STYLE = {   color: AUTH_INK, fontWeight: 600,   textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: '20.5px',`<br>`src/cloud/auth/AuthShell.jsx:418` — `export const AUTH_LABEL_STYLE = {   ...AUTH_TEXT_STYLE, fontSize: '11px', fontWeight: 700, letterSpacing: '0.22em', }`<br>`src/cloud/auth/AuthShell.jsx:539` — `export const AUTH_HINT_STYLE = {   ...AUTH_TEXT_STYLE, fontSize: '10px', fontWeight: 600, letterSpacing: '0.16em', }`




**AUTH-05 · HIGH · Typography** — The MFA gate sets an entire explanatory paragraph in 10px uppercase, which is the least readable block of text in the application  
law: Cognitive Load

- Problem: MfaEnrollGate renders two lines of instruction at fontSize 10px, weight 400, uppercase, tracking 0.06em, line-height 1.6, capped at 320px (MfaSection.jsx:292-295). Uppercase destroys word-shape recognition, which is the mechanism fluent reading depends on, and 10px is below the review's declared 11px floor. The same file's own comment explains that opacity 0.75 was removed because an alpha on the ink is a grey by another name, and then solves the de-emphasis by shrinking to 10px instead, which trades a contrast failure for a legibility one.

- Why it matters: This screen appears at every sign-in for every admin until they enrol. It is the single densest concentration of the surface's typographic problem and the fix is three property changes.

- Change: Set the paragraph at the Body step, 14/400/sentence case/0 tracking, leading 1.5, measure capped at 60ch rather than 320px. De-emphasis comes from it sitting below a 16px sentence-case heading, not from shrinking it. Apply the same rule to every AUTH_HINT_STYLE consumer that is a sentence rather than a label: LoginScreen.jsx:637, ForgotPasswordWizard.jsx:141-143, ResetPasswordWizard.jsx:221.

- Evidence: `src/cloud/auth/MfaSection.jsx:292` — `<div style={{ ...AUTH_TEXT_STYLE, fontSize: '10px', fontWeight: 400, maxWidth: 320, textAlign: 'center', letterSpacing: '0.06em', lineHeight: 1.6 }}>   WORKSPAC`<br>`src/cloud/auth/ForgotPasswordWizard.jsx:141` — `<div style={{ ...AUTH_HINT_STYLE, maxWidth: '32ch', textAlign: 'center' }}>   ENTER YOUR USERNAME. WE'LL EMAIL A RESET LINK. </div>`




**HELP-01 · HIGH · Typography** — Help body copy runs to roughly 190 characters per line because the content column has no measure cap  
law: Cognitive Load

- Problem: The Help content area is flex-1 with p-6 and no max-width (HelpPage.jsx:142-149). On a 1440px window that is about 1150px of text column, and the body token is text-xs, 12px (HelpPage.jsx:29). At roughly 6px per character that is about 190 characters per line against a 60 to 66 target. Every paragraph, every list item and every card in both help content modules inherits it.

- Why it matters: Audrey said make things easier to read and called the light pages atrocious. This is the most measurable readability defect on the largest body of prose in the app, and it is one CSS property. Long measure defeats the return sweep: the eye loses its line, which readers experience as the page being tiring rather than as the line being long.

- Change: Cap the Help prose column at 72ch (the review's reading-page cap) inside the p-6 padding, left aligned, and raise the body token from 12px to the 14px Body step with leading 1.5. List items go to the 13px Dense step. The card wrappers inherit the cap rather than setting their own.

- Evidence: `src/components/HelpPage.jsx:142` — `<div   className="flex-1 overflow-y-auto p-6"   style={{ backgroundColor: '#f4a261', ... }}`<br>`src/components/HelpPage.jsx:29` — `bodyText: 'text-xs text-stone-800 leading-relaxed',`




**HELP-02 · HIGH · Colour** — D.O.G.'s help is authored dark-first and repainted for the light page by an injected !important stylesheet, which lands grey-on-orange and a dark box in the middle of the page  
law: Law of Similarity

- Problem: DogHelpContent injects a 23-rule <style> block with !important on every rule when theme is light (dogHelpContent.jsx:22-44). Three of those rules are defects rather than translations: .text-stone-500 becomes #57534e, which lightSurface.js measures at 3.70:1 on #f4a261 and fails; the note callout .bg-orange-500/10 becomes a solid #57534e box, a dark grey block dropped onto the orange page; and the text inside that box becomes #fb923c at 3.37:1 and #fdba74 at 4.52:1. Meanwhile OtterHelpContent does the same job correctly with an L/D token pair chosen by prop (otterHelpContent.jsx:15-37), and HelpPage carries a third near-copy of the same L object. Three implementations of one help style, in one page.

- Why it matters: This is the system defect the review names, visible in a single file: local tokens produced a third copy, and the third copy chose a mechanism (a global !important sheet) that cannot be audited or tested. It also puts grey on orange, which is the one rule with no exceptions.

- Change: Delete LIGHT_THEME_STYLES entirely and give DogHelpContent the same L/D token-pair shape otterHelpContent already uses, then hoist the single pair into one module both help files and HelpPage import, so there is one help token object rather than three. The note callout becomes the light warning treatment: LIGHT_WELL ground, 1px LIGHT_RULE, LIGHT_INK text, no dark box. Keep the dark modal path working, it is the other consumer of the same component.

- Evidence: `src/data/dogHelpContent.jsx:35` — `.help-light .bg-orange-500\\/10 { background-color: #57534e !important; } .help-light .bg-orange-500\\/10 h3 { color: #fb923c !important; } .help-light .bg-oran`<br>`src/data/dogHelpContent.jsx:29` — `.help-light .text-stone-500 { color: #57534e !important; }`<br>`src/data/otterHelpContent.jsx:15` — `// Light-theme style tokens matching HelpPage's L constants const L = { sectionTitle: 'text-sm font-bold text-stone-900 uppercase tracking-wide mb-3',`




**HELP-03 · HIGH · Colour** — The Help page runs three greys on orange and two of them fail AA, in direct violation of the white-or-black rule

- Problem: HelpPage's L object uses text-stone-800 for body, text-stone-700 for list items, and text-stone-600 for both listMuted and the code token (HelpPage.jsx:28-35). Measured on #f4a261: stone-700 #44403c is 4.98:1 and passes but is still a grey on orange; stone-600 #57534e is 3.70:1 and fails, and it is used at 10px inside L.mono. lightSurface.js was written specifically to end this and exports LIGHT_INK for exactly this job, and HelpPage does not import it.

- Why it matters: Audrey's rule has no third option, and this page is the one she can reach in two clicks from Home. The fix is a token swap, not a redesign.

- Change: Collapse all four to LIGHT_INK #1c1917 and let hierarchy come from the scale: section 16/600, card title 14/600, body 14/400, list 13/400, caption 12/400. Import from lightSurface rather than declaring a fourth L object. Delete listMuted, it is a grey by another name.

- Evidence: `src/components/HelpPage.jsx:34` — `listMuted: 'text-[11px] text-stone-600 leading-relaxed', mono: 'text-[10px] text-stone-600 bg-white/30 p-2 rounded font-mono leading-relaxed',`<br>`src/components/lightSurface.js:22` — `//     #78716c  stone-500   2.33:1  ✗      #d6d3d1  stone-300   lighter than //     #1c1917  stone-900   8.49:1  ✓`




**HELP-04 · HIGH · Colour** — The Help sidebar is white ink on brown while the content four pixels away is black ink on orange, and the sidebar's inactive states measure 2.33:1 and 1.73:1  
law: Law of Uniform Connectedness

- Problem: The nav is rgba(120,70,30,0.55) over the page, which composites to about #b06f3c. Inactive sub-items are white at 55 percent alpha, about 2.33:1 (HelpPage.jsx:115). Collapsed tool labels are text-white/70. The version footer is white at 35 percent alpha at 10px, about 1.73:1 (HelpPage.jsx:135). So the page carries two complete ink systems side by side, and the recessive states of the primary navigation, which is this page's primary element, are the least legible text on it.

- Why it matters: An alpha on white is the same defect as a grey, measured differently. This is also the only 200px brown well in the app: every other panel in the overhaul plan is a hairline with no fill.

- Change: Drop the brown fill. The sidebar becomes the shared Panel: no ground, a single 1px LIGHT_RULE right edge, items in LIGHT_INK at the 13px Dense step, selected state carried by weight 600 plus a 2px signal left border (which the code already draws, just in white at line 117), and hover by a LIGHT_WELL fill. The version footer goes to the 11px Label step in full LIGHT_INK. That removes seven alpha-white values from the page and leaves one ink.

- Evidence: `src/components/HelpPage.jsx:115` — `color: activePage === item.id ? '#fff' : 'rgba(255,255,255,0.55)', fontWeight: activePage === item.id ? 'bold' : 'normal', borderLeft: activePage === item.id ? `<br>`src/components/HelpPage.jsx:135` — `<span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>`




**AUTH-06 · HIGH · System** — Two modals appear in one sign-in session and they share nothing: a dark bordered card and a near-white card Audrey has already banned  
law: Law of Similarity

- Problem: UpdatePrompt is #1c1917 with a 2px #ea580c border, 6px radius, backdrop rgba(28,25,23,0.72), width 380 (UpdatePrompt.jsx:62-67). InviteMemberDialog is #fff8f1 with no border, 4px radius, a 0 20px 40px shadow, backdrop rgba(28,25,23,0.55), width min(420px,92vw) (InviteMemberDialog.jsx:228-239). Two surfaces, two radii, two backdrops, two button kits, one shadow that the visual language says does not exist. #fff8f1 is a near-white card on a light-orange page, which is the Rate Card defect Audrey named verbatim as NO WHITE BACKGROUND.

- Why it matters: These are two of the 66 hand-rolled overlays the system review counts, and they are the two a single user meets in one session, so the inconsistency is directly observable rather than statistical. Both are small enough to delete into the shared Dialog rather than restyle.

- Change: Delete both overlay implementations into src/ui/Dialog once it is promoted from binUi: one backdrop rgba(12,10,9,0.6), one 8px radius, one floating shadow, header/body/footer contract, Escape on the topmost only. InviteMemberDialog's surface becomes LIGHT_SURFACE_SOLID #dd9155 (already the app's answer for an opaque floating panel on light), UpdatePrompt's becomes paper-raised. Their buttons become Button variants, which deletes InviteMemberDialog.jsx:276-287 outright.

- Evidence: `src/cloud/auth/InviteMemberDialog.jsx:234` — `background: '#fff8f1', color: '#1c1917', borderRadius: 4, padding: '22px 24px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)',`<br>`src/components/UpdatePrompt.jsx:63` — `backgroundColor: '#1c1917', border: '2px solid #ea580c', borderRadius: '6px', width: 380, maxWidth: '90vw',`




**AUTH-07 · HIGH · System** — Three surfaces register document-level arrow keys and each shows its shortcuts a different way, including one that shows nothing  
law: Paradox of the Active User

- Problem: This is Audrey's named example, made exact. BinsView has a Kbd-based shortcut bar (binUi.jsx:134). LoginScreen's workspace chooser registers ArrowUp, ArrowDown and Enter (LoginScreen.jsx:459-476) and renders a hand-made caps line, arrow glyphs set in running text at 10px (LoginScreen.jsx:686-688). Home registers ArrowUp, ArrowDown, Enter, Escape and ArrowLeft (Home.jsx:103-166) and shows nothing at all. HelpPage then documents Home's shortcut in prose (HelpPage.jsx:281), so the app ships a manual page describing a key the screen itself never mentions.

- Why it matters: Paradox of the Active User: nobody reads the Help page to learn that the Home screen has arrow keys. The shortcut bar is not a nicety, it is where that knowledge belongs, and this is the clearest demonstration in the app that the ecosystem has no shared vocabulary.

- Change: Mount src/ui/ShortcutBar, 28px, hairline top, Kbd plus 12px label pairs, on all three: Home gets Up Down Navigate, Enter Open; the workspace chooser gets the same pair; Bins keeps what it has, promoted to the shared component. Kbd goes to the 11px floor, not binUi's current 9px. Then delete the caps glyph line at LoginScreen.jsx:686 and leave the Help prose in place as documentation rather than as the only source.

- Evidence: `src/cloud/auth/LoginScreen.jsx:686` — `<div style={{ ...AUTH_HINT_STYLE, marginTop: '8px' }}>   ↑ ↓ TO MOVE · ENTER TO SELECT </div>`<br>`src/components/Home.jsx:103` — `const handleKeyDown = useCallback((e) => {   if (!resourcesOpen) {`<br>`src/components/HelpPage.jsx:281` — `<li>• <span className={L.listBold}>Use arrow keys</span> to navigate between buttons, press Enter to select</li>`




**AUTH-08 · HIGH · System** — authContrast.test.js pins the auth button as a permanent exception to the one-signal rule, and the rework will fail it  
**constraint: palette-decision**

- Problem: The test asserts that AUTH_BUTTON_STYLE.border is 'none', that its background is not #ea580c, that its luminance is strictly lower than #ea580c's, and that the quiet button's background differs from the primary's. Those assertions encode Audrey's verbatim instructions from 2026-08-10. The system review's palette proposes one signal value, #ea580c, for the one primary action everywhere. Unifying the auth button on signal fails three assertions in a test that is correct.

- Why it matters: This has to be resolved before the rework session starts, not discovered inside it, because the honest options differ in cost. It is also the one place where the review's own rule collides with a shipped ruling from Audrey, and a test is the right place for that collision to surface.

- Change: Put the choice to Audrey as a palette decision, not a code decision. Option A, recommended: #c2410c stays the primary-button fill app-wide, so the app has one signal for chrome and active states and one darker signal for filled primary buttons, which is two values with two jobs rather than an exception. Option B: the button moves to #ea580c and she restates the ruling, and the test is rewritten with her new words quoted in it. Do not quietly edit the assertions.

- Evidence: `src/cloud/auth/authContrast.test.js:84` — `expect(AUTH_BUTTON_STYLE.background).not.toBe(BARS) expect(luminance(AUTH_BUTTON_STYLE.background)).toBeLessThan(luminance(BARS))`<br>`src/cloud/auth/AuthShell.jsx:490` — `export const AUTH_BUTTON_STYLE = {   ...AUTH_TEXT_STYLE, fontSize: '12px', fontWeight: 700, letterSpacing: '0.18em',   background: '#c2410c', color: '#ffffff', `




**AUTH-09 · MEDIUM · Hierarchy** — Every gap on the login screen is 18px, so spacing carries no grouping information  
law: Law of Proximity

- Problem: The outer stack gap is 18px (LoginScreen.jsx:510), the keyed step wrapper gap is 18px (LoginScreen.jsx:524), and AUTH_GAP_BETWEEN_FIELDS is 18px (AuthShell.jsx:389). The title, the company chip, the username group, the password group, the button and the link row are therefore all equidistant. The kit is explicit and correct about the 5px to 18px ratio WITHIN a field, and then discards the idea one level up.

- Why it matters: Law of Proximity is the cheapest hierarchy tool available and the file already argues for it. A title that sits the same distance from the first field as the fields sit from each other is not a title, it is the first row.

- Change: Three gaps on the scale, not one: 8px inside a field group (replacing 5px, which is off the 4px base unit), 16px between field groups, 24px between the title and the form and between the form and the tertiary link row. Export them as AUTH_GAP_WITHIN_FIELD, AUTH_GAP_BETWEEN_FIELDS and AUTH_GAP_BETWEEN_BLOCKS so the third one cannot be hand-typed per screen the way 18px currently is in four files.

- Evidence: `src/cloud/auth/AuthShell.jsx:388` — `export const AUTH_GAP_WITHIN_FIELD = '5px' export const AUTH_GAP_BETWEEN_FIELDS = '18px'`<br>`src/cloud/auth/LoginScreen.jsx:508` — `<div style={{   display: 'flex', flexDirection: 'column', alignItems: 'center',   gap: '18px', minWidth: '320px',`




**AUTH-10 · MEDIUM · Hierarchy** — The auth form has no left edge: centred labels over centred values give four different label start positions in one stack  
_taste, not error_ · law: Fitts's Law

- Problem: AuthField centres the label over the control (AuthShell.jsx:557-560) and AUTH_INPUT_STYLE sets textAlign center on a 22ch field (AuthShell.jsx:436-437). On NewUserWelcome that produces four labels of different lengths, DISPLAY NAME, PRONOUNS · OPTIONAL, TITLE · OPTIONAL, AVATAR · OPTIONAL, each starting at a different x inside an identically sized column, and four values that reflow around their own centre as the user types.

- Why it matters: Audrey asked specifically that alignment in rows and items make sense. A stack of form fields with no shared left edge is the clearest example on this surface, and fixing it does not change the composition: the column stays centred on the screen, only its contents gain an edge.

- Change: Keep the column centred and its width fixed, and left-align everything inside it: label left, value left, error left, hint left. The button becomes full column width at 36px, which also puts the primary action on the same edge as the fields (Fitts's Law, the cursor is already in that column after typing). Centring survives in exactly one place, the page title above the form.

- Evidence: `src/cloud/auth/AuthShell.jsx:436` — `textAlign: 'center', width: '22ch',`<br>`src/cloud/onboarding/NewUserWelcome.jsx:207` — `<AuthField label="PRONOUNS · OPTIONAL">`




**AUTH-11 · MEDIUM · Typography** — Two sibling wizards shout their errors and two speak them, so the auth family has two voices  
law: Postel's Law

- Problem: LoginScreen's errors are all-caps sentences rendered bold (LoginScreen.jsx:91, 245, 258, 436) and NewUserWelcome's match (NewUserWelcome.jsx:99-108, 130). ForgotPasswordWizard and ResetPasswordWizard use sentence case in the same AUTH_ERROR_STYLE slot (ForgotPasswordWizard.jsx:85, ResetPasswordWizard.jsx:168-172). All four are the same component family and the difference is not deliberate, it is drift, and it is in the literal strings rather than in the tokens, so the shared kit cannot fix it.

- Why it matters: An all-caps error reads as the system blaming the user, and sentence case is what Notion and the Apple system apps use for exactly this reason. It is also the cheapest possible edit: string case, no layout change.

- Change: Sentence case for every message on every auth surface, including GENERIC_ERROR. Keep them generic where security requires it, change only the case and the terminal punctuation. Same pass covers the shouted hints (ENTER THE 6-DIGIT CODE..., TELL US ABOUT YOURSELF, SELECT WORKSPACE, VERIFYING LINK…) and the shouted labels, which stay uppercase because Label is the one role that keeps case.

- Evidence: `src/cloud/auth/LoginScreen.jsx:91` — `const GENERIC_ERROR = 'SIGN-IN FAILED. CHECK COMPANY, USERNAME AND PASSWORD.'`<br>`src/cloud/auth/ResetPasswordWizard.jsx:168` — `setError('Password must be 10–128 characters.')`




**AUTH-12 · MEDIUM · System** — An undeclared prose role is inline-declared four times across two files

- Problem: The reset, invite-confirm, invalid-link and sent-email screens all need a paragraph, and the kit has no paragraph. Each one therefore spells out the same override inline: fontSize 14px, fontWeight 500, letterSpacing 0.04em, textTransform none, maxWidth 38ch, textAlign center (ForgotPasswordWizard.jsx:178, ResetPasswordWizard.jsx:226, 244, 296). Weight 500 appears nowhere else in the app and 0.04em appears only here.

- Why it matters: Four copies of one unnamed role is how the auth surfaces drifted before, and the file headers say so. It is also the one place in the family where the type is nearly right already, which makes it cheap to name.

- Change: Export AUTH_PROSE_STYLE at the Body step, 14/400/sentence/0 tracking, leading 1.5, measure 60ch, left aligned inside the centred column (per AUTH-10). Delete all four inline copies. Weight 500 disappears from the app with them.

- Evidence: `src/cloud/auth/ResetPasswordWizard.jsx:226` — `<div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>`<br>`src/cloud/auth/ForgotPasswordWizard.jsx:178` — `<div style={{ ...AUTH_TEXT_STYLE, fontSize: '14px', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'none' }}>`




**AUTH-13 · MEDIUM · System** — UpdatePrompt puts two buttons in one row with two different type treatments  
law: Law of Similarity

- Problem: In a single flex row, Skip this version is text-xs font-mono sentence case with a #44403c outline (UpdatePrompt.jsx:96-97) and Update now is text-xs font-bold uppercase tracking-wider on an #ea580c fill with a #c2410c border (UpdatePrompt.jsx:104-105). Same row, same size, two faces, two cases, two tracking values. The dark secondary buttons also use #a8a29e as a label, which is one of the four greys the ink token replaces.

- Why it matters: Law of Similarity in reverse: two controls with the same function class should differ in emphasis, not in typeface. This is the most visible single-row inconsistency on the surface and it is four class strings.

- Change: Both become Button: primary variant, signal fill, 14/600 sentence case, 36px; secondary variant, hairline, ink at 72 percent, 36px, same padding pair. Mono leaves the modal entirely, including the body line at UpdatePrompt.jsx:71, which is a sentence and not a numeric.

- Evidence: `src/components/UpdatePrompt.jsx:96` — `className="text-xs font-mono px-3 py-2 rounded-sm" style={{ color: '#a8a29e', backgroundColor: 'transparent', border: '1px solid #44403c' }}`<br>`src/components/UpdatePrompt.jsx:104` — `className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-sm" style={{ color: '#fff7ed', backgroundColor: '#ea580c', bor`




**AUTH-14 · MEDIUM · System** — WorkspaceSwitcher and MfaSecuritySection open with the identical hand-typed section header, one of 43 copies in the repo  
law: Law of Similarity

- Problem: Both files open with h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1" followed by p className="text-xs text-stone-950 mb-4 leading-relaxed" (WorkspaceSwitcher.jsx:131-137, MfaSection.jsx:366-370). That exact class string appears 43 times across src. These two are adjacent panels in the same Settings page, so the duplication is visible as well as structural.

- Why it matters: This is the SectionTitle component's whole justification, expressed in two files a rework session will already have open. It is also the cheapest place to prove the component works before rolling it wider.

- Change: Both become src/ui/SectionTitle: 16px sentence case weight 600, optional 13px description, hairline above rather than nothing, 24px block spacing. Doing these two first gives the component its first two consumers inside this surface's own scope.

- Evidence: `src/cloud/auth/WorkspaceSwitcher.jsx:131` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">   Active Workspace </h2>`<br>`src/cloud/auth/MfaSection.jsx:366` — `<h2 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-1">Two-Factor Authentication</h2>`




**AUTH-15 · MEDIUM · Colour** — Seven distinct reds mean error across this surface alone

- Problem: #dc2626 (MfaSection.jsx:161, 391, 400, 422), #7f1d1d (AUTH_ERROR_INK), #ef4444 (referenced in the AuthShell comment and the test), #b91c1c (InviteMemberDialog.jsx:199), #991b1b (WorkspaceSwitcher.jsx:184), #fca5a5 (UpdatePrompt.jsx:85), plus rgba(220,38,38,0.15) and rgba(220,38,38,0.08) as fills, and a dead #ffd7c2 named in a comment. Twelve files carry 51 distinct colour values in total.

- Why it matters: Every one of these means the same thing. The review's rule is that a new colour is guilty until proven innocent, and the innocent set here is two: one danger on light and one on dark.

- Change: Two values: #b91c1c on light surfaces, #fca5a5 on dark. The two rgba fills become a 10 percent screen of the same value rather than a second hex. AUTH_ERROR_INK keeps its job only if #b91c1c fails the well measurement; test it and keep whichever passes, but keep one.

- Evidence: `src/cloud/auth/MfaSection.jsx:391` — `<span className="text-[11px] font-mono" style={{ color: '#dc2626' }}>Disable MFA?</span>`<br>`src/cloud/auth/WorkspaceSwitcher.jsx:184` — `<div className="mt-2 text-[11px] font-mono" style={{ color: '#991b1b' }}>`




**HELP-05 · MEDIUM · Typography** — Help bullets are literal glyphs with no hanging indent, so every wrapped line starts under the bullet

- Problem: Lists are rendered as ul with ml-2 and each li begins with a literal bullet character and a space (HelpPage.jsx:172-178, and the same shape throughout both content modules). There is no list-style, no padding-left and no text-indent, so a wrapped second line starts at the bullet column rather than at the text column. At the current 190ch measure almost every item wraps, so almost every item is misaligned.

- Why it matters: Audrey asked that placement and alignment look clean. This is the most frequent alignment defect on the surface by raw count: it happens on every list item on every help page.

- Change: Real list semantics: ul with list-disc, padding-left 20px, marker colour at ink 48 percent, and delete the literal bullet glyphs. The marker then sits in its own column and wrapped lines align under the text. Combined with HELP-01's measure cap most items stop wrapping at all.

- Evidence: `src/components/HelpPage.jsx:172` — `<ul className={'${L.listItem} space-y-1 ml-2'}>   <li>• <span className={L.listBold}>Multiple projects</span> — Create and manage separate projects...</li>`




**HELP-06 · MEDIUM · Density** — The Help card is the banned white card, in its third implementation  
law: Law of Common Region

- Problem: L.card is bg-white/40 p-3 rounded-sm border border-stone-400/30 (HelpPage.jsx:30, duplicated at otterHelpContent.jsx:18). Over #f4a261 that composites to about #f8c7a0, a pale card dropped on the orange page, which is the defect lightSurface.js records Audrey rejecting on the Rate Card. The border is stone-400 at 30 percent, a grey rule, where the app already has LIGHT_RULE for exactly this.

- Why it matters: The card is also doing a job it does not need to do. Law of Common Region is satisfied by a hairline and consistent gutters, and lightSurface's header says so in as many words. Removing the fill removes a colour and reads more like Notion at the same time.

- Change: Replace the card with LIGHT_WELL where grouping genuinely matters (the Key Features blocks) and with a hairline plus 24px block spacing everywhere else. One border token, LIGHT_RULE. Radius 4px per the system. Delete bg-white/40 and bg-white/30 from both help modules.

- Evidence: `src/components/HelpPage.jsx:30` — `card: 'bg-white/40 p-3 rounded-sm border border-stone-400/30',`<br>`src/components/lightSurface.js:60` — `// Audrey, 2026-08-10, on the Rate Card: "NO WHITE BACKGROUND."`




**HELP-07 · MEDIUM · Flow** — The Help navigation no longer matches the app: R.A.B.B.I.T. is absent and the subtitles it defines are never rendered  
law: Mental Model

- Problem: TOOL_SECTIONS lists D.O.G., O.T.T.E.R., Project Manager and Wilson (HelpPage.jsx:6-11). R.A.B.B.I.T., one of the three tools on Home, has no help section at all, and Project Manager, which lives under Resources rather than under Tools on Home, is listed as a peer of the tools. Each entry also carries a subtitle field which the render never uses, so the descriptive line that would tell a first-time user what O.T.T.E.R. stands for is defined and thrown away.

- Why it matters: Mental Model: the Help IA should mirror the navigation the user just came from. It does not, and the omission is a whole tool. The unused subtitle is free hierarchy already sitting in the file.

- Change: Render the subtitle as a 12px Caption line under each tool label in the sidebar, which gives the nav a second level without adding a control. Group the sections to mirror Home: Tools (D.O.G., O.T.T.E.R., R.A.B.B.I.T.) then Resources (Projects) then Wilson. Adding the R.A.B.B.I.T. section is content work rather than visual work, so flag it for Audrey rather than fabricating help text.

- Evidence: `src/components/HelpPage.jsx:6` — `const TOOL_SECTIONS = [   { id: 'dog', label: 'D.O.G.', subtitle: 'Deck Outline Generator' },   { id: 'otter', label: 'O.T.T.E.R.', subtitle: 'Training & Educat`<br>`src/components/HelpPage.jsx:99` — `<span className={'text-[11px] font-bold uppercase tracking-wider ${isExpanded ? 'text-white' : 'text-white/70'}'}>   {tool.label} </span>`




**AUTH-16 · MEDIUM · Density** — NewUserWelcome already overflows its well at the minimum window, and it is the surface the overhaul will make taller

- Problem: AuthShell's own comment records that NewUserWelcome is the tallest consumer and still overflows at the 700px minimum window, unfixed, unmeasured since (AuthShell.jsx:71-76). The screen stacks a title, a hint, four AuthFields, an avatar row and a submit, all at 18px gaps. Raising the body from 10 and 11px to 12, 13 and 14px makes it taller still, and SPLIT_BAR_HEIGHT of 24vh was derived from a 330px measurement that will no longer hold.

- Why it matters: This is a live defect that the type change will make worse if nobody re-derives the number, and the file explicitly warns that the last person who guessed it put a 348px block into a 346px well.

- Change: Re-derive SPLIT_BAR_HEIGHT from a fresh measurement of the retyped NewUserWelcome in the running app at 700px, not from arithmetic. If it still does not fit, the correct lever is the gap scale (16px between fields rather than 18) and a two-column row for pronouns and title, not a second set of bars. Record the new measurement in the comment the way the current one is recorded.

- Evidence: `src/cloud/auth/AuthShell.jsx:71` — `// ⚠️ NewUserWelcome is the tallest consumer (4 fields + avatar row) and still // overflows at the 700px MINIMUM window — as it did at 28vh, so this is not a //`<br>`src/cloud/auth/AuthShell.jsx:80` — `const SPLIT_BAR_HEIGHT  = '24vh'`




**AUTH-17 · MEDIUM · Hierarchy** — The MFA gate presents three peer actions, so the screen has no primary  
law: Von Restorff Effect

- Problem: Activate MFA is a filled button; Set up later and Sign out instead are two identical 11px underlined links side by side with an 18px gap and no divider (MfaSection.jsx:301-316). The two links are the same colour, size, weight and decoration, so a deferral and a sign-out read as the same kind of thing. LoginScreen solved this exact problem eight files away with a middle dot at a 10px gap (LoginScreen.jsx:594-616).

- Why it matters: Von Restorff only works if one thing stands out. Three equal exits from a gate is a Hick's Law hotspot on a screen whose whole purpose is to move one decision forward.

- Change: Do not remove either escape hatch, this is a visual pass. Adopt LoginScreen's own row pattern: Set up later · Sign out instead, one quiet line, 13px, 8px gap, one divider glyph, sitting 24px below the primary. The gate then has one button, one line of exits and one heading.

- Evidence: `src/cloud/auth/MfaSection.jsx:301` — `<div style={{ display: 'flex', gap: '18px' }}>   <button ... style={{ ...AUTH_LINK_STYLE, fontSize: '11px' }}>Set up later</button>   <button ... style={{ ...AU`<br>`src/cloud/auth/LoginScreen.jsx:594` — `<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>`




**HOME-01 · MEDIUM · Typography** — Home's nav labels are 14px bold uppercase tracked, the same typographic object as every table header in the app  
**constraint: touches-home**

- Problem: Both columns render font-bold text-sm tracking-widest uppercase (Home.jsx:226 and Home.jsx:300). That is 14px, weight 700, uppercase, 0.1em. The same description fits a Settings section header, a table header cell, a chip and a status pill elsewhere in the app, so the app's primary navigation has no typographic rank of its own. Each label also sits beside a 32px icon, so the icon is more than three times the cap height of the word it labels.

- Why it matters: The brief says Home needs no overhaul and only its fonts must match. This is that change, and it is the one that will make Home read as belonging to the new system: a nav item is a destination, which is an H3 or H2 job, not a label job.

- Change: Labels become 16px, weight 600, sentence case, zero tracking, in LIGHT_INK, matching the H2 step. That is the whole type change. Note the consequence for Audrey rather than acting on it: at 16px sentence case the 32px icon becomes visually dominant and 24px would restore the ratio, but icon size is not type and the brief scopes this to fonts.

- Evidence: `src/components/Home.jsx:226` — `className="font-bold text-sm tracking-widest uppercase transition-colors duration-200" style={{ color: highlighted ? '#fff' : '#1c1917' }}`<br>`src/components/Home.jsx:300` — `className="font-bold text-sm tracking-widest uppercase transition-colors duration-200"`




**HOME-02 · MEDIUM · Colour** — Home's hover state puts white on a mid-brown at about 3.55:1, below AA for 14px bold  
**constraint: touches-home**

- Problem: HIGHLIGHT_BG is rgba(154,100,56,0.65), which over #f4a261 composites to about #b97a46. White text on that measures roughly 3.55:1 (Home.jsx:48, 215, 227). At 14px bold the AA threshold is 4.5:1, so the highlighted state is less legible than the resting state, which is black at 8.49:1. The hover state is the one the user is reading.

- Why it matters: It is the same class of defect as the eighteen-session white-on-orange bug, one composite step removed, and it is on the screen with the highest traffic in the app.

- Change: Keep the hover fill and switch the label and icon to LIGHT_INK, so hover changes the ground and not the ink and the page keeps one ink. If Audrey wants the inversion kept for its feel, darken HIGHLIGHT_BG to rgba(120,70,30,0.8), which takes white past 4.5:1, and record the measurement in authContrast.test.js beside the auth tokens.

- Evidence: `src/components/Home.jsx:48` — `const HIGHLIGHT_BG = 'rgba(154, 100, 56, 0.65)'`<br>`src/components/Home.jsx:221` — `<Icon className="w-8 h-8 ..." style={{ color: highlighted ? '#fff' : '#1c1917' }} />`




**AUTH-18 · MEDIUM · Motion** — The page-transition title is smaller than the page header it hands off to, so the biggest moment in the app carries its smallest display type  
**constraint: touches-transition** · law: Peak-End Rule

- Problem: The transition holds for 400ms on a full-bleed #f4a261 field and sets the page name at 16.8px, bold, uppercase, 0.3em (App.jsx:2073-2076). The PageHeader it reveals sets the same name at 20px (App.jsx:1896). The transition also uses a fractional pixel size, which is below the rendering threshold the review flags, and 0.3em tracking is the widest value in the app.

- Why it matters: The constraint says the transition stays and its type may be critiqued. This is the critique: a 1600ms branded transition whose sole content is one word should be the Display step, and it is currently three pixels smaller than the header underneath it. The move is right, the type undersells it.

- Change: Set the transition title at the Display step, 34px, weight 600, uppercase, +0.12em, leading 1.0, colour #1c1917 which is already correct. Leave every duration untouched: fadeOut 250, compress 600, hold 400, expand 600, fadeIn 250. Display and Label remain the only two uppercase roles in the system, and this is Display's only consumer.

- Evidence: `src/App.jsx:2073` — `fontWeight: 'bold', fontSize: '16.8px', letterSpacing: '0.3em',`<br>`src/App.jsx:1896` — `<h1 className="text-[20px] font-bold tracking-tight uppercase text-white">{pageLabel}</h1>`




**AUTH-19 · MEDIUM · System** — OperatorLogin is a fifth auth surface that shares nothing with the other four  
law: Law of Similarity

- Problem: It is dark #1c1917 rather than the light well, its labels are 10px bold uppercase tracking-wider left aligned rather than the centred 11px AUTH_LABEL_STYLE, its inputs are font-mono on rgba(0,0,0,0.35) with no baseline rule, and it carries the only focus ring in the entire auth family (focus:ring-2 focus:ring-orange-500). Its heading is the same 43-times-copied Settings section-header class. It imports none of the AUTH_* tokens.

- Why it matters: The kit's header says a value used on more than one auth surface belongs in AuthShell, and this surface was simply never counted. It is also, ironically, the only auth screen that does the focus state correctly, which is where AUTH-03's fix should be lifted from.

- Change: Point it at the shared kit. It can keep a dark ground, that is a legitimate surface class, but the field kit, label role, button, error voice and gaps all come from AuthShell with a dark variant added there rather than re-invented here. Promote its focus ring into the global :focus-visible rule before deleting the local one.

- Evidence: `src/admin/OperatorLogin.jsx:177` — `<label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#a8a29e' }}>   Email </label>`<br>`src/admin/OperatorLogin.jsx:185` — `className="w-full px-3 py-2 mb-4 text-xs font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"`




**AUTH-20 · MEDIUM · Flow** — Loading and empty look identical across the auth family, and no state on this surface has a skeleton or a spinner  
law: Doherty Threshold

- Problem: ResetPasswordWizard's loading state is one uppercase line, VERIFYING LINK… (ResetPasswordWizard.jsx:221), which is typographically identical to the hint lines beside it. MfaEnrollPanel's is Preparing enrollment… in 12px mono (MfaSection.jsx:156). MfaSecuritySection's is Checking status… (MfaSection.jsx:373). Busy states on every button are expressed as a label swap plus opacity 0.55 (LoginScreen.jsx:483-488, ForgotPasswordWizard.jsx:161-165, ResetPasswordWizard.jsx:200-204, NewUserWelcome.jsx:261-266). Four inline copies of one busy treatment, and no progress affordance anywhere despite a documented 4s handoff fallback.

- Why it matters: Doherty Threshold: these are network calls that can exceed 400ms by design, and dimming a button by 45 percent is indistinguishable from disabling it. The system review's Loading component exists precisely so that loading and nothing-here stop looking the same.

- Change: One Loading component, spinner variant for these screens, mounted in the same slot the content occupies so the layout does not jump. Button gains a loading state that owns the opacity and the label swap, which deletes four inline copies. Keep the label text swap, it is good, and pair it with a 14px inline spinner at the leading edge.

- Evidence: `src/cloud/auth/ResetPasswordWizard.jsx:220` — `{stage === 'loading' && (   <div style={AUTH_HINT_STYLE}>VERIFYING LINK…</div> )}`<br>`src/cloud/auth/LoginScreen.jsx:483` — `const submitStyle = {   ...AUTH_BUTTON_STYLE,   cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1,`




**AUTH-21 · MEDIUM · Build** — The press effect mutates inline transform on the DOM node, which no class-based Button can carry forward  
**constraint: touches-interaction**

- Problem: LoginScreen's press handler writes e.currentTarget.style.transform directly on mouse down, up and leave (LoginScreen.jsx:489-493). It is spread onto three buttons. The busy state is likewise an inline opacity. So two interaction states of the primary control live outside both the token object and any stylesheet, and a component extraction that only moves classes will silently drop them.

- Why it matters: This is the build pass finding for this surface. It is small, but it is exactly the kind of thing that gets lost in a mechanical refactor and then reads as the new build feeling less responsive than the old one.

- Change: Move the press feedback into CSS on the Button component, :active { transform: scale(0.98) } with a 100ms ease-out, so it survives extraction and respects prefers-reduced-motion via the existing media query. Delete the press object and its three spreads.

- Evidence: `src/cloud/auth/LoginScreen.jsx:489` — `const press = {   onMouseDown: (e) => !busy && (e.currentTarget.style.transform = 'scale(0.98)'),   onMouseUp:   (e) => (e.currentTarget.style.transform = 'scal`




**AUTH-22 · LOW · Density** — Field measure differs between siblings: 22ch on login, 24ch on the welcome wizard

- Problem: AUTH_INPUT_STYLE fixes width at 22ch (AuthShell.jsx:437) and NewUserWelcome overrides it to 24ch (NewUserWelcome.jsx:174) with no stated reason. The two screens appear in sequence for a new user, in the same well, with the same centring, so the rule under the fields changes length between one screen and the next.

- Why it matters: The kit exists to stop exactly this. It is a one-line fix and it removes the only unexplained override in the family.

- Change: One measure. Set the field width once in the kit, in px on the 4px scale rather than in ch (ch drifts with the face and the size, which AuthPasswordInput's comments document at length), and delete the override.

- Evidence: `src/cloud/onboarding/NewUserWelcome.jsx:174` — `const inputStyle = { ...AUTH_INPUT_STYLE, width: '24ch' }`<br>`src/cloud/auth/AuthShell.jsx:437` — `width: '22ch',`




**AUTH-23 · LOW · System** — The avatar preview carries the only 2px border in the auth family

- Problem: Every rule on every auth surface is 1px, deliberately and with an argument in the file (AuthShell.jsx:455-461: one rule weight across the whole screen, nothing filled, nothing shadowed). The avatar preview then draws a 2px ring (NewUserWelcome.jsx:237), on the screen with the most rules on it.

- Why it matters: Small, but it is the surface's one violation of its own best-stated rule, and the system is deleting border-2 app-wide anyway.

- Change: 1px AUTH_INK. While in there, note the layout consequence: the preview appears only after a file is chosen, so the row grows by 60px and the centred column reflows. Reserve the 48px slot from the start with a hairline placeholder circle so choosing a file does not move the form.

- Evidence: `src/cloud/onboarding/NewUserWelcome.jsx:235` — `width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', border: '2px solid ${AUTH_INK}',`




**AUTH-24 · LOW · Typography** — The MFA code field centres text that carries a trailing letter-space, so the digits sit about 3px left of centre

- Problem: LoginScreen sets letterSpacing 0.35em with textAlign center on the code input (LoginScreen.jsx:632), and MfaSection does the same at width 160 (MfaSection.jsx:209-210). CSS adds tracking after the final glyph as well as between glyphs, so a centred tracked string is always offset left by half the tracking value, about 3px at 17px type.

- Why it matters: It is the sort of defect that reads as the field being slightly wrong without the viewer knowing why, and it is two properties. Both files need it, which also makes it a second argument for the code field being a component.

- Change: Add textIndent equal to the tracking value, 0.35em, on both inputs, which restores optical centre. Better: make it one OtpInput in the kit, since the code field now exists in three places (LoginScreen, MfaEnrollPanel, OperatorLogin) with three different sizes, 17px, 14px and 18px.

- Evidence: `src/cloud/auth/LoginScreen.jsx:632` — `style={{ ...AUTH_INPUT_STYLE, letterSpacing: '0.35em', textAlign: 'center' }}`<br>`src/cloud/auth/MfaSection.jsx:209` — `style={{   letterSpacing: '0.35em',   width: 160,`




**AUTH-25 · LOW · Density** — Three mono stacks and font-mono used for prose on surfaces that have no numerics

- Problem: AuthShell declares ui-monospace, SFMono-Regular, Menlo, Consolas (line 611), InviteMemberDialog declares Menlo, Consolas, monospace (line 273), and the rest of the app uses ui-monospace, monospace. On this surface font-mono appears 29 times (MfaSection 16, UpdatePrompt 6, WorkspaceSwitcher 5, HelpPage 2) and almost none of them are a numeric, an id, a path or a key: they are status words (Enabled, Not enrolled, Checking status…), a workspace slug, an error, a percent label and a sentence about an update.

- Why it matters: The system rule is that mono keeps numerics, ids, paths, timecode, keys, code and the version footer, and loses everything else. Applied here it deletes about 26 of 29 uses and leaves three that genuinely earn it: the TOTP secret (MfaSection.jsx:195), the version string (HelpPage.jsx:135), and the download percent (UpdatePrompt.jsx:80).

- Change: Delete font-mono from every consumer on this surface except those three. Collapse the three declared stacks to one pinned Geist Mono / JetBrains Mono stack in the token module. The workspace slug at WorkspaceSwitcher.jsx:165 and LoginScreen.jsx:680 is a judgement call: it is an identifier, so mono is defensible there, but it must be the same decision in both files and it is currently the same by accident.

- Evidence: `src/cloud/auth/MfaSection.jsx:382` — `<span className="flex items-center gap-1.5 text-xs font-mono" style={{ color: '#15803d' }}>   <ShieldCheck className="w-4 h-4" /> Enabled`<br>`src/cloud/auth/InviteMemberDialog.jsx:272` — `const codeStyle = {   fontFamily: 'Menlo, Consolas, monospace',`




**HELP-08 · LOW · Density** — Help is the only light page that opts out of the app's content gutter, so it is a third layout class

- Problem: App.jsx sets the content padding to 3vh 0 for light pages and 0 for dark pages and for Help specifically (App.jsx:2100). Help therefore runs full-bleed between 140px and 100px bars while Settings, Projects, Rate Card and Team Members sit inside a vh gutter. Three layout behaviours for one page class, and the gutter that does exist is in vh, so it changes with window height while the horizontal gutter does not.

- Why it matters: The system's answer is one 24px page gutter used by the bar, the nav strip and every page, and pages stop setting their own padding. Help is the page that proves the current rule is not a rule.

- Change: One gutter, 24px, applied by the shell, with Help's sidebar allowed to bleed to the gutter edge as a Panel rather than to the window edge. Delete the Help special case from App.jsx:2100 and the 3vh value with it.

- Evidence: `src/App.jsx:2100` — `padding: (isDarkPage || currentPage === 'help') ? 0 : '3vh 0',`




**AUTH-26 · LOW · Motion** — Reduced motion suppresses the shell's transitions but the phase timers still run, so a reduced-motion user waits 5.6 seconds at a static orange screen  
**constraint: touches-transition** · law: Doherty Threshold

- Problem: AuthShell's motion() helper returns none for every transition when the user prefers reduced motion (AuthShell.jsx:239-240), and the comment correctly explains why the timers cannot simply be cleared: onIntroComplete and the reveal handoff hang off them and carry StrictMode guards. The result is that the logo fade (1200ms), the hold (up to 3800ms), the fade out (500ms), the idle (1000ms) and the split hold (1600ms) all still elapse, just without anything moving.

- Why it matters: The rule is that reduced motion delivers the end state instantly rather than a slower version. Here it delivers the end state after the same delay with nothing to look at, which is worse than the animation.

- Change: Keep the timer architecture, it is load-bearing, and shorten the durations under reduced motion instead: read prefersReducedMotion() once at mount and select a second timing table where LOGO_FADE_IN_MS, LOGO_HOLD_MS, IDLE_HOLD_MS and SPLIT_HOLD_MS are 0 and the reveal is 100ms. Same code path, same guards, no new branch in the effects.

- Evidence: `src/cloud/auth/AuthShell.jsx:234` — `// Reduced motion: deliver every end state instantly rather than slowly. // Only the CSS transitions are suppressed — the phase TIMERS are untouched,`<br>`src/cloud/auth/AuthShell.jsx:48` — `const LOGO_FADE_IN_MS   = 1200 const LOGO_FADE_OUT_MS  = 500 const LOGO_HOLD_MS      = 3800   // safety fallback when the chime can't play`




**AUTH-27 · LOW · Colour** — WorkspaceSwitcher uses a 2px border, a one-off brown and a filled-orange row on a light page  
law: Law of Common Region

- Problem: The active row is rgba(234,88,12,0.18) with a 2px #ea580c border and a dot ringed in #7c2d12, a colour used nowhere else on this surface (WorkspaceSwitcher.jsx:148-160). So the content layer is borrowing the frame's signal colour as a fill, which the review's orange-chrome condition explicitly forbids, and doing it behind a 2px rule on a page where everything else is 1px.

- Why it matters: A row is not chrome. Once a content element fills with #ea580c, the frame stops meaning anything, and this is the only place on my surface where that happens.

- Change: Selected row becomes the Table row treatment: LIGHT_WELL fill plus a 2px signal LEFT border only, 1px hairline elsewhere, dot in signal with no ring. #7c2d12 is deleted. The current / switching… labels become the 11px Label step in a fixed right-hand column.

- Evidence: `src/cloud/auth/WorkspaceSwitcher.jsx:149` — `backgroundColor: active ? 'rgba(234, 88, 12, 0.18)' : 'rgba(120, 70, 30, 0.18)', border: '2px solid ${active ? '#ea580c' : 'transparent'}',`<br>`src/cloud/auth/WorkspaceSwitcher.jsx:157` — `backgroundColor: active ? '#ea580c' : 'transparent', border: '2px solid #7c2d12',`




**AUTH-28 · LOW · Typography** — Source case and rendered case disagree across the family, which makes the uppercase problem ungreppable

- Problem: LoginScreen writes Sign in and Continue in sentence case and AUTH_BUTTON_STYLE uppercases them at render (LoginScreen.jsx:543, 584). NewUserWelcome writes CHOOSE FILE in literal capitals (NewUserWelcome.jsx:253). MfaSection writes Activate MFA with its own uppercase class (MfaSection.jsx:229). So the same rendered word is produced three ways, and grepping for uppercase strings finds only one of the three.

- Why it matters: It matters for the rework rather than for the user: removing textTransform from the kit will leave NewUserWelcome shouting alone, and nothing will flag it.

- Change: One rule: text is written in the case it renders. Remove textTransform from every non-label token, then fix the literal capitals in place. Add a lint or a test that no button label string in src/cloud is entirely uppercase.

- Evidence: `src/cloud/onboarding/NewUserWelcome.jsx:253` — `{avatarFile ? 'CHANGE' : 'CHOOSE FILE'}`<br>`src/cloud/auth/LoginScreen.jsx:543` — `{busy ? 'Checking…' : 'Continue'}`





## Uniformity gaps

- **Shortcut hints for document-level keys** — here: LoginScreen.jsx:686 renders arrow glyphs in a 10px uppercase sentence; Home.jsx:103-166 registers five keys and renders nothing; HelpPage.jsx:281 describes Home's keys in prose. — elsewhere: BinsView mounts a Kbd-based shortcut bar built on binUi.jsx:134, which is the treatment Audrey named as the example of what the rest of the app lacks. — do: One ShortcutBar at 28px with Kbd at the 11px floor, mounted by every view that registers document-level keys: Bins, Home, the LoginScreen workspace chooser. Delete the caps glyph line.

- **Section header above a settings panel** — here: WorkspaceSwitcher.jsx:131 and MfaSection.jsx:366 carry the identical hand-typed class string, two of 43 copies in src. — elsewhere: Every admin section, MigrationPanel and SettingsPage use the same string with small divergences in the trailing margin. — do: src/ui/SectionTitle at 16px sentence case weight 600 with an optional 13px description and a hairline above. These two panels are the natural first consumers because they sit adjacent in one page.

- **Modal chrome** — here: UpdatePrompt.jsx:63 is dark with a 2px signal border, 6px radius, 0.72 backdrop; InviteMemberDialog.jsx:234 is near-white with no border, 4px radius, a drop shadow and a 0.55 backdrop. — elsewhere: binUi's Modal is the best implementation in the repo (modal stack, topmost-only Escape, busy lock, in-footer error, onBeforeClose guard) and the review promotes it to src/ui/Dialog. — do: Delete both into Dialog rather than restyling them. One backdrop, one 8px radius, one shadow, header/body/footer. InviteMemberDialog's surface becomes LIGHT_SURFACE_SOLID, which also removes the banned near-white card.

- **Help content tokens** — here: HelpPage.jsx:27-38 declares an L object; otterHelpContent.jsx:15-37 declares a near-identical L plus a D; dogHelpContent.jsx:22-44 declares neither and instead injects an !important stylesheet to repaint dark classes for the light page. — elsewhere: lightSurface.js is the counter-example the review cites: one shared token module, 30 importers, and it fixed grey-on-orange app-wide. — do: One help token module with a light and a dark pair, imported by all three. Delete LIGHT_THEME_STYLES. This is the second global style injection in the app and removing it also removes three failing contrast values.

- **Auth field kit** — here: AuthShell exports one kit and four surfaces use it correctly. — elsewhere: OperatorLogin.jsx:177-215 is a fifth auth surface with its own labels, its own mono inputs, its own error colour and the only focus ring in the family. — do: Point OperatorLogin at the shared kit with a dark surface variant added to AuthShell, and lift its focus ring into the global :focus-visible rule before deleting it locally.

- **Version string** — here: HelpPage.jsx:135 renders it at 10px white 35 percent on brown, about 1.73:1. — elsewhere: Five files render __WILSON_VERSION__ (DiagnosticsSection, HelpPage, VersionPanel, SettingsPage, UpdatePrompt), each with its own type and colour. — do: One Version component at the 11px Label step in full ink. It is one of the three places mono legitimately survives.

- **Error ink** — here: Seven distinct reds across this surface: #dc2626, #7f1d1d, #ef4444, #b91c1c, #991b1b, #fca5a5 and two rgba fills. — elsewhere: The system proposes one danger on light and one on dark. — do: Two values, both asserted in authContrast.test.js so a third cannot be added without a failing test.

- **Busy state on a primary button** — here: Four inline copies of cursor plus opacity 0.55 (LoginScreen.jsx:483, ForgotPasswordWizard.jsx:161, ResetPasswordWizard.jsx:200, NewUserWelcome.jsx:261). — elsewhere: No other surface in the app expresses busy the same way. — do: Button owns loading as a variant state with a 14px leading spinner, and the four inline objects are deleted.

- **Two peer tertiary actions** — here: LoginScreen.jsx:594 uses link · link at a 10px gap with a divider; MfaSection.jsx:301 uses link link at an 18px gap with no divider. — elsewhere: No third implementation, which makes this the cheapest uniformity fix on the surface. — do: Adopt LoginScreen's row wholesale, at the 13px step, 8px gap, one divider glyph.


## Alignment issues

- Every AuthField stack on every auth surface (`src/cloud/auth/AuthShell.jsx:557`): AuthField centres the label over the control and AUTH_INPUT_STYLE centres the value inside a fixed-width field, so labels of different lengths start at different x positions within identically sized columns and typed values reflow around their own centre. NewUserWelcome shows four different label left edges in one stack. → Keep the column centred on the screen and fixed in width; left-align the label, the value, the hint and the error inside it. The form gains a single left edge without any change to the composition.

- MFA code field, both implementations (`src/cloud/auth/LoginScreen.jsx:632`): letterSpacing 0.35em combined with textAlign center offsets the digits left of true centre by half the tracking, about 3px at 17px, because CSS adds tracking after the final glyph. → Add textIndent 0.35em to both fields, or promote one OtpInput to the kit and fix it once. The same defect exists at MfaSection.jsx:209 and OperatorLogin.jsx:212 at three different sizes.

- Workspace chooser rows (`src/cloud/auth/LoginScreen.jsx:678`): The row is a flex line of cursor, name and slug at a 10px gap, so the slug's x position moves with every workspace name and the secondary data has no column of its own. → Two columns: name left in the 14px step, slug right-aligned in a fixed column at the 12px Caption step. The 12px cursor slot is already fixed width and is correct.

- Avatar row inside its AuthField (`src/cloud/onboarding/NewUserWelcome.jsx:230`): The 48px preview only mounts after a file is chosen, so the row grows by about 60px and the centred column reflows around it, moving the whole form sideways at the moment the user acts. → Reserve the 48px slot from first paint with a hairline placeholder circle. This is the HoverActions reserved-slot principle applied to a conditional element.

- Help sidebar items (`src/components/HelpPage.jsx:111`): Sub-items are indented with a hard-coded paddingLeft 24px while their parent buttons use px-3 (12px) with a 12px chevron plus an 8px gap, so a sub-item's text edge lands at 24px and its parent's at 32px. The child is indented LESS than the parent it belongs to. → One indent system on the 4px scale: parent text at 12px gutter plus a 16px chevron column, child text at 32px, so the hierarchy reads as an indent rather than as a misalignment.

- Help content cards and prose (`src/components/HelpPage.jsx:162`): Sections alternate between space-y-5 wrappers, space-y-3 card groups, mb-4 paragraphs and ml-2 lists, so the vertical rhythm has four values that are not on one scale and the left text edge moves by 8px whenever a list appears. → One spacing scale (8, 16, 24) and one left edge for all prose. List indentation comes from the list marker column, not from a margin on the ul.

- Help bullet lists, every item (`src/components/HelpPage.jsx:172`): Literal bullet glyphs with no hanging indent mean every wrapped line begins under the bullet instead of under the text. At the current 190ch measure most items wrap. → Real list-disc markers with padding-left 20px so the marker sits in its own column.

- InviteMemberDialog field stack (`src/cloud/auth/InviteMemberDialog.jsx:246`): The hint sits 4px below its control and the next label sits 12px below that, a 3:1 ratio, and the hint is the same 11px size as the label so the two read as peers even though one belongs above the field and one below it. → 8px within the field group, 16px between groups, hint at the 12px Caption step sentence case, label at the 11px Label step uppercase. Same ratio the auth kit already argues for.

- Page title versus transition title (`src/App.jsx:2073`): The transition sets the page name at 16.8px with 0.3em tracking and hands off to a header that sets the same name at 20px with tracking-tight, so the word changes size, tracking and colour in the same 250ms fade-in. → Display step 34/+0.12em for the transition, H1 step 20/+0.01em sentence case for the header. The change between them becomes deliberate rather than accidental.


## Hick's Law hotspots

- Help sidebar with D.O.G. expanded (HelpPage.jsx:79-130 plus DOG_HELP_SIDEBAR_ITEMS): 18 visible choices → 4 tool headers plus 14 undifferentiated sub-items in a 200px column at 11px. Hide nothing and remove nothing: group the 14 into three labelled sets with an 11px Label eyebrow and a hairline above each, for example Getting started (Overview, Basic Workflow, Tips), Generating (Upload, Prompting, Editing, System Prompts, Output Format), Reference (Theme, Image Prompts, Asset Placement, Layouts, Settings, Slides Extension). Every item stays one click away and the list becomes three chunks of five rather than one of fourteen. O.T.T.E.R.'s 11 gets the same treatment.

- MfaEnrollGate (MfaSection.jsx:286-317): 6 visible choices → QR, copy-secret, code field, Activate MFA, Set up later, Sign out instead, with the last two rendered as identical peers. Keep all six reachable and re-rank them: one filled primary, then a single quiet line reading Set up later · Sign out instead at the 13px step. The screen goes from three co-equal exits to one action with two escapes.

- NewUserWelcome (NewUserWelcome.jsx:196-269): 6 visible choices → Four inputs, a file picker and a submit, where exactly one input is required and the word OPTIONAL is repeated three times. Do not hide the optional fields behind a disclosure, that changes the way of viewing. Instead mark the group once: a hairline and an 11px Optional eyebrow above pronouns, title and avatar, and drop the suffix from all three labels. One statement replaces three, and the required field stands alone above the rule.

- LoginScreen step 2 (LoginScreen.jsx:549-617): 5 visible choices → Username, password, Sign in, Change company, Forgot password. This is correctly scoped already and is the model the other screens should copy: one decision per step, two tertiary exits on one line. No change beyond the type.

- Help top-level tool list versus Home (HelpPage.jsx:6-11 against Home.jsx:22-46): 4 visible choices → Home offers six main items plus four or five resources; Help offers four sections, omits R.A.B.B.I.T. entirely and promotes Project Manager to tool rank. Mirror Home's grouping (Tools, then Resources, then Wilson) so the user's mental model survives the trip, and render the subtitle field that is already defined and discarded.


## Type inventory

| px | Weight | Case | Tracking | Where it is used | Collapses to |
|---|---|---|---|---|---|
| 24 | 600 | UPPER | 0.18em | AUTH_TITLE_STYLE, all four auth screens (AuthShell.jsx:412) | H1 20 / 600 / sentence |
| 20.5 | 600 | UPPER | 0.12em | AUTH_TEXT_STYLE default, inherited by every auth role (AuthShell.jsx:365) | deleted, the base carries no size |
| 17 | 400 | none | 0.02em | auth input value and password mask (AuthShell.jsx:425, 612) | Body 14 / 400 |
| 16 | 600 | Sentence | 0.04em | InviteMemberDialog title (InviteMemberDialog.jsx:264) | H2 16 / 600 / sentence, already correct |
| 15 | 400 or 700 | UPPER | 0.12em | workspace chooser rows (LoginScreen.jsx:665) | Body 14 / 400, selection by weight |
| 14 | 500 | Sentence | 0.04em | auth prose, four inline copies (ForgotPasswordWizard.jsx:178; ResetPasswordWizard.jsx:226, 244, 296) | Body 14 / 400 |
| 14 | 700 | UPPER | 0.1em | Home nav labels, UpdatePrompt title, the 43-copy settings h2 (Home.jsx:226; UpdatePrompt.jsx:68; MfaSection.jsx:366) | H2 16 / 600 / sentence |
| 13 | 400 | Sentence | 0 | ModelWarningBanner, InviteMemberDialog body and the non-admin refusal (ModelWarningBanner.jsx:43; InviteMemberDialog.jsx:129, 141) | Dense 13 / 400, already correct |
| 12 | 400 | Sentence | 0 | mono body on UpdatePrompt, MfaSection statuses, Help bodyText (UpdatePrompt.jsx:71; MfaSection.jsx:156; HelpPage.jsx:29) | Body 14 / 400, mono dropped |
| 12 | 700 | UPPER | 0.18em | AUTH_BUTTON_STYLE (AuthShell.jsx:490) | Button 14 / 600 / sentence |
| 12 | 600 | UPPER | 0.12em | InviteMemberDialog buttons, both variants (InviteMemberDialog.jsx:276) | Button 14 / 600 / sentence |
| 11 | 700 | UPPER | 0.22em | AUTH_LABEL_STYLE (AuthShell.jsx:418) | Label 11 / 600 / UPPER / +0.06em, the one surviving uppercase |
| 11 | 700 | Sentence | 0.12em | AUTH_ERROR_STYLE (AuthShell.jsx:546) | Dense 13 / 400 in the danger ink |
| 11 | 600 | UPPER | 0.1em | InviteMemberDialog Field label (InviteMemberDialog.jsx:248) | Label 11 / 600 |
| 11 | 400 | Sentence | 0 | Help list items, MfaSection hints, WorkspaceSwitcher slug (HelpPage.jsx:32; MfaSection.jsx:183; WorkspaceSwitcher.jsx:165) | Dense 13 / 400 |
| 10 | 600 | UPPER | 0.16em | AUTH_HINT_STYLE and AUTH_LINK_STYLE (AuthShell.jsx:525, 539) | Caption 12 / 400 and link at Dense 13 / 400 |
| 10 | 700 | UPPER | 0.18em | AUTH_BUTTON_QUIET_STYLE (AuthShell.jsx:507) | Button sm 14 / 600 / sentence |
| 10 | 400 | UPPER | 0.06em | MfaEnrollGate instruction paragraph (MfaSection.jsx:292) | Body 14 / 400 / sentence |
| 10 | 400 | Sentence | 0 | Help code token and version footer (HelpPage.jsx:35, 135) | Caption 12 / 400 mono for code, Label 11 for version |

**19 distinct type objects, 10 distinct sizes and 16 distinct tracking values across 12 files, collapsing to 6 of the 8 shared steps.** The surface uses no size the shared scale does not already generate, so nothing here needs a new step. 26 uppercase declarations survive as 1 role (Label) plus the transition Display. Weight 500 exists only in the four inline prose copies and disappears with them; weight 700 disappears entirely into 600.


## Priority order

AUTH-01, AUTH-02, AUTH-08, AUTH-04, AUTH-03, HELP-03, HELP-02, HELP-04, HELP-01, AUTH-05, AUTH-07, AUTH-06, AUTH-11, AUTH-09, AUTH-12, AUTH-14, AUTH-13, HOME-01, AUTH-15, HELP-05, HELP-06, AUTH-16, AUTH-17, AUTH-10, AUTH-20, HOME-02, AUTH-18, AUTH-19, AUTH-25, HELP-07, AUTH-21, AUTH-27, AUTH-24, AUTH-22, AUTH-23, AUTH-26, AUTH-28, HELP-08


## Rework scope (reviewer's estimate)

Files: `src/cloud/auth/AuthShell.jsx (686)`, `src/cloud/auth/LoginScreen.jsx (697)`, `src/cloud/auth/ForgotPasswordWizard.jsx (191)`, `src/cloud/auth/ResetPasswordWizard.jsx (313)`, `src/cloud/auth/MfaSection.jsx (425)`, `src/cloud/auth/InviteMemberDialog.jsx (287)`, `src/cloud/auth/WorkspaceSwitcher.jsx (190)`, `src/cloud/auth/authContrast.test.js (extend, do not weaken)`, `src/cloud/onboarding/NewUserWelcome.jsx (276)`, `src/admin/OperatorLogin.jsx (fifth auth surface, ~120 lines of its render)`, `src/components/HelpPage.jsx (403)`, `src/data/dogHelpContent.jsx (883, class retagging plus deleting the 23-rule override sheet)`, `src/data/otterHelpContent.jsx (395, token block only)`, `src/components/UpdatePrompt.jsx (146, deleted into Dialog)`, `src/components/ModelWarningBanner.jsx (69)`, `src/components/Home.jsx (312, two class strings and one colour)`, `src/App.jsx (transition title type at 2065-2077, content padding at 2100, banner mount at 1921)`, `src/index.css (one :focus-visible rule, reduced-motion timing table)`, `src/components/lightSurface.js (import site for Help, no change to the tokens)`  
Approx lines: 850  
Suggested sessions: 3  
Split: Session 1, the auth family, roughly 450 lines. Rewrite the AUTH_* kit onto the shared scale (AUTH-04), delete the Apple font stack (AUTH-02), add the global focus ring (AUTH-03), name the prose role and delete its four inline copies (AUTH-12), fix the gap scale (AUTH-09), sentence-case every message (AUTH-11), fix alignment (AUTH-10, AUTH-24), and extend authContrast.test.js rather than editing it. Resolve AUTH-08 with Audrey BEFORE this session opens, because the button token is the first thing it touches. Do the five consumers in one pass so they cannot drift again, OperatorLogin included. Session 2, Help, roughly 300 lines but mechanical. Hoist one help token module, delete LIGHT_THEME_STYLES and retag dogHelpContent to the L/D pair otterHelpContent already uses, cap the measure, fix the sidebar ink and the indent system, replace the white card, fix the bullets. This session touches the 883-line file, so count the comment markers after every edit. Session 3, the shared surfaces, roughly 200 lines, and it must come AFTER src/ui/Dialog, Button and SectionTitle exist. Delete UpdatePrompt and InviteMemberDialog into Dialog, fix the banner, point WorkspaceSwitcher and MfaSecuritySection at SectionTitle, apply Home's two type changes and the transition title. If the kit does not exist yet, do not restyle these in place: that is two passes over the same code.  
Risks: 1. authContrast.test.js pins AUTH_BUTTON_STYLE.border === 'none', the fill being different from and darker than #ea580c, and the quiet button differing from the primary. Unifying on one signal fails three assertions in a test that correctly encodes Audrey's verbatim instructions. Get the ruling first; never quietly edit the assertions. 2. AuthPasswordInput's caret alignment is measured to 0.00px drift and depends on ch resolving identically on the wrapper and the input, which in turn depends on font-family AND font-size matching. Changing the input from 17px to 14px and the face from the system stack to Geist re-opens it, and nothing in the repo can test a caret position. Re-measure in the running app. 3. SPLIT_BAR_HEIGHT (24vh) was derived from a 330px measurement of LoginScreen step 2 and NewUserWelcome already overflows at the 700px minimum. Every type change moves that number. Re-derive from measurement, as the file's own comment demands, and do not add a second set of bars. 4. pageBars.js pins min(cap, max(floor, ...)) in that order with a test; leave the geometry alone. 5. The StrictMode empty-cleanup pattern in AuthShell (three effects) and MfaEnrollGate's reveal fallback are deliberate and fragile. A motion or timing edit must not add clearTimeout to those cleanups: the documented failure is the shell sticking on the logo forever. 6. dogHelpContent's override sheet also feeds the in-tool DARK help modal through the same component, so deleting it must not un-style the dark path. 7. All pages render simultaneously with display:none, so visual verification requires toggling each page, not one screenshot. 8. State is hidden in inline styles that a class-based component will not inherit: the press transform written directly to the DOM node (LoginScreen.jsx:489), busy as opacity 0.55 in four files, and disabled expressed only as cursor plus opacity. 9. The 883-line dogHelpContent edit is exactly the shape of the S30 incident where a comment marker silently deleted 227 lines. 10. Two of these files are the first screen a user ever sees and the gate every admin passes at every sign-in; a regression here is not a cosmetic regression, it is a lockout.
