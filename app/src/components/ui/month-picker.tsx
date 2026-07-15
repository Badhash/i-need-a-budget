import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtMonthTitle } from '@/lib/format'
import { cn } from '@/lib/utils'

interface MonthPickerProps {
  /** Format 'YYYY-MM', ou 'all' si allowAll est actif. */
  value: string
  onChange: (month: string) => void
  /** Bornes 'YYYY-MM' optionnelles. */
  min?: string
  max?: string
  /** Ajoute un choix "Tous les mois" represente par value='all'. */
  allowAll?: boolean
  className?: string
  'aria-label'?: string
}

const ALL = 'all'

// Abreviations fr-FR (jan..dec) via l'API Intl, calculees une fois.
const MONTH_ABBR = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }),
)

function pad(m: number): string {
  return String(m).padStart(2, '0')
}

/** Selecteur de mois calendaire (popover), remplace input type=month. */
export function MonthPicker({
  value,
  onChange,
  min,
  max,
  allowAll = false,
  className,
  'aria-label': ariaLabel,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const isAll = allowAll && value === ALL
  // Annee affichee dans le popover : celle du mois selectionne, sinon l'annee courante.
  const initialYear = useMemo(() => {
    if (!isAll && /^\d{4}-\d{2}$/.test(value)) return Number(value.slice(0, 4))
    return new Date().getFullYear()
  }, [value, isAll])
  const [year, setYear] = useState(initialYear)

  // Realigne l'annee visible sur la valeur a chaque ouverture.
  useEffect(() => {
    if (open) setYear(initialYear)
  }, [open, initialYear])

  // Fermeture au clic exterieur.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = isAll ? 'Tous les mois' : fmtMonthTitle(value)

  const disabledMonth = (month: string) => (min && month < min) || (max && month > max)

  const pick = (month: string) => {
    onChange(month)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn('relative min-w-[160px]', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel ?? 'Choisir un mois'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-line bg-surface pl-3.5 pr-3 text-[16px] text-ink outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20 lg:h-10 lg:text-[14px]"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-soft" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-card">
          {allowAll && (
            <button
              type="button"
              onClick={() => pick(ALL)}
              className={cn(
                'mb-1 flex h-9 w-full items-center justify-center rounded-lg text-[13.5px] font-medium transition-colors hover:bg-surface2',
                isAll && 'bg-accent/10 text-accent',
              )}
            >
              Tous les mois
            </button>
          )}

          <div className="flex items-center justify-between px-1 py-1">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Année précédente"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-soft transition-colors hover:bg-surface2 hover:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[14px] font-semibold tnum">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Année suivante"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-soft transition-colors hover:bg-surface2 hover:text-ink"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 pt-1">
            {MONTH_ABBR.map((abbr, i) => {
              const month = `${year}-${pad(i + 1)}`
              const selected = !isAll && month === value
              const isDisabled = disabledMonth(month)
              return (
                <button
                  key={month}
                  type="button"
                  disabled={Boolean(isDisabled)}
                  onClick={() => pick(month)}
                  className={cn(
                    'h-10 rounded-lg text-[13px] font-medium capitalize transition-colors',
                    selected
                      ? 'bg-accent text-white'
                      : 'text-ink hover:bg-surface2 disabled:pointer-events-none disabled:opacity-30',
                  )}
                >
                  {abbr}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
