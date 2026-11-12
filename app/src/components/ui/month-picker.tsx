import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { fieldClasses } from '@/components/ui/input'
import { currentMonth, fmtMonthTitle } from '@/lib/format'
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
  /** 'up' : le panneau s'ouvre AU-DESSUS du bouton (feuille basse, dernier champ). */
  direction?: 'down' | 'up'
  className?: string
  'aria-label'?: string
}

const ALL = 'all'

// Abreviations fr-FR (jan..dec) via l'API Intl, calculees une fois.
const MONTH_ABBR = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }),
)

const YEAR_ARROW =
  "relative flex h-9 w-9 items-center justify-center rounded-full text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface2 hover:text-ink active:scale-95 aria-disabled:pointer-events-none aria-disabled:opacity-30"

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
  direction = 'down',
  className,
  'aria-label': ariaLabel,
}: MonthPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const isAll = allowAll && value === ALL
  // Bornes d'annee : les fleches s'y arretent (elles menaient a 2023 ou 2029,
  // annees dont tous les mois etaient desactives).
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity
  const maxYear = max ? Number(max.slice(0, 4)) : Infinity
  // Annee affichee dans le popover : celle du mois selectionne, sinon l'annee
  // courante (fuseau Europe/Paris, comme le mois courant), ramenee dans les bornes.
  const initialYear = useMemo(() => {
    const y = !isAll && /^\d{4}-\d{2}$/.test(value) ? Number(value.slice(0, 4)) : Number(currentMonth().slice(0, 4))
    return Math.min(maxYear, Math.max(minYear, y))
  }, [value, isAll, minYear, maxYear])
  const [year, setYear] = useState(initialYear)
  const canPrev = year > minYear
  const canNext = year < maxYear

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

  // Echap ferme le panneau, et lui seul : Radix (Dialog) ecoute la touche en
  // capture sur le document et fermait la feuille parente (filtres mobiles).
  // La capture sur window passe avant lui ; la touche s'arrete ici. Le focus
  // revient au bouton (il etait peut-etre sur un mois, retire du DOM).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const label = isAll ? 'Tous les mois' : fmtMonthTitle(value)
  const thisMonth = currentMonth()

  const disabledMonth = (month: string) => (min && month < min) || (max && month > max)

  const pick = (month: string) => {
    onChange(month)
    setOpen(false)
  }

  return (
    <div
      ref={rootRef}
      // Focus parti ailleurs (Tab) : le panneau se ferme, comme au clic exterieur.
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      className={cn('relative min-w-[160px]', className)}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel ?? 'Choisir un mois'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 pl-3 pr-3 text-left',
          fieldClasses,
          open && 'border-accent/70 ring-4 ring-accent/15',
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-soft" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-soft transition-transform duration-200 ease-spring',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            'absolute z-50 w-64 animate-scale-in rounded-2xl border border-edge bg-surface3 p-2 shadow-elevated',
            direction === 'up' ? 'bottom-full mb-1.5 origin-bottom' : 'mt-1.5 origin-top',
          )}
        >
          {allowAll && (
            <button
              type="button"
              onClick={() => pick(ALL)}
              className={cn(
                'mb-1 flex h-11 w-full items-center justify-center rounded-xl text-[13.5px] font-medium transition-colors hover:bg-surface2 lg:h-10',
                isAll && 'bg-accent/10 text-accent-ink',
              )}
            >
              Tous les mois
            </button>
          )}

          {/* Fleches d'annee : 36px a l'oeil, zone de toucher etendue a 44px. */}
          <div className="flex items-center justify-between px-1 py-1">
            {/* aria-disabled plutot que disabled : le focus clavier reste sur la
                fleche arrivee en butee. */}
            <button
              type="button"
              onClick={() => canPrev && setYear((y) => y - 1)}
              aria-label="Année précédente"
              aria-disabled={!canPrev || undefined}
              className={YEAR_ARROW}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[14px] font-semibold tnum">{year}</span>
            <button
              type="button"
              onClick={() => canNext && setYear((y) => y + 1)}
              aria-label="Année suivante"
              aria-disabled={!canNext || undefined}
              className={YEAR_ARROW}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 pt-1">
            {MONTH_ABBR.map((abbr, i) => {
              const month = `${year}-${pad(i + 1)}`
              const selected = !isAll && month === value
              const isCurrent = month === thisMonth
              const isDisabled = disabledMonth(month)
              return (
                <button
                  key={month}
                  type="button"
                  disabled={Boolean(isDisabled)}
                  onClick={() => pick(month)}
                  aria-current={isCurrent ? 'date' : undefined}
                  className={cn(
                    'relative h-11 rounded-xl text-[13.5px] font-medium capitalize transition-[background-color,color,transform] duration-150 ease-spring active:scale-95 lg:h-10 lg:text-[13px]',
                    selected
                      ? 'bg-accent text-accentfg shadow-button'
                      : 'text-ink hover:bg-surface2 disabled:pointer-events-none disabled:opacity-30',
                    isCurrent && !selected && 'text-accent-ink ring-1 ring-inset ring-accent/35',
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
