// ============================================================
// CurrencyDisplay — and formatMoney, the one money formatter
// ============================================================
//
// Every amount inside RABBIT's Budget renders through here (review R3-01:
// five formatters in two locales had shipped — four copies of a
// `fmtCurrency` in 'en-US' beside this component in the VIEWER's locale, both
// on the Summary tab at once, so one amount could print two ways in one card).
//
//   formatMoney(value, currency, { fractionDigits, sign })  → a string, for
//     the places a string is what is needed: a template (the printed client
//     estimate), a tile's value, a cell's text.
//   <CurrencyDisplay value currency signed fallback />      → the figure, for
//     everything else.
//
// ONE LOCALE, chosen once: MONEY_LOCALE. The four copies all said 'en-US', and
// a money column is only a column if every row is set by the same rules.
//
// THE SIGN IS INTL'S (R3-14). Five places built a variance's sign by hand
// (`${v > 0 ? '+' : ''}${fmt(v)}`); `sign: 'exceptZero'` puts it where Intl
// puts a negative's, so the sign glyph is always in the same place relative
// to the symbol. `sign: 'always'` is for an amount that is added by
// definition (a margin, a contingency), zero included, as the popovers print
// it.
//
// The figure is the mono at tabular figures and never wraps (rabbitBudget.css,
// `.rb-money-figure`), and it takes NO colour and no size: it inherits both
// from the cell it sits in (R3-34 — about twenty-five callers wrote their
// colour twice, once on the cell and once on this span).

import { useRabbit } from '../state/RabbitProvider'
import '../views/rabbitBudget.css'

export const MONEY_LOCALE = 'en-US'

export function formatMoney(value, currency, { fractionDigits = 0, sign = 'auto' } = {}) {
  const n = Number(value) || 0
  const code = currency || 'USD'
  try {
    return new Intl.NumberFormat(MONEY_LOCALE, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      signDisplay: sign,
    }).format(n)
  } catch {
    // An unknown currency code: say what it is rather than blank the cell.
    return `${code} ${Math.round(n)}`
  }
}

export default function CurrencyDisplay({
  value,
  currency,
  className = '',
  fractionDigits = 0,
  signed = false,
  fallback = '—',
}) {
  const ctx = useRabbit()
  const code = currency || ctx?.project?.budget_currency || 'USD'
  const missing = value == null || Number.isNaN(Number(value))
  return (
    <span className={`rb-money-figure ${className}`.trim()}>
      {missing ? fallback : formatMoney(value, code, { fractionDigits, sign: signed ? 'exceptZero' : 'auto' })}
    </span>
  )
}
