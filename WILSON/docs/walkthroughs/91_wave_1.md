# 91 — WAVE 1 (the week of 2026-11-04)

One file for the wave (`docs/sessions/PLAN_WEEK_2026-11-04.md`;
`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **F1**
(the operator console's company list, and a type check in CI), **F2** (the
budget's money rules in one place) and **F3** (the desktop's project file;
its section comes with its merge). Each section stands on its own; answer its
questions by their numbers.

## F1 — The operator console's company list, and a type check in CI

Your ruling of 2026-10-31 on the code review's REV-01: *"Record it, fix at the
release steps"*. Fixed, checked in CI, and reviewed twice on Opus (your Fable
allowance was used up, and you chose Opus). It reaches the beta only when the
controller deploys the function to dev and staging, on your go.

1. **After that deploy, the operator console's Companies tab lists your
   companies again** (on the beta, `/wilsonadmin`, signed in as the
   operator). Since 2026-10-28 it has shown an error instead of the list; by
   the code that error reads *"Network error — check your connection."*,
   though your connection is fine. The same fix makes a company's teardown
   keep its full record of abandoned uploads again (in the Audit tab); since
   2026-10-28 that record held only the run's own and was marked cut short.
   Nothing else on the console changes.
2. **Nothing to answer.** Every push now type-checks every Edge Function, so a
   function that uses a name it never brought in (this one) turns CI red as
   soon as it is pushed (CI cannot stop a deploy by itself; the controller
   reads it first). The check also found 28 older typing slips, in seven
   functions and three shared files, that break nothing; they are written
   down (`docs/OUTSTANDING.md` F1-01) and counted, so CI fails if one is
   added.

## F2 — The budget's money rules in one place

Your ruling of 2026-10-31 on the agency fee when it is switched on and nobody
has typed a percentage, given twice: in this session's question box, *"20%"*,
and to the controller, *"20 percent"*. Measured first on the test project
(*Salt Hours*) with the fee on and no percentage typed, and with 10% typed;
built; measured again the same way; reviewed twice on Opus (the Fable
allowance was used up; your choice for F1, *"Use Opus for both"*).

1. **Every Budget page charges the same agency fee.** With the fee switched
   on and no percentage typed, the Summary charged 20% while the Crew tab,
   the Talent tab, the Topsheet and the client estimate charged 0%. Now every
   page charges 20%, your ruling, so those four pages' figures go up (the
   table below). A typed percentage is used as typed, as before; a typed 0
   too, with one exception that was there before: switching the fee off and
   on again on the Summary page puts 20% back in its place.
2. **Margin and contingency are worked out on the cost, never on a fee.**
   The Crew tab worked them out on the cost plus the agency fee; the Talent
   tab on the cost plus the agency fee and the agent's fee; the client
   estimate put its contingency and production fee on a total that held the
   talent's fees. Now all three work on the cost alone, as the Summary always
   did. On a budget with a fee, those figures come down a little; nothing
   else on those pages moves. The margin and contingency box on the Crew and
   Talent tabs now says what it works on: *Subtotal $18,720 × 10%* (it said
   *Bid total*, the cost with the fee in it).
3. **Everything else is as it was.** The Summary's figures, every saved bid
   version, what each page adds into its own Bid total, and every page's
   layout. Money is still shown in whole dollars, and on the test project no
   figure moved for rounding (elsewhere a total can move by a dollar at
   most): behind the screen each line's amounts are now worked
   out to the cent, as the Summary's margin and contingency already were (the
   Summary's agency fee stays rounded to the dollar, the way every saved bid
   version's was made).

### What it measured

The test project has a 10% contingency, no margin, the agency fee on, and a
15% agent's fee on each talent line. Figures as each page shows them.

| Page and figure | Fee on, no % typed: before | after | 10% typed: before | after |
|---|---|---|---|---|
| Summary: agency fee, overall total | 20% +$18,434, $119,823 | the same | 10% +$9,217, $110,606 | the same |
| Crew tab: the agency it shows | 0% | 20% | 10% | 10% |
| Crew tab: contingency, all crew | +$7,681 | +$7,681 | +$8,449 | +$7,681 |
| Crew tab: bid total | $76,810 | $92,172 | $84,491 | $84,491 |
| Talent tab: contingency | +$1,415 | +$1,230 | +$1,538 | +$1,230 |
| Talent tab: bid total | $14,145 | $16,605 | $15,375 | $15,375 |
| Topsheet: talent's agency column, grand bid | $1,845, $35,405 | $4,305, $37,865 | $3,075, $36,635 | the same |
| Client estimate: Talent, Contingency, Total | $14,145, $12,758, $140,335 | $16,605, $12,573, $142,610 | $15,375, $12,881, $141,688 | $15,375, $12,573, $141,380 |

What that means on a real budget when the fee is on and no percentage was
typed: the Crew tab's bid goes up by 20% of the crew's cost and the Talent
tab's by 20% of the talent's; the Topsheet and the client estimate follow;
the Summary does not move (it already charged 20%). With a percentage typed,
only the contingency and margin figures change, and only on a budget with a
fee. (The Crew tab's $92,172 matching the Summary's base is a coincidence:
see the first item under *Seen while measuring*.)

### Look at

The test project as it ships has 15% typed: with the dev fixtures on, open
R.A.B.B.I.T., *Salt Hours*, Budget. No pictures: the figures are these.

1. **Crew/team**: Production Designer, subtotal $18,720, contingency +$1,872
   (it said +$2,153: 10% of $21,528, the cost with the fee). The grand
   total's contingency +$7,681 (it said +$8,833). Click a contingency figure:
   the box says *Subtotal $18,720 × 10%*.
2. **Talent**: Mara (lead), contingency +$900 (it said +$1,170: 10% of
   $11,700, the cost with the agency and agent's fees).
3. **Client view**: Contingency $12,573 and Total $141,995 (they said
   $12,942 and $142,364).
4. **Summary**: unchanged, overall total $115,215.

On the beta, a cloud project always holds a percentage (0% where none was
typed, unless the Summary's switch filled in 20%: Q1), so the default does
not show there; what you will see is the smaller contingency and margin on a
budget with a fee (points 1 to 3).

### Seen while measuring and reviewing, written down, not changed

- **The Crew tab prices a role nobody holds yet below the Summary**
  (`docs/OUTSTANDING.md` F2-01). The Crew tab uses the rate card's rate
  before its burden and overhead ($520 a day for the production designer);
  the Summary, the reports and the client estimate the full rate with them
  ($624). On the test project the crew comes to $76,810 on the Crew tab and
  $92,172 on the Summary; with the fee on and none typed the Crew tab's bid
  is also $92,172, only because its 20% fee is the size of the card's 12%
  and 8%. Q2.
- **The client estimate leaves out the agency fee on the crew and the
  expenses** (F2-03): the fee rides only inside its Talent line; the
  Topsheet's expenses row has none either. Q3.
- **The cloud keeps 0% for a percentage nobody typed** (F2-04): on the
  cloud only the Budget's Summary page fills in your 20% when you switch the
  fee on there; switching it on in the new-project form or in the project's
  settings leaves 0%, and moving a project from this computer to the cloud
  turns its 20% into 0%. Q1.
- **The Topsheet's Crew / Team rows show $0 on the test project** (F2-02):
  they price only people with a rate of their own on the rate card in use,
  so the roles the Crew tab lists ($76,810) are missing from it.
- **The Crew and Talent tabs' Bid total is the cost plus the fees**
  (F2-05): margin and contingency stand beside it and are not added in, so a
  row reads Subtotal $18,720, Contingency +$1,872, Bid total $21,528.
- **On a Crew row for a role nobody holds yet, a margin or an amount you type
  is not kept** (F2-06, found by reading, not tried): the row's boxes open,
  but what is saved is filed under no one, so the row keeps showing the
  project's figures. On the test project every crew row is such a row.

### Questions

**Q1. On the cloud, switching the agency fee on in the new-project form or in
the project's settings, without typing a percentage, saves 0%, so your 20%
doesn't reach that project (the Budget's Summary page does fill in 20% when
you switch the fee on there). Should those two fill in 20% for you too?**
(a) Yes: switching the fee on with nothing typed fills in 20% wherever you do
it, so every project starts at 20% and you can change it. *(Recommended: your
ruling, kept wherever the project lives.)*
(b) No: those two keep 0% until you type a percentage.

**Q2. For a role nobody holds yet, which day rate should the Crew tab use?**
(a) The full rate with the rate card's burden and overhead, as the Summary
and the client estimate do ($624 for the production designer).
*(Recommended: the Crew tab and the Summary then agree on what the crew
costs.)*
(b) The rate before burden and overhead, as the Crew tab does today ($520).

**Q3. Should the client estimate include the agency fee on the crew and the
expenses?**
(a) Yes, as a line of its own (*Agency fee*), the way contingency is shown.
(b) Yes, folded into each line, the way the talent's is today.
(c) No: leave them without it.
No recommendation: it is what your client is shown.
