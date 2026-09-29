// Champ « échéance » d'un objectif : bouton qui deplie, DANS le flux de la
// feuille (jamais un popover rogne par le defilement du dialog), un choix
// d'annee et une grille de mois, plus des raccourcis pour les objectifs
// lointains (1, 2, 5 ans). Bornes : [min, max] au format 'YYYY-MM'.

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, currentMonth, fmtMonthTitle } from '@/lib/format'
import { cn } from '@/lib/utils'

const MONTH_ABBR = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }),
)

/** Ecart en mois entre deux 'YYYY-MM' (b - a). */
function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb! - ya!) * 12 + (mb! - ma!)
}

/** « ce mois-ci », « dans 8 mois », « dans 2 ans et 3 mois », « il y a 2 mois ». */
export function relativeMonths(month: string, from = currentMonth()): string {
  const n = monthsBetween(from, month)
  if (n === 0) return 'ce mois-ci'
  if (n < 0) return n === -1 ? 'le mois dernier' : `il y a ${-n} mois`
  if (n < 12) return `dans ${n} mois`
  const years = Math.floor(n / 12)
  const rest = n % 12
  const y = years === 1 ? '1 an' : `${years} ans`
  return rest === 0 ? `dans ${y}` : `dans ${y} et ${rest} mois`
}

const PRESETS = [
  { label: '6 mois', months: 6 },
  { label: '1 an', months: 12 },
  { label: '2 ans', months: 24 },
  { label: '5 ans', months: 60 },
]

const YEAR_ARROW =
  "relative flex h-9 w-9 items-center justify-center rounded-full text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface2 hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-30"

export function DueMonthField({
  value,
  onChange,
  min,
  max,
  id,
}: {
  value: string
  onChange: (month: string) => void
  min: string
  max: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number(value.slice(0, 4)))
  const panelRef = useRef<HTMLDivElement>(null)
  const minYear = Number(min.slice(0, 4))
  const maxYear = Number(max.slice(0, 4))
  const thisMonth = currentMonth()

  // Realigne l'annee affichee sur la valeur a chaque ouverture.
  useEffect(() => {
    if (open) setYear(Number(value.slice(0, 4)))
  }, [open, value])

  // A l'ouverture, le panneau deplie est amene dans la partie visible de la
  // feuille (il pousse le contenu, la feuille defile).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const pick = (month: string) => {
    onChange(month)
    setOpen(false)
  }

  return (
    <div>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'flex h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3.5 text-left transition-[border-color,box-shadow] duration-150 ease-spring hover:border-soft/40 lg:h-11',
          open && 'border-accent/70 ring-4 ring-accent/15',
        )}
      >
        <CalendarClock className="h-[18px] w-[18px] shrink-0 text-soft" />
        <span className="min-w-0 flex-1 truncate text-[16px] font-medium text-ink lg:text-[14.5px]">
          {fmtMonthTitle(value)}
        </span>
        <span className="shrink-0 text-[12.5px] text-soft">{relativeMonths(value, thisMonth)}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-soft transition-transform duration-200 ease-spring', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div ref={panelRef} className="mt-2 animate-fade-up scroll-mb-4 rounded-2xl border border-edge bg-surface2/50 p-2.5">
          <div className="flex items-center justify-between px-1 pb-1">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              disabled={year <= minYear}
              aria-label="Année précédente"
              className={YEAR_ARROW}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[15px] font-semibold tnum">{year}</span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= maxYear}
              aria-label="Année suivante"
              className={YEAR_ARROW}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {MONTH_ABBR.map((abbr, i) => {
              const month = `${year}-${String(i + 1).padStart(2, '0')}`
              const selected = month === value
              const disabled = month < min || month > max
              return (
                <button
                  key={month}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(month)}
                  aria-pressed={selected}
                  className={cn(
                    'h-11 rounded-xl text-[14px] font-medium capitalize transition-[background-color,color,transform] duration-150 ease-spring active:scale-95 lg:h-10 lg:text-[13.5px]',
                    selected
                      ? 'bg-accent text-accentfg shadow-button'
                      : 'text-ink hover:bg-surface disabled:pointer-events-none disabled:opacity-30',
                    month === thisMonth && !selected && 'text-accent-ink ring-1 ring-inset ring-accent/35 dark:text-accent',
                  )}
                >
                  {abbr}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line/70 pt-2.5">
            {PRESETS.map((preset) => {
              const month = addMonths(thisMonth, preset.months)
              if (month > max) return null
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => pick(month)}
                  className="relative h-9 rounded-full bg-surface px-3 text-[13px] font-medium text-soft ring-1 ring-inset ring-edge transition-colors after:absolute after:-inset-1 after:content-[''] hover:text-ink active:scale-95"
                >
                  Dans {preset.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
