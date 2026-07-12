import { TriangleAlert } from 'lucide-react'
import type { BudgetMonth } from '@/lib/budget'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'
import { fmtEUR } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { cn } from '@/lib/utils'

export function RtaBanner({ budget }: { budget: BudgetMonth }) {
  const negative = budget.rta < 0
  const animated = useAnimatedNumber(budget.rta)

  return (
    <div className="sticky top-[68px] z-30">
      <div
        className={cn(
          'rounded-2xl border p-5 shadow-card backdrop-blur-md',
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
