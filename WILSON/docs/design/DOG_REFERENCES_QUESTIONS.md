# D.O.G. references (DG1) — the questions before the design (2026-10-16)

Your words of 2026-10-16 (in `docs/sessions/briefs/po-dg1-dog-references.md`):
choose R.A.B.B.I.T. items, files and your personal notes for the deck outline,
"pull from files, from databases, and from notes", keep uploads as they are, and
make the Full deck and Single page interfaces one. The research is
`docs/design/DOG_REFERENCES_RESEARCH.md` (how NotebookLM, Notion AI, Gamma, Canva
and Copilot do it; D.O.G. today, measured; the gap; the pictures).

Below is every decision the design would otherwise make for you, in plain words,
each with two to four choices and the one I would pick first, marked
*(Recommended)*, with the reason. They are asked in this session's chat, four at a
time; your answers are written in under each batch, word for word, as they come.
Nothing is designed or built until they are in.

**Already settled by your words, so not asked:**

- References can be R.A.B.B.I.T. items, files and your Dashboard notes.
- Uploading stays exactly as it is: the same button, the same file kinds, the same
  20-file count, kept only while D.O.G. is open.
- Full deck and Single page become one card with one switch: *Single page* on one
  side, *Full deck* on the other, instead of a grey switch with one label.
- Full deck shows the full deck box and the theme generator. Single page shows the
  page number, the layout dropdown and the single page box. The two media boxes
  show in both.
- The examples inside each box and the instruction line above each box stay.
- *Use uploaded assets* becomes *Use visual assets*, with the line "to place media
  in the deck".
- A deck can be generated from references alone (three scenes and a note, say),
  since you asked D.O.G. to pull from databases and notes. Today it needs a file.

**The UX laws behind the picks** (the `laws-of-ux` and `design-direction` skills,
loaded for this list): *Jakob's law* (people know NotebookLM's ticked sources list
and WILSON's own "Add an item" picker), *Hick's law* and *choice overload* (kinds
grouped, one search, sensible defaults), *working memory* (see what will be sent
beside the choosing, not in another place), *Tesler's law* (D.O.G. carries the
size arithmetic; the person sees a meter), and *Occam's razor* (nothing that needs
a database change unless an answer asks for one).

---

## Batch 1 — what can be chosen, and what of it goes to the AI

**Q1. Besides files and your notes, which R.A.B.B.I.T. things can be chosen?**
(tick all that apply)

- **Assets, scenes, shots, levels and experiences** *(Recommended)*: each one's
  name, status, description and notes.
- **Tasks** *(Recommended)*: title, status, dates, description and notes; useful
  for a progress or schedule deck.
- **Bin clips**: a clip's poster picture from the Bins, to show or place.
- **Phases and milestones**: the Timeline's, with their dates, for a schedule
  slide.

*Why:* your "assets, scenes, shots, levels, etc" names the production items;
tasks carry the status and dates a progress deck is about. Bin clips and the
Timeline's phases are possible but each adds a group to every search (Hick's law);
easy to add later.

**Q2. Today choosing a project quietly sends up to 20 of its files to the AI. With
references, what should choosing a project do?**

- **Pre-tick today's files** *(Recommended)*: the files D.O.G. takes today start
  ticked in the references card; untick any, add more. Nothing is downloaded
  until you generate.
- **Send nothing automatically**: only the project's title and description go;
  every file is chosen by hand.
- **Keep today's automatic set**: those files keep going on their own, and what you
  choose is added on top.

*Why:* a sensible default (choice overload) that keeps today's decks coming out
the same, made visible and undoable. Today every one of those files is downloaded
the moment a project is chosen, and on the cloud each download is recorded in the
file's activity; pre-ticking moves the reading to the moment you generate.

**Q3. When you choose an item, a scene for example, what of it goes to the AI?**

- **Its words; its files to tick** *(Recommended)*: name, status, description and
  notes. Its files are listed under it and you tick the ones you want.
- **Its words and all its files**: every document and picture filed under it.
- **Its words and its documents**: documents' text, not pictures.

*Why:* a scene's words cost about as much as a sentence or two; one PDF page costs
1,500 to 3,000 tokens and one photograph up to about 4,800. Taking everything
filed under a scene is how a deck fills with production frames (what C3's review
found); the person should see each file go in.

**Q4. Should you be able to read exactly what D.O.G. will send before you
generate?**

- **Preview each reference** *(Recommended)*: clicking one shows the words that
  will be sent for it, and its size.
- **Names only**: the card lists names, no preview.
- **One combined preview**: a single "what D.O.G. will read" window with
  everything together.

*Why:* NotebookLM's source guide is the research's best idea for trust; a preview
also shows that a private note is going exactly where you meant it to (working
memory: the answer beside the choice).

### Her answers, batch 1 (2026-10-16; asked in chat as multiple choice; recorded verbatim)

