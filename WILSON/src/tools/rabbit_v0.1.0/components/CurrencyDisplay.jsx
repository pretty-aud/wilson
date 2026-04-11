// ============================================================
// CurrencyDisplay
// ============================================================
//
// Tiny presentational wrapper around `Intl.NumberFormat` so that
// every dollar/euro/yen amount inside RABBIT renders the same
// way. The view passes the *value* and (optionally) a *currency
// code* — when omitted, the active project's `budget_currency`
// from the provider is used.
//
// We deliberately keep this dumb: no rounding rules, no plural
// handling, no locale negotiation. The view layer decides what
// to show; this just makes sure the rendering is consistent.

import { useRabbit } from '../state/RabbitProvider'

export default function CurrencyDisplay({
  value,
  currency,
  className,
  style,
  fractionDigits = 0,
  fallback = '—',
}) {
  const ctx = useRabbit()
  const code = currency || ctx?.project?.budget_currency || 'USD'

  if (value == null || isNaN(value)) {
    return <span className={className} style={style}>{fallback}</span>
  }

  let formatted
  try {
    formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value)
  } catch {
    formatted = `${code} ${Math.round(value)}`
  }

  return <span className={className} style={style}>{formatted}</span>
}
