import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { fieldClasses } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  /** En-tete de groupe (comme optgroup) ; les options d'un meme groupe sont regroupees. */
  group?: string
  /** Nom d'une variable CSS pour une pastille ronde optionnelle (ex. 'cat-blue-fg'). */
  colorVar?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

/** Enleve les accents pour un filtrage insensible casse/accents. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Pastille ronde coloree (variable CSS) affichee avant un label d'option. */
function Dot({ colorVar }: { colorVar: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: `var(--${colorVar})` }}
    />
  )
}

/**
 * Combobox single-select avec recherche, generique (imite BankCombobox).
 * Affiche le label de l'option selectionnee quand ferme, filtre a l'ouverture,
 * regroupe par `group` si present. Clavier : Enter selectionne le premier
 * resultat, Escape ferme.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  className,
  disabled,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? '',
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return q ? options.filter((o) => normalize(o.label).includes(q)) : options
  }, [options, query])

  // Regroupe en preservant l'ordre d'apparition des groupes.
  const grouped = useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, ComboboxOption[]>()
    for (const o of filtered) {
      const key = o.group ?? ''
      if (!byGroup.has(key)) {
        byGroup.set(key, [])
        order.push(key)
      }
      byGroup.get(key)!.push(o)
    }
    return order.map((key) => ({ group: key, items: byGroup.get(key)! }))
  }, [filtered])

  const commit = (v: string) => {
    onChange(v)
    setQuery('')
    setOpen(false)
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }

  return (
    <div className={cn('relative min-w-[160px]', className)}>
      <div className="group relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-colors group-focus-within:text-accent" />
        <input
          value={open ? query : selectedLabel}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              e.preventDefault()
              commit(filtered[0].value)
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
          disabled={disabled}
          placeholder={open ? searchPlaceholder : placeholder}
          aria-label={ariaLabel}
          className={cn('pl-9 pr-9', fieldClasses)}
        />
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-transform duration-200 ease-spring',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && filtered.length > 0 && (
        <ul
          className="absolute z-50 mt-1.5 max-h-72 w-full origin-top animate-scale-in overflow-auto rounded-2xl border border-edge bg-surface3 p-1.5 shadow-elevated"
        >
          {grouped.map(({ group, items }) => (
            <li key={group || '__nogroup__'}>
              {group && (
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">
                  {group}
                </p>
              )}
              <ul>
                {items.map((o) => (
                  <li key={o.value}>
                    <button
                      type="button"
                      aria-pressed={o.value === value}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => commit(o.value)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] transition-colors hover:bg-surface2 lg:min-h-9 lg:text-[13.5px]',
                        o.value === value && 'bg-accent/10 font-medium text-accent-ink hover:bg-accent/15',
                      )}
                    >
                      {o.colorVar && <Dot colorVar={o.colorVar} />}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.value === value && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1.5 w-full origin-top animate-scale-in rounded-2xl border border-edge bg-surface3 p-3.5 text-[13px] text-soft shadow-elevated">
          Aucun résultat.
        </div>
      )}
    </div>
  )
}
