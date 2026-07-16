import { TriangleAlert } from 'lucide-react'
import type { BudgetMonth } from '@/lib/budget'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'
import { fmtEUR } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { cn } from '@/lib/utils'

export function RtaBanner({ budget }: { budget: BudgetMonth }) {
  const negative = budget.rta < 0
  const animated = useAnimatedNumber(budget.rta)

  // Progression zero-based : quelle part des revenus du mois a deja recu une
  // affectation. base = assigne + reste a assigner (>= 0). Quand tout est
  // assigne (rta = 0), la barre est pleine. En sur-affectation (rta < 0), la
  // barre est pleine et vire au rouge (danger) pour signaler le depassement.
  const assigned = budget.totals.assigned
  const base = assigned + Math.max(budget.rta, 0)
  const ratio = negative ? 1 : base > 0 ? Math.min(assigned / base, 1) : 0
  const pct = Math.round(ratio * 100)

  return (
    <div className="sticky top-[68px] z-30">
      <div
        className={cn(
          'rounded-2xl border p-5 shadow-card',
          negative ? 'border-danger/25 bg-danger/10' : 'border-success/25 bg-success/10',
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="label-caps">Prêt à assigner</p>
            <p
              className={cn(
                'mt-0.5 text-[30px] font-semibold leading-tight tnum lg:text-[32px]',
                negative ? 'text-danger' : 'text-success',
              )}
            >
              {fmtEUR(animated)}
            </p>
          </div>
          <div className="hidden items-center gap-8 sm:flex">
            <div className="text-right">
              <p className="label-caps">Assigné ce mois</p>
              <Amount cents={budget.totals.assigned} className="mt-0.5 block text-[17px] font-semibold" />
            </div>
            <div className="text-right">
              <p className="label-caps">Dépensé ce mois</p>
              <Amount cents={-budget.totals.activity} className="mt-0.5 block text-[17px] font-semibold" />
            </div>
            <div className="text-right">
              <p className="label-caps">Disponible</p>
              <Amount cents={budget.totals.available} className="mt-0.5 block text-[17px] font-semibold" />
            </div>
          </div>
        </div>
        {/* Barre de progression pleine largeur : couleur de l'accent du THEME
            (piste = accent attenue), rouge en cas de sur-affectation. Hauteur
            genereuse pour rester lisible d'un coup d'oeil. */}
        <div className="mt-4">
          <div
            className="h-3 w-full overflow-hidden rounded-full"
            style={{
              backgroundColor: negative ? 'rgb(var(--danger) / 0.18)' : 'rgb(var(--accent) / 0.18)',
            }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{
                width: `${Math.max(ratio * 100, assigned > 0 || negative ? 4 : 0)}%`,
                backgroundColor: negative ? 'rgb(var(--danger))' : 'rgb(var(--accent))',
              }}
            />
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-2 text-[12.5px] font-medium">
            <span className={cn(negative ? 'text-danger' : 'text-soft')}>
              {negative ? 'Budget dépassé' : pct >= 100 ? 'Chaque euro a un rôle' : `${pct} % assigné`}
            </span>
            {!negative && budget.rta > 0 && (
              <span className="tnum text-soft">
                <Amount cents={budget.rta} className="font-semibold text-ink" /> à assigner
              </span>
            )}
          </div>
        </div>
        {negative && (
          <p className="mt-3 flex items-center gap-2 text-[13px] font-medium text-danger">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            Vous avez assigné plus que vos revenus disponibles. Retirez des montants de certaines enveloppes.
          </p>
        )}
      </div>
    </div>
  )
}
