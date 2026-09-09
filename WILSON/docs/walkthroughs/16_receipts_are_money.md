# Walkthrough 16 — an expense receipt is money

**Track C, bundle C4.** Four parts, plus one read-only check at the end. The
whole bundle is one sentence: **a receipt you attach to an expense should be
as private as the expense itself.** Until now it was not — the expense was
manager-only and the receipt photo sitting on it was readable by every member
of the project. Parts A–C are the beta (cloud); Part D is the desktop.

Each part is independent. Do them in any order and report the ☐ lines.

**What you need:**

- a project you can open in **Projects**, in a company you are an **admin**
  of — admins pass the money gate, so you play the manager;
- **a second person on that project who is NOT a manager** — an ordinary
  member. If you do not have one, add a throwaway member to the project with
  project role **member** (not manager). This is the whole test: without a
  non-manager there is nobody for the gate to keep out;
- **one small image or PDF** to stand in for a receipt — call it
  `cab_receipt.jpg` so you can spot it;
- for Part D, the desktop app in **Local Server** mode with a **project folder
  configured** (Settings → General). Without one the desktop has nowhere
  special to put an invoice and falls back to the ordinary files directory —
  that is deliberate, so a receipt is never written somewhere unreachable, but
  it does mean Part D needs the folder set to show anything.

**Where things are:** expenses are **Projects → open a project → Budget →
Expenses**; the receipt picker is inside the expense's own form. The Files
grid is **Projects → open a project → Files**.

⚠️ **Where to run it.** Dev's database carries migration 0076; the app side is
on the `track-c-storage` branch and reaches the beta only with the merge that
follows your report. So run it from the branch: in `WILSON/`,
`git checkout track-c-storage`, `npm install`, `npm run dev`, and sign in as
usual (your `.env.local` decides whether that is dev or staging). **Staging
does not have 0076 yet** — the exact command for that is in this bundle's
hand-off and needs your say-so — so if your `.env.local` points at staging,
Parts A–C still test the client fix correctly but the "existing receipts" half
is not there. Nothing in this walkthrough destroys anything.

---

## Part A — you can still work with your own receipts

What changed: nothing you should notice. This part exists so that the parts
after it mean something — if a receipt stopped working for the person who
uploaded it, that would be a worse bug than the one being fixed.

1. Open a project → **Budget** → **Expenses** → add an expense. Give it a
   title and an actual cost.
2. In the expense form, attach `cab_receipt.jpg`.
3. Save the expense.

☐ **A1.** The upload finished without an error and the file is listed on the
expense.

4. Re-open the same expense for editing.

☐ **A2.** The receipt is still listed, by name.

5. Go to **Files** for that project.

☐ **A3.** You can see `cab_receipt.jpg` there, and you can download it.

> If A1 or A3 fails, stop and report it — that is the fix having broken the
> normal case, which matters more than the rest of this walkthrough.

---

## Part B — the point of the bundle

Sign out and sign back in **as the ordinary member** (the non-manager on this
project).

1. Open the same project.

☐ **B1.** **Budget** is not usable to them — they cannot read the expense.
(This was already true before this bundle. Note what they actually see: a
hidden tab, an empty budget, or an error.)

2. Go to **Files** for that project.

☐ **B2.** 🚨 **`cab_receipt.jpg` is NOT in the list.** This is the line that
matters. Before this bundle it was, and anyone on the project could open it.

3. If there are other, ordinary files on the project, look at them.

☐ **B3.** The member can still see the ordinary project files. (The gate
should hide the receipt and nothing else — if Files is now empty for them,
that is a different and worse bug.)

4. Open the activity/history for the project's files if your build shows it.

☐ **B4.** There is no trace of `cab_receipt.jpg` — no "uploaded", no name,
no size.

---

## Part C — it does not leak into a deck

Still as the ordinary member, or back as yourself; either is fine.

1. Open the project's **Resources** list.

☐ **C1.** `cab_receipt.jpg` is not there.

2. Open **D.O.G.**, pick this project, and look at the **File roles** list.

☐ **C2.** `cab_receipt.jpg` is not offered as deck source material.

> Why this is here: C3 made project-level images into deck source material, so
> a receipt photo could have been downloaded into a generation prompt. Money
> files are excluded from both lists — this is the same rule C3 already applied
> to invoices, now reaching receipts because they are finally flagged.

---

## Part D — the desktop puts it somewhere different

Desktop app, **Local Server** mode, with a project folder configured.

1. Open a project → **Budget** → **Expenses** → add an expense and attach
   `cab_receipt.jpg`.
2. In your file explorer, open the project folder you configured.

☐ **D1.** There is an **`INVOICES`** folder inside it, and `cab_receipt.jpg`
is in there — **not** in the ordinary files folder alongside the rest of the
project's attachments.

☐ **D2.** Back in the app, the receipt still opens and downloads from the
expense.

> This is the desktop's version of the same gate. The cloud puts a money file
> under a reserved path segment that its storage policies key on; the desktop
> has no policies, so it puts the body in a separate directory. One flag
> decides both.

---

## Part E — the read-only check (optional, and expected to be boring)

This one is for the receipts that were uploaded **before** the fix. Migration
0076 marked them financial. On both dev and staging that population is
currently **zero rows**, so there is nothing to look at — which is the honest
answer rather than a missing test.

If you want to confirm it yourself later, or on a company that has been in use
for a while, the standing query is in `SYSTEMS_HANDBOOK.md` §12.4 (§12.9). Both
of its columns should be `0`.

☐ **E1.** Skipped, or run and both columns were 0.

---

## What to report

For each ☐, "ok" or what you actually saw. **B2 is the one that matters** — if
the ordinary member can still see the receipt in Files, the bundle has not
done its job and nothing else in this list makes up for it. **A1, A3 and B3
are the ones that would show the fix went too far**, hiding things from people
who should still see them.

And say which environment you ran against (dev or staging), because staging
does not carry 0076 yet.
