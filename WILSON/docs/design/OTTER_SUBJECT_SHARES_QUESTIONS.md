# O.T.T.E.R. subject shares (N2) — the questions before the build (2026-10-27)

Your three rulings of 2026-08-12 decide most of this, and the design
(`docs/design/OTTER_SUBJECT_SHARES_DESIGN.md`) follows them:

> **"LIVE LINK. ACCEPT FIRST."**
>
> *"so if the receiver doesnt have the course in their library of the subject.
> you would add the new course and then place the subject in there. if the user
> already has that software/ language course, you add the new subject shared to
> that course."*
>
> *"each user should have their own progression of subjects. dont make it a
> universal one"*

Below are the four things neither those rulings nor the code decide. Each has
two to four choices in plain words and the one I would pick first, marked
*(Recommended)*, with the reason. One batch; an answer block to copy is at the
end: change any line, paste it back, and B1 and B2 are built from it. Ask about
any one and I will explain it on its own, in plain words.

**Already settled by your rulings or by the code, so not asked:**

- A share is one subject, to one person, in the same company. It waits until
  they accept. They read your subject live and can never edit it. It stops if
  you trash the subject, ends if you withdraw it, and goes when the subject is
  purged.
- Where it lands for them: inside their own copy of that course if they have
  one, matched by the course's identifier (never by its typed name); otherwise
  a new personal course of the same name is made for them, holding the link and
  nothing else.
- Their ticks, their quiz scores and their validator findings are theirs: kept
  on their own course, never shown to you, and kept if you withdraw the share.
- Only an active member of the same company can receive, admins and managers
  included (they get exactly what anyone gets: the one subject); nobody outside
  the company, ever.
- Admins never see a share's row or the subject; they see one audit line per
  share, accept, decline and withdrawal, naming who and which ids, never a title.

---

## Batch 1 — who shares, where it lands, who can end it, what happens when someone leaves

**S1. May anyone other than you share a subject from your course?**

- **No. Only the owner of a course shares its subjects.** *(Recommended)* An
  admin who can already read a shared or company-standard course still cannot
  offer its subjects on the owner's behalf, and someone you gave edit access to
  cannot either.
- **Also an admin, for shared and company-standard courses only.** Never from a
  personal course (an admin cannot read one).
- **Also the people you gave edit access to.** They can change the content, so
  they may also offer a piece of it.

*Why:* every consent in O.T.T.E.R. today belongs to the owner alone: a change
request opens only the proposer's own course, a nomination only the nominator's.
Sharing a subject is a consent of the same kind, and the simplest rule is the
one already in force. An admin who wants a subject spread wider has the company
standard for that.

**S2. Someone receiving your subject has the same software under another
version (they have "Blender 4.2", you share from "Blender 5.0"). Where does it
land?**

- **In a new "Blender 5.0" course of theirs.** *(Recommended)* A different
  version is a different course, exactly as if they had none. If they also have
  a "Blender 5.0", it goes into that one.
- **They choose at accept.** The matching course is offered first; they can pick
  any course of theirs instead, or a new one.
- **In their "Blender 4.2", matching the software's name and ignoring the
  version.**

*Why:* your ruling places the subject in "that software/language course"; a
course's identifier is fixed when it is made and the only thing two people can
be sure to have in common. Letting them choose adds a picker and a second server
check; matching by name minus version would guess wrong on names that are not
"Software N.N".

**S3. Once they have accepted, can the receiver remove the linked subject from
their course themselves?**

- **Yes.** *(Recommended)* "Remove from my course" ends the link the same way
  your withdrawal does; their ticks are kept and come back if you share it
  again into the same course; your list shows "they removed it".
- **No. Only you can end a share.** They can only decline before accepting. One
  consequence to know: if they delete the course the subject sits in, the link
  stays "accepted" with nowhere to show until you withdraw it, and you cannot
  share that subject with them again until you do.

