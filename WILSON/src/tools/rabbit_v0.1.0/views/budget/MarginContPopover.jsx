// ============================================================
// RABBIT — MarginContPopover: the margin & contingency editor (R3-32)
// ============================================================
//
// One editor for a line's margin and contingency percentages, on the lane's
// one popover (BudgetPopover). It existed three times, byte for byte, in
// CrewTeamTab, TalentTab and BudgetView (ExpenseMarginContPopover); the
// Expenses tab uses this one now, and Crew and Talent switch their two copies
// to it next. Its props are theirs, generalised:
//
//   anchor        the rect the caller stores ({ x, y, h }) — BudgetPopover's
//   baseAmount    what the percentages are OF (an expense's estimated cost,
//                 a line's bid total)
//   amountLabel   what `baseAmount` is called ("Estimated cost", "Bid"): the
//                 figures' tooltip says what they were worked out on
//   marginPct, contPct            the line's values, already defaulted
//   defaultMargin, defaultCont    the project's, for the placeholders and
//                                 the Default button
//   currency, onSave({ margin_pct, contingency_pct }), onClose
//
// Every field, its order and its save are the three copies': Margin %, then
// Contingency %, each with the amount it adds (a plus even at zero — an
// amount added by definition, R3-14), then Save and Default. What changed is
// the look (the kit's fields and buttons, the figure in the ink rather than
// orange) and the surface (BudgetPopover's).
// ============================================================

import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '../../../../ui'
import { formatMoney } from '../../components/CurrencyDisplay'
import BudgetPopover from './BudgetPopover'
import '../rabbitBudget.css'

export default function MarginContPopover({
  anchor,
  amountLabel = 'Base',
  baseAmount = 0,
  marginPct,
  contPct,
  defaultMargin = 0,
  defaultCont = 0,
  currency,
  onSave,
  onClose,
}) {
  const [margin, setMargin] = useState(marginPct ?? '')
  const [cont, setCont]     = useState(contPct ?? '')

  const base = Number(baseAmount) || 0
  const mPct = Number(margin) || 0
  const cPct = Number(cont) || 0
  const marginAmt = base * mPct / 100
  const contAmt   = base * cPct / 100
  // "Estimated cost $3,000 × 10%": how the figure beside the field is made.
  const workedOn = (pct) => `${amountLabel} ${formatMoney(base, currency)} × ${pct}%`

  return (
    <BudgetPopover anchor={anchor} title="Margin & contingency" onClose={onClose}>
      <div className="rb-pop-field">
        <span className="ui-field-label">Margin %</span>
        <span className="rb-pop-row">
          <input
            type="number" step="0.5" min="0" max="100"
            value={margin}
            onChange={e => setMargin(e.target.value)}
            placeholder={String(defaultMargin)}
            aria-label="Margin %"
            className="ui-input rb-pop-input"
            data-size="sm"
            autoFocus
          />
          <span className="rb-pop-amount" title={workedOn(mPct)}>
            {formatMoney(marginAmt, currency, { sign: 'always' })}
          </span>
        </span>
      </div>
      <div className="rb-pop-field">
        <span className="ui-field-label">Contingency %</span>
        <span className="rb-pop-row">
          <input
            type="number" step="0.5" min="0" max="100"
            value={cont}
            onChange={e => setCont(e.target.value)}
            placeholder={String(defaultCont)}
            aria-label="Contingency %"
            className="ui-input rb-pop-input"
            data-size="sm"
          />
          <span className="rb-pop-amount" title={workedOn(cPct)}>
            {formatMoney(contAmt, currency, { sign: 'always' })}
          </span>
        </span>
      </div>
      <div className="rb-pop-actions">
        <Button
          size="sm"
          variant="primary"
          className="rb-pop-save"
          onClick={() => onSave({ margin_pct: Number(margin) || 0, contingency_pct: Number(cont) || 0 })}
        >
          Save
        </Button>
        <Button
          size="sm"
          Icon={RotateCcw}
          onClick={() => { setMargin(String(defaultMargin)); setCont(String(defaultCont)) }}
        >
          Default
        </Button>
      </div>
    </BudgetPopover>
  )
}
