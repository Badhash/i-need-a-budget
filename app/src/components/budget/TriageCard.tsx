// Carte compacte (MOBILE uniquement) sur la page Budget : invite a trier les
// transactions a categoriser. Lit bootstrap.uncategorizedCount (calcule
// serveur, patche en optimiste), jamais la liste des transactions. Rien n'est
// rendu quand le compteur est a zero.

import { Link } from '@tanstack/react-router'
import { ChevronRight, Inbox } from 'lucide-react'
import { useBootstrap } from '@/lib/data'

export function TriageCard() {
  const count = useBootstrap().data?.uncategorizedCount ?? 0
  if (count === 0) return null

  return (
    <Link
      to="/trier"
      className="flex items-center gap-3 rounded-2xl border border-warning/25 bg-warning/10 p-4 shadow-card transition-colors active:bg-warning/15 lg:hidden"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
        <Inbox className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink tnum">
          {count === 1 ? '1 transaction à catégoriser' : `${count} transactions à catégoriser`}
        </span>
        <span className="block text-[12.5px] text-soft">Un tri rapide garde ton budget juste.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-soft" />
    </Link>
  )
}
