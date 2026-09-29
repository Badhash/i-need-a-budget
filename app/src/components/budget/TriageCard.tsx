// Ligne « a faire » (MOBILE uniquement) de la page Budget : invite a trier les
// transactions a categoriser. Lit bootstrap.uncategorizedCount (calcule
// serveur, patche en optimiste), jamais la liste des transactions. Rien n'est
// rendu quand le compteur est a zero. Posee dans la carte des actions du mois.

import { Link } from '@tanstack/react-router'
import { ChevronRight, Inbox } from 'lucide-react'
import { useBootstrap } from '@/lib/data'

export function TriageCard() {
  const count = useBootstrap().data?.uncategorizedCount ?? 0
  if (count === 0) return null

  return (
    <Link
      to="/trier"
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors duration-150 active:bg-surface2/70 lg:hidden"
    >
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning ring-1 ring-inset ring-warning/15">
        <Inbox className="h-5 w-5" strokeWidth={2.2} />
        <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-surface tnum dark:text-bg">
          {count > 99 ? '99+' : count}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink tnum">
          {count === 1 ? '1 transaction à catégoriser' : `${count} transactions à catégoriser`}
        </span>
        <span className="block truncate text-[13px] text-soft">Un tri rapide garde le budget juste.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-soft" />
    </Link>
  )
}
