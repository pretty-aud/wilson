# 73 — ONE CONNECTION DOT, IN THE CORNER (R.A.B.B.I.T.)

1. **The project bar has one green mark left: the project's status.**
   On every tab but Summary, the bar under the tabs reads, left to right:
   PROJECT, the project's name, its status (ACTIVE, DRAFT …); then, on the
   right, the faces of who else has the project open, then **Switch**. The
   LIVE pill and the second green dot are gone. On Summary (no project bar)
   the faces sit at the right end of the tab row, before Help and Settings,
   as before, without the pill and the dot.
2. **The connection is one dot in the bottom-left corner of every
   R.A.B.B.I.T. tab, just above the orange bar.** Same place on every tab,
   Summary and the project gallery included. It sits in a small square of
   its own (a shade lighter, a thin line on its top and right): without
   it, at the foot of a table the dot lined up with the last row and read
   as that row's green bullet.
   - **Green:** the WILSON database answers **and** the place your
     company's files are kept answers.
   - **Amber:** the database answers but the files' storage does not:
     files cannot be opened or saved until it does.
   - **Red:** offline: the database does not answer (or, in the desktop
     app's Local Server mode, the Local Server does not).
   - **Grey:** for the first second or two, while it asks ("checking").
3. **Point at the dot to read each part in words**, for example:
   *Database: connected · Files: Petal cloud, connected · Live updates: on*.
   "Live updates" (what the LIVE pill used to say) is the third part
   whenever a project is open. A screen reader reads the same words, and
   hears one short sentence when the colour changes ("The files are not
   answering (Petal cloud); the database is connected.").
4. **"Files" means where your company keeps its files** (your answer:
   "Where your files are kept"):
   - **Petal cloud:** the dot lists one file of the cloud's files store;
   - **your company's own bucket:** it asks the bucket about one file of
     the open project (or of your first project), through WILSON's
     signing service, as opening a file does;
   - **your company's server or NAS:** the desktop app checks the folder;
     a browser cannot reach a NAS at all, so in a browser the dot is amber
     and says *not reachable from a browser*;
   - **the Local Server:** the desktop app checks its own data folder
     (the database) and the folder project files go to (the open demo
     folder, your company's NAS, or this computer).
   The Bins tab keeps its own words for each footage share, as before.
5. **It asks again every minute while R.A.B.B.I.T. is on screen**, at once
   when the computer comes back online, when you sign in, and when you open
   another project. Each question gives up after 6 seconds (the dot then
   says *not answering*), and nothing waits on it: the page never stops
   for the dot. It does not ask while another page is on screen.
6. **The Bins tab: the counter moved up.** "18 files in 7 bins" and the
   drop hint under it sit 24px higher at the foot of the bins list, so the
   dot sits clear beneath them. Nothing else on the tab moved.
7. **The Dashboard: the Live badge is gone**; the faces of who is online
   stay at the right of its tab row.

**What this is.** FX11, from your words of 2026-10-16: "the project bar has
three green dots and its confusing. remove the live and additional green
dot. just leave the icons that appear for users" and "move the live dot to
the bottom left corner of the window right above the orange bar … this
green dot should clarify that the system is connected to the storage
solution not just the databases on supabase", with your five answers the
same day. **Before**, the dot on the project bar checked only the database,
once (when the app started, when you signed in, when you switched backend),
and never again: it stayed green when the network went, and nothing checked
the files' storage at all. Client and desktop app only; no database change.

## Try it

You need the app on the dev fixtures (the test data: Salt Hours), or your
own account. On the fixtures, add `?connection=files-down` or
`?connection=offline` to the address to see amber and red (the fixtures
only: there is no real database or storage behind them).

1. Open R.A.B.B.I.T. on the project gallery: the dot is in the bottom-left
   corner, just above the orange bar. Point at it: *Database: connected ·
   Files: Petal cloud, connected*.
2. Open Salt Hours. On Summary, the faces at the right of the tab row, no
   LIVE, no second dot. Point at the corner dot: the words now end
   *Live updates: on*.
3. Go to Tasks, Timeline, Budget, Assets, Scenes, Files, Team: the project
   bar reads PROJECT · Salt Hours · ACTIVE on the left, the faces then
   Switch on the right; the dot is in the same corner on every tab.
4. Go to Bins: the counter ("18 files in 7 bins") and the hint sit above
   the dot, not beside it.
5. Reload with `?connection=files-down`: the dot is amber, and pointing at
   it says *Files: Petal cloud, not answering*. Reload with
   `?connection=offline`: red, *Database: not answering*.
6. With your own account: take the computer off the network (Wi-Fi off).
   The dot turns red at once and says *no network*; turn it back on and
   within a few seconds it is green again.
7. Open the Dashboard: no Live badge by the faces.

## Questions

None. All five of your answers are built as given.

## Known limits

- In a browser, a company that keeps its files on its own server or NAS
  always shows amber ("not reachable from a browser"): that is true, a
  browser cannot reach a NAS, but it is a standing amber, not a fault.
- A company with its own bucket and no project yet: the dot has no file to
  ask the bucket about and says *checked once there is a project* (grey).
- While an intake runs, its progress box (bottom-left) floats over the dot.
- A private project's files live on the computer that added them; the dot
  speaks for where the company keeps its files, not for one project.
