// ============================================================
// Settings — CurrencyPicker
// ============================================================
//
// Picks the default project currency used by RABBIT for new
// projects + budget rollups when no explicit currency is set on
// the project. Persisted under settings.rabbit.defaultCurrency.

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import './settings.css'
import { Input } from '../../ui'

const CURRENCIES = [
  { code: 'USD', label: 'US Dollar',          symbol: '$' },
  { code: 'EUR', label: 'Euro',               symbol: '€' },
  { code: 'GBP', label: 'British Pound',      symbol: '£' },
  { code: 'CAD', label: 'Canadian Dollar',    symbol: 'C$' },
  { code: 'AUD', label: 'Australian Dollar',  symbol: 'A$' },
  { code: 'JPY', label: 'Japanese Yen',       symbol: '¥' },
  { code: 'CNY', label: 'Chinese Yuan',       symbol: '¥' },
  { code: 'INR', label: 'Indian Rupee',       symbol: '₹' },
  { code: 'BRL', label: 'Brazilian Real',     symbol: 'R$' },
  { code: 'MXN', label: 'Mexican Peso',       symbol: 'MX$' },
  { code: 'CHF', label: 'Swiss Franc',        symbol: 'CHF' },
  { code: 'SEK', label: 'Swedish Krona',      symbol: 'kr' },
  { code: 'NOK', label: 'Norwegian Krone',    symbol: 'kr' },
  { code: 'DKK', label: 'Danish Krone',       symbol: 'kr' },
  { code: 'NZD', label: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SGD', label: 'Singapore Dollar',   symbol: 'S$' },
  { code: 'HKD', label: 'Hong Kong Dollar',   symbol: 'HK$' },
  { code: 'KRW', label: 'South Korean Won',   symbol: '₩' },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R' },
]

export default function CurrencyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const current = CURRENCIES.find(c => c.code === (value || 'USD')) || CURRENCIES[0]

  useEffect(() => {
    if (!open) setFilter('')
  }, [open])

  const filtered = filter
    ? CURRENCIES.filter(c =>
        c.code.toLowerCase().includes(filter.toLowerCase()) ||
        c.label.toLowerCase().includes(filter.toLowerCase()))
    : CURRENCIES

  return (
    <div className="relative">
      {/* S24: this trigger was px-4 py-3 — 48px — while the rate-card select
          directly beneath it was 32px, so the two controls in one section
          were different objects. Both are 36px now.
          S38: the caret was text-stone-400 at 1.74:1 and the symbol
          text-orange-300 at 2.40:1 on the 0.55 well. One ink; the symbol keeps
          its distinction through a fixed-width column, not colour.
          S29: the caret was a literal ▲/▼ glyph, not an icon. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="s-currency-trigger"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="s-data" style={{ width: '2.5ch' }}>{current.symbol}</span>
          <span className="truncate">{current.code} — {current.label}</span>
        </span>
        <ChevronDown size={14} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {/* 🚨 THE MENU IS STAMPED `dark`. index.css scopes the focus ring, the
          placeholder, the caret and ::selection off the NEAREST data-surface,
          and the page root is `light`. Without this stamp the ring and the
          placeholder inside this #232020 panel both resolve to #1c1917 —
          about 1.08:1, i.e. invisible, on an autofocused search field. The
          kit's own Dialog, Menu and Toast stamp themselves; a hand-rolled
          island has to be stamped by hand. */}
      {open && (
        <div className="s-currency-menu" data-surface="dark" role="listbox">
          {/* The filter is conditionally mounted, so autoFocus fires. */}
          <div className="p-2">
            <Input
              value={filter}
              onChange={setFilter}
              placeholder="Search currency…"
              size="sm"
              autoFocus
              aria-label="Search currency"
              className="w-full"
            />
          </div>
          {filtered.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onChange(c.code); setOpen(false); }}
              className="s-cur-option"
              data-current={c.code === current.code}
            >
              <span className="s-data" style={{ width: '2.5ch' }}>{c.symbol}</span>
              <span className="s-data" style={{ width: '4ch' }}>{c.code}</span>
              <span className="truncate">{c.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-3" style={{ fontSize: 'var(--text-dense)', color: 'var(--color-ink-2)' }}>
              No matches.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { CURRENCIES }
