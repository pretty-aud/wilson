// ============================================================
// Settings — CurrencyPicker
// ============================================================
//
// Picks the default project currency used by RABBIT for new
// projects + budget rollups when no explicit currency is set on
// the project. Persisted under settings.rabbit.defaultCurrency.

import { useEffect, useState } from 'react'

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

const inputStyle = {
  backgroundColor: 'rgba(120, 70, 30, 0.55)',
  color: '#fde8d0',
  border: 'none',
}

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
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
        style={inputStyle}
      >
        <span>
          <span className="text-orange-300 mr-2">{current.symbol}</span>
          {current.code} — {current.label}
        </span>
        <span className="text-stone-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-sm shadow-xl"
          style={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }}
        >
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search currency…"
            className="w-full px-3 py-2 text-xs font-mono border-b focus:outline-none"
            style={{ ...inputStyle, borderColor: '#44403c' }}
            autoFocus
          />
          {filtered.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onChange(c.code); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-left text-xs font-mono hover:bg-stone-800 transition-colors"
              style={{ color: c.code === current.code ? '#f4a261' : '#fde8d0' }}
            >
              <span className="w-8 text-orange-300">{c.symbol}</span>
              <span className="w-12">{c.code}</span>
              <span className="text-stone-400">{c.label}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-stone-500 font-mono">No matches.</div>
          )}
        </div>
      )}
    </div>
  )
}

export { CURRENCIES }
