# 88 — NIGHT 7

One file for the night (`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one
section per session: **D3** (the spare lock on the sign-in bridge, and links
in answers on the web). Each section stands on its own; answer its questions
by their numbers.

## D3 — The sign-in bridge answers WILSON's page only; an answer's link opens a new tab on the web

Your rulings of 2026-10-29 on walkthrough 87: *"Q2. b"*, the spare lock
before 1.0, as one more session; and *"Q1. a"*, the migration report keeps
listing the clips left behind by name (nothing to change for that). Measured
first, designed, the design reviewed on Fable (nothing in it needed you),
built, then reviewed twice more on Fable: the first review found that the
bridge still handed over one thing without checking (where a file you drop
lives on your computer), the second that a link in an answer pointing back
into WILSON itself would reload WILSON; both were fixed before anything
merged.

1. **A second lock on the sign-in bridge.** On the desktop, WILSON's page
   gets your saved sign-in and the key to WILSON's own local server through a
   bridge. Since night 6 the window only ever shows WILSON's page, so nothing
   else could reach that bridge. Now the bridge also checks who is asking,
   every time, and answers only WILSON's own page. If a future mistake ever
   let another page into the window (or into a second window, or into a
   frame inside the page), that page would get nothing: no sign-in, no key,
   no files, no settings. Tested by putting another page there on purpose:
   before the fix it was handed your sign-in and the key; after it, nothing.
2. **On the web, a link in an answer opens a new tab.** When the pet or an
   O.T.T.E.R. lesson gives you a link to a website and you click it, the site
   opens in a new tab and WILSON stays where it was, with anything you had
   not saved. Before, the site replaced WILSON in the same tab. An email
   address in an answer still opens your mail app. A link in an answer that
   points back into WILSON itself is now shown as plain text: clicking it
   used to reload WILSON, losing anything you had not saved.

### What to do

1. **On the desktop: nothing changes for you.** Use WILSON as usual: sign in,
   open a project, print an estimate, open a receipt, download a cloud file,
   zoom in and out. Everything works as before. A link in a pet or O.T.T.E.R.
   answer still opens in your own browser.
2. **On the beta, in a browser:** ask the pet something whose answer has a
   website link (for example *"link me to the Electron website"*), or open an
   O.T.T.E.R. lesson that has one, and click the link. **It opens in a new
   tab, and WILSON's tab stays as it was.** Click an email address in an
   answer: your mail app opens, as before.

### How it was checked

The desktop app was driven off-screen with a scratch folder and a made-up
sign-in (nothing signed in anywhere). To stand in for a future mistake,
another page was put into WILSON's window on purpose, a second window was
given the bridge, and, in a test copy of the app, a frame inside the page was
given it too. Before the fix each of them was handed your saved sign-in, the
local key and every answer; after it, nothing (not even where a file
dropped on it lives), and each refusal is written in the app's own log by
its kind only, never an address. The run also found one
more asker: for half a second at every start, before WILSON's page appears,
the window holds an empty page that asked for the key too, and was given it.
It is refused now as well, and WILSON's page still gets everything: its
sign-in, its key, its settings, a cloud download. The print and receipt
windows behave as before. On the web, the pet's and an O.T.T.E.R. lesson's
links were clicked in a test browser: before, the site replaced WILSON's tab;
after, it opened in a new tab and WILSON stayed, and a link back into WILSON
was plain text. The tests: 427 files, 10,881 passing; every new test was
shown to fail on purpose against a broken copy of the code, 39 times.

### What is left as it is

- **Sentry's own error-report channel** (OUTSTANDING D3-01). If the
  installed app is ever given a Sentry key for error reports, Sentry adds
  its own small channel to every WILSON window, which accepts error reports
  from any page. It hands nothing back (no sign-in, no key, no file), and
  the builds tested here have no Sentry key. Left for the controller.

### Questions

None for this section: nothing in it needed your ruling.
