import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Landmark, Search } from 'lucide-react'
import type { Aspsp } from '@/lib/bank'
import { cn } from '@/lib/utils'

interface BankComboboxProps {
  aspsps: Aspsp[]
  value: string
  onSelect: (name: string) => void
  loading?: boolean
  disabled?: boolean
}

/** Selecteur de banque avec recherche (autocomplete) et logo par option. */
export function BankCombobox({ aspsps, value, onSelect, loading, disabled }: BankComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? aspsps.filter((a) => a.name.toLowerCase().includes(q)) : aspsps
    return list.slice(0, 60)
  }, [aspsps, query])

  return (
    <div className="relative w-full min-w-[200px] flex-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
        <input
          value={open ? query : value || query}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120)
          }}
          disabled={disabled || loading}
          placeholder={loading ? 'Chargement des banques…' : 'Cherche ta banque…'}
          aria-label="Cherche ta banque"
          className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-9 text-[14px] outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
      </div>

      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-card">
          {filtered.map((a) => (
            <li key={a.name}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(a.name)
                  setQuery('')
                  setOpen(false)
                  if (blurTimer.current) clearTimeout(blurTimer.current)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-surface2',
                  a.name === value && 'bg-accent/10 text-accent',
                )}
              >
                <BankLogo logo={a.logo} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-line bg-surface p-3 text-[13px] text-soft shadow-card">
          Aucune banque ne correspond.
        </div>
      )}
    </div>
  )
}

/** Logo de banque (image Enable Banking) avec repli sur une icone si indisponible. */
function BankLogo({ logo }: { logo: string | null }) {
  const [broken, setBroken] = useState(false)
  if (!logo || broken) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface2 text-soft">
        <Landmark className="h-3.5 w-3.5" />
      </span>
    )
  }
  return (
    <img
      src={logo}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className="h-6 w-6 shrink-0 rounded-md bg-white object-contain"
    />
  )
}
