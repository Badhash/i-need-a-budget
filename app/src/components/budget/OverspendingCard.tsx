// Carte compacte (MOBILE uniquement) sur la page Budget : signale les
// enveloppes en depassement du mois et propose de les couvrir en une action
// (l'equivalent du bouton « Couvrir les dépassements » du desktop). Rien n'est
// rendu quand aucune enveloppe n'est negative.

import { LifeBuoy } from 'lucide-react'
import { fmtEUR } from '@/lib/format'

export function OverspendingCard({
  count,
  missing,
  onCover,
}: {
  count: number
  missing: number
  onCover: () => void
}) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-danger/25 bg-danger/10 p-4 shadow-card lg:hidden">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
        <LifeBuoy className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink tnum">
          {count === 1 ? '1 enveloppe en dépassement' : `${count} enveloppes en dépassement`}
        </span>
        <span className="block text-[12.5px] text-soft tnum">
          {fmtEUR(missing)} à couvrir depuis le Prêt à assigner.
        </span>
      </span>
      <button
        type="button"
        onClick={onCover}
        className="flex min-h-[44px] shrink-0 items-center rounded-xl bg-danger px-3.5 text-[13px] font-semibold text-white transition-colors active:bg-danger/90"
      >
        Couvrir
      </button>
    </div>
  )
}