- **Q1:** "Production items (Recommended),Tasks (Recommended),Phases and milestones"
- **Q2** (typed): "choosing the project should select what files and items he user can choose from to make a deck. for this interface, allow the user to collapse the view for selecting items for the deck. this if the user just needs to use uploaded files and the prompt and no project selected.

  allow for a way to select all core files or files from today or a range of dates."
- **Q3:** "Its words; files to tick (Recommended)"
- **Q4** (typed): "name only but give the user option to preview references"

### What follows from batch 1 (say if any is wrong)

1. **Offered:** assets, scenes, shots, levels and experiences; tasks; the
   Timeline's phases and milestones; files; your notes. **Not offered:** Bin clips.
2. **Choosing a project sets what can be chosen; it sends nothing on its own.**
   No file goes to the AI unless it is ticked, and nothing is downloaded until you
   generate. (Today's twenty files are no longer sent automatically.)
3. **The references card folds away**, for a deck made from uploads and the
   prompt alone, with no project chosen.
4. **Quick ways to choose many files:** all Core files at once; the files from
   today; the files from a range of dates.
5. **An item sends its words** (name, status, description, notes); its files are
   listed under it to tick one by one.
6. **The card shows names only; each reference can be previewed** on demand, to
   read exactly what will be sent for it.
7. **Q16 (one project or two) is answered by Q2:** the chosen project sets what can
   be chosen, so a deck draws on one project. Your notes are yours, not a
   project's (batch 2 asks about notes with no project chosen).
8. **Two new questions** came out of these answers and are added below: whether
   the project's own title and description still go once a project is chosen
   (Q17, batch 4), and which date the date tools use (Q18, batch 3).

---

## Batch 2 — notes, privacy, the Local Server, the limit

**Q5. Your Dashboard notes are private: nobody else can read them, not even an
admin. Which notes can be chosen?**

- **Any of your own notes** *(Recommended)*: all of them, searchable by title and
  subject, with or without a project chosen. Nothing changes about who can read
  them.
- **Your notes tied to this project**: adds a *Project* field to each note (a
  small database change); D.O.G. offers only the chosen project's.
- **Yours and shared ones**: adds sharing to notes so a teammate can share one
  with you; a new feature, bigger than this work.

*Why:* notes belong to no project today; a field to tie them to one is a new
habit for every note. Any of your own is the plain reading of "personal notes a
person makes".

**Q6. Admins and managers can open Legal files (contracts) and money files
(invoices). Today D.O.G. never takes either, because a deck reaches everyone on
the project. Keep that?**

- **Never offer them** *(Recommended)*: they never appear in D.O.G.'s picker, for
  anyone.
- **Offer to who can open them**: they appear for admins and managers, with a
  warning that the deck may reach people who cannot open them.

*Why:* a deck is shared work; a contract's terms on a slide reach every member.

**Q7. On the Local Server (the desktop app without the cloud's database) notes do
not exist. What should the picker do there?**

- **Items and files; notes say why** *(Recommended)*: items and files work as on
  the cloud; the Notes group says notes need the cloud.
- **Hide notes there**: the Notes group does not appear.
- **No references there**: the references card is hidden; projects work as
  today.

*Why:* the same screen on both, with the missing part explained rather than
vanishing. (Signed out entirely, D.O.G. cannot generate at all today, since the
AI needs your sign-in; that does not change.)

**Q8. How much can be chosen? A real deck in August sent about 230,000 tokens
(roughly 170,000 words) and worked. What happens when the chosen set gets too
big?**

- **Meter, then stop** *(Recommended)*: a bar shows how full the set is; at the
  limit nothing more can be added until something is removed, and it says so.
- **Meter, then warn**: the bar turns amber past the limit and you can still
  generate; it may be slow, cost more, or fail.
- **A simple count**: at most a fixed number of references, like today's 20
  files.

*Why:* the research's clearest lesson is to fail loudly when choosing, never
quietly when generating; a count says nothing about size (one PDF can outweigh
fifty scenes).

### Her answers, batch 2 (2026-10-16; asked in chat as multiple choice; recorded verbatim)

- **Q5:** "Any of your own notes (Recommended)"
- **Q6:** "Never offer them (Recommended)"
- **Q7:** "Notes say why (Recommended)"
- **Q8:** "Meter, then warn"

### What follows from batch 2 (say if any is wrong)

1. **Notes:** any of your own, with or without a project chosen. Who can read a
   note does not change, and no database change is needed.
2. **Legal and money files never appear in D.O.G.'s picker**, for anyone, as
   today.
3. **On the Local Server** items and files work as on the cloud; the Notes group
   stays and says that notes need the cloud.
4. **The limit warns rather than stops.** A meter shows how full the chosen set
   is; past the limit it turns amber, says the deck may be slow, cost more or
   fail, and Generate still works. Where the limit sits is set in the design,
   from the measured 232,275-token deck that worked.

---

## Batch 3 — the card and the picker

**Q9. Where does the references card sit?**

- **Its own card** *(Recommended)*: a new card between the project and uploads
  card and the deck card: what the AI reads, then what you ask for.
- **Inside the project card**: under the project dropdown, beside the uploads.
- **A panel on the right**: a column down D.O.G.'s right side, always open.

*Why:* your words call it a new card; the order reads top to bottom as the work
goes (sources, then the request, then the result).

**Q10. When you click to add references, what opens?**

- **A window with ticks** *(Recommended)*: one search at the top, Items, Files and
  Notes down the left, tick boxes to choose many, your quick choices (all Core
  files, today's, a range of dates) above the files, and a Preview on each row.
- **A side panel**: slides in from the right with the same ticked list, narrower.
- **A list like the task window's**: like "Add an item", one click adds one, inside
  the card.

*Why:* choosing many, with the quick choices and a preview, needs room; a window is
the shape everyone knows from file dialogs (Jakob's law), and closing it puts you
back at the card, which lists names only (your Q4).

**Q11. In the Files tab, files live in folders (a shot's folder inside its
scene's). Can a whole folder be chosen at once?**

- **Yes, a folder's tick** *(Recommended)*: ticking a folder chooses everything in
  it that D.O.G. can read; untick any file after.
- **Files one by one**: folders only open; each file is ticked by itself.

*Why:* "the scene's folder" is how people think of a scene's material; the meter
keeps a big folder honest.

**Q18. Your quick choices pick files "from today or a range of dates". Which
date, and for what?**

- **The day a file was added; notes by their date** *(Recommended)*: files by
  the day they were uploaded, your notes by the date each note carries.
- **Files only, by the day added**: the date tools are for files; notes and items
  have none.
- **The day anything last changed**: files, notes and items by their last edit.

*Why:* "from today" most often means "what I just added"; a note already carries
its own date, which is how the Notes page sorts and groups.

### Her answers, batch 3

*(not yet asked)*

---

## Batch 4 — the one Full deck / Single page card

**Q13. In Single page, the full deck box and the theme generator are out of sight.
Today both shape single pages too. Should they still?**

- **Both still apply** *(Recommended)*: what you wrote for the full deck still
  guides each page, and the theme setting still picks the colours; a line under
  the page box says so.
- **Neither applies**: single pages use only the single page box and the preset
  colours.
- **The words yes, the theme no**: the full deck text still guides pages; colours
  come from the presets unless you refresh them.

*Why:* single pages made today keep coming out the same, and the line keeps the
hidden part visible.

**Q14. The other box, *Use project assets*, places the project's pictures and
videos into the slides today. What should it do now?**

- **Media among references** *(Recommended)*: keep the name; it places the
  pictures and videos among your chosen references.
- **All project media**: keep the name and today's behaviour, every picture and
  video D.O.G. takes from the project.
- **Rename it**: *Use reference media*, placing the pictures and videos among
  your references.

*Why:* once you choose what the deck reads, it should place what you chose, not
something else.

**Q15. Files keep their Core / Ref mark (your "select all core files"): Core
defines the project, Ref is background, and the AI is told which is which. Do
items and notes get the mark too?**

- **Items and notes too** *(Recommended)*: each chosen item and note gets the same
  Core / Ref mark, for this deck. A file's mark is still saved on the file, as
  today.
- **Files only**: items and notes go without a mark.

*Why:* a treatment note can define a project as much as a brief PDF; one mark that
looks and works the same everywhere (law of similarity).

**Q17. Once a project is chosen, does its own title and description still go to
the AI, as today?**

- **Yes, always** *(Recommended)*: one short paragraph that tells the AI what the
  project is, whatever else is ticked.
- **Only when ticked**: the project appears as its own row at the top of the
  references, ticked or not like any other.

*Why:* a few dozen words that ground every slide, and today's decks already rely
on them.

### Her answers, batch 4

*(not yet asked)*

---

## Batch 5 — remembering

**Q12. D.O.G. keeps its pages and uploads while WILSON is open and loses them when
it closes. Should the chosen references be remembered longer?**

- **Same as uploads** *(Recommended)*: kept while WILSON is open, gone when it
  closes. Nothing about your private notes is written to this computer.
- **Per project, this computer**: reopening D.O.G. on the same project brings the
  same references back, on this computer only.
- **Per project, everywhere**: saved with your account for each project (a small
  database change).

*Why:* the deck itself is not remembered either, and a list of your notes' titles
left on a shared computer is a small leak of something private.

### Her answers, batch 5

*(not yet asked)*

---

## Not proposed (say if you want them)

- **A "use this for…" line on each reference**, as Microsoft advises for Copilot.
  The deck box already carries your instructions.
- **Which reference fed which slide**, as a mark on each page. Useful, and a
  change to the export format, which stays as it is.