*Why:* it is their course, and a subject they no longer want in it should not
need a message to you. Nothing of yours is affected either way.

**S4. When the person who shared a subject leaves the company (their account is
deactivated), what happens to the links they made?**

- **They stay live.** *(Recommended)* The colleagues who accepted keep reading
  the subject, as a course shared with the company stays readable after its
  owner leaves. The cost: the person who left can no longer withdraw it, so only
  the receiver can end it, or an admin by moving the whole course to the trash.
- **They pause.** While the account is deactivated the receivers see nothing;
  if the person is reactivated the links come back on their own. Nothing is
  deleted.
- **They end for good.** Deactivating the account withdraws every share they
  made, as if they had done it themselves.

*Why:* a personal course is private even from admins, so when someone leaves,
the links they gave are often the only way their work stays useful to the
people they gave it to. "Pause" is the cautious middle; "end" is the strictest
reading of consent.

### Your answers, batch 1

Answered 2026-10-27 in chat, as multiple choice asked by the controller (each
question's options as above, the recommended one first and marked). Her four
answers, verbatim as clicked:

- **S1:** "Only the owner (Recommended)"
- **S2:** "A new course, same name (Recommended)"
- **S3:** "Yes, they can remove it (Recommended)"
- **S4:** "They stay live (Recommended)"

All four are the recommended options, the first of each question above. B1
(night 2) builds from them as the design's §6.1 says.

---

## Things I decided without asking (say if any is wrong)

- **A declined share is a record** you can see ("Declined", with the date), as
  a declined change request or nomination is. The row keeps your note and the
  subject's title and course name as they were when you offered it, never what
  they are called now; the share never opened anything to them.
- **Several colleagues at once:** you tick the people and each gets their own
  offer, to accept or decline on their own; you can withdraw any one of them.
  The server is the same either way: one row per person.
- **An outline (a subject you have not generated yet) can be shared.** The
  receiver sees "Outline only" until you write it, and then the content, live.
- **When the receiver leaves the company**, they read nothing until they are
  back; the link itself is untouched. (What happens when the sharer leaves is
  S4, above.)
- **A subject in the trash reads "No longer available"** on the receiver's
  side until you restore it (the link comes back on its own) or it is purged
  after 30 days (the share goes with it).
- **Pending shares appear in the Requests tab**, with a count on the tab, not
  as a banner on the library: a banner on every open until you answer would nag,
  and Requests is already where the things waiting on you live.
- **Sharing starts from the course's menu** ("Share a subject…", beside "Share
  or submit…") and from the subject's own page; not from the small subject rows
  in the sidebar, which already hold a name and a delete control.
- **No email, no live arrival:** O.T.T.E.R. is on no realtime channel, so the
  receiver sees the offer when they next open O.T.T.E.R. (the count on the tab).
- **The new course made for a receiver is empty but for the link**: no hotkeys,
  functions or nodes are copied from yours (that would be a copy, which you
  ruled out). They can fill or rename it as any course of theirs.
- **If a receiver's matching course is in their trash**, a new one is made and
  the old one collides on the name if they later restore it (the existing
  message says to rename first).
- **Admins get audit lines** (who shared which subject id with whom, when; who
  accepted, declined or withdrew), never a title: the same line the course index
  draws today, where an admin sees that a personal course exists and not what is
  in it.
- **Not in 1.0**, each with its reason in the design's §7: sharing a whole
  course to one person, sharing outside the company, a share that copies, the
  receiver sharing it onward, expiry or a cooldown, and you seeing their
  progress.

---

## The answer block to copy

```
s1 only the owner of a course shares its subjects.
s2 same identifier only: a different version is a different course, so it lands in a new course of my course's name.
s3 yes, the receiver can remove a linked subject from their course; my list says they removed it.
s4 the links stay live when the sharer leaves; the receiver or an admin can end them.
decided-without-asking all good
```
