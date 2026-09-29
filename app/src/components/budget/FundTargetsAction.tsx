// Entree « Financer les objectifs » de la page Budget : ligne de la carte des
// actions du mois (mobile) ou bouton de la barre d'outils (desktop). Quand
// tous les objectifs du mois sont finances, l'action laisse place a un etat
// de reussite discret.

import { ChevronRight, CircleCheck, Sparkles } from 'lucide-react'
import { fmtEUR } from '@/lib/format'

export type FundStatus =
  /** Aucun objectif sur les enveloppes affichees. */
  | { kind: 'none' }
  /** Des objectifs attendent encore de l'argent ce mois-ci. */
  | { kind: 'todo'; count: number; total: number }
  /** Tous les objectifs sont finances pour le mois. */
  | { kind: 'done'; targetCount: number }

export function FundTargetsCard({ status, onFund }: { status: FundStatus; onFund: () => void }) {
  if (status.kind === 'none') return null
  if (status.kind === 'done') {
    return (
      <div className="flex min-h-[64px] animate-fade-in items-center gap-3 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success ring-1 ring-inset ring-success/15">
          <CircleCheck className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-ink">Objectifs financés</span>
          <span className="block truncate text-[13px] text-soft">
            {status.targetCount === 1
              ? 'Votre objectif est couvert ce mois-ci.'
              : `Vos ${status.targetCount} objectifs sont couverts ce mois-ci.`}
          </span>
        </span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onFund}
      className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:bg-surface2/70"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-accentfg shadow-button">
        <Sparkles className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">Financer les objectifs</span>
        <span className="block truncate text-[13px] text-soft">
          {status.count === 1 ? '1 enveloppe à compléter' : `${status.count} enveloppes à compléter`}
        </span>
      </span>
      <span className="shrink-0 text-[15px] font-semibold text-ink tnum">{fmtEUR(status.total)}</span>
      <ChevronRight className="-ml-1 h-5 w-5 shrink-0 text-soft" />
    </button>
  )
}

export function FundTargetsButton({ status, onFund }: { status: FundStatus; onFund: () => void }) {
  if (status.kind === 'none') return null
  if (status.kind === 'done') {
    return (
      <span
        className="inline-flex h-10 animate-fade-in items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium text-success"
        title="Tous les objectifs du mois sont financés"
      >
        <CircleCheck className="h-4 w-4" />
        Objectifs financés
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onFund}
      title="Assigner automatiquement le montant nécessaire aux objectifs de ce mois"
      className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium text-accent-ink transition-colors hover:bg-accent/10 dark:text-accent"
    >
      <Sparkles className="h-4 w-4" />
      <span className="hidden xl:inline">Financer les objectifs</span>
      <span className="xl:hidden">Financer</span>
      <span className="tnum text-soft">{fmtEUR(status.total)}</span>
    </button>
  )
}
