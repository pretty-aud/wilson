# 91 — WAVE 1 (the week of 2026-11-04)

One file for the wave (`docs/sessions/PLAN_WEEK_2026-11-04.md`;
`docs/sessions/PLAN_TO_1_0.md` §5, rule 3), one section per session: **F2**
(the budget's money rules in one place). Each section stands on its own;
answer its questions by their numbers.

## F2 — The budget's money rules in one place

Your ruling of 2026-10-31, in this session's question box, on the agency fee
when it is switched on and nobody has typed a percentage: *"20%"*. Measured
first on the test project (*Salt Hours*) with the fee on and no percentage
typed, and with 10% typed; built; measured again the same way; reviewed twice
on Fable.

1. **Every Budget page charges the same agency fee.** With the fee switched
   on and no percentage typed, the Summary charged 20% while the Crew tab,
   the Topsheet and the client estimate charged 0%. Now every page charges
   20%, your ruling. A typed percentage, 0 included, is used as typed, as
   before.
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
   layout. Money is still shown in whole dollars; behind the screen each
   amount is now worked out to the cent on every page, as the Summary
   already did.

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

On the beta, a project made on the cloud is saved with 0% when no percentage
is typed (Q1), so what you will see there is the smaller contingency and
margin on a budget with a fee (points 1 to 3).

### Seen while measuring, written down, not changed

- **The Crew tab prices a role nobody holds yet below the Summary**
  (`docs/OUTSTANDING.md` F2-01). The Crew tab uses the rate card's rate
  before its burden and overhead ($520 a day for the production designer);
  the Summary, the reports and the client estimate the full rate with them
  ($624). On the test project the crew comes to $76,810 on the Crew tab and
  $92,172 on the Summary; with the fee on and none typed the Crew tab's bid
  is also $92,172, only because its 20% fee is the size of the card's 12%
  and 8%. Q2.
- **The client estimate leaves out the agency fee on the crew and the
  expenses** (F2-03): the fee rides only inside its Talent line. Q3.
- **The cloud keeps 0% for a percentage nobody typed** (F2-04): your 20%
  reaches projects kept on this computer, and moving one of those to the
  cloud turns its 20% into 0%. Q1.
- **The Topsheet's Crew / Team rows show $0 on the test project** (F2-02):
  they price only people with a rate of their own on the rate card in use,
  so the roles the Crew tab lists ($76,810) are missing from it.
- **The Crew and Talent tabs' Bid total is the cost plus the fees**
  (F2-05): margin and contingency stand beside it and are not added in, so a
  row reads Subtotal $18,720, Contingency +$1,872, Bid total $21,528.

### Questions

**Q1. A new project on the cloud with the agency fee switched on and no
percentage typed is saved with 0%, so your 20% never reaches it. Should the
new-project form fill in 20% for you in that case?**
(a) Yes: the form fills in 20% when the fee is switched on and nothing is
typed, so cloud and desktop projects both start at 20% and you can change
it. *(Recommended: your ruling, kept wherever the project lives.)*
(b) No: cloud projects keep 0% until you type one.

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
