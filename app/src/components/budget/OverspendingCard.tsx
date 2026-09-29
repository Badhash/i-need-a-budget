// Ligne des depassements du mois (dans le heros du Pret a assigner, mobile) :
// quelles enveloppes sont dans le rouge, combien il manque, et l'action pour
// les couvrir en une fois (l'equivalent du bouton « Couvrir les depassements »
// du desktop). Rien n'est rendu quand aucune enveloppe n'est negative.

import { LifeBuoy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

/** « Restaurants », « Restaurants et Courses », « Restaurants, Courses et 2 autres ». */
function namesSummary(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} et ${names[1]}`
  const rest = names.length - 2
  return `${names[0]}, ${names[1]} et ${rest === 1 ? '1 autre' : `${rest} autres`}`
}

export function OverspendingCard({
  count,
  missing,
  names = [],
  onCover,
  className,
}: {
  count: number
  missing: number
  /** Noms des enveloppes en depassement (ordre de la grille). */
  names?: string[]
  onCover: () => void
  className?: string
}) {
  if (count === 0) return null
  const who = namesSummary(names)
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-2xl bg-danger/[0.07] py-2.5 pl-2.5 pr-2.5 ring-1 ring-inset ring-danger/15',
        className,
      )}
      title="Non couvert, le manque sera déduit du Prêt à assigner le mois prochain."
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
        <LifeBuoy className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-snug text-ink tnum">
          <span className="text-danger">{fmtEUR(missing)}</span> à couvrir
        </span>
        <span className="block truncate text-[12.5px] leading-snug text-soft">
          {count === 1 ? who : `${count} enveloppes : ${who}`}
        </span>
      </span>
      <Button variant="danger" className="h-11 shrink-0 rounded-xl px-3.5 text-[13.5px] font-semibold" onClick={onCover}>
        Couvrir
      </Button>
    </div>
  )
}
