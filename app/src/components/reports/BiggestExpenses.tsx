import { ChevronRight, Receipt } from 'lucide-react'
import { inMonth, type Analytics } from '@/lib/analytics'
import { fmtDateShort } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { Skeleton } from '@/components/ui/skeleton'
import { WidgetCard } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

const TOP = 5
const ROW = 'flex min-h-[3.25rem] w-full items-center gap-3 rounded-xl px-2 py-2'

/** Les plus grosses depenses du mois ; un appui ouvre la transaction. */
export function BiggestExpenses({ a, currentMonth, className }: { a: Analytics; currentMonth: string; className?: string }) {
  const setEditTx = useUiStore((s) => s.setEditTx)
  const top = a.biggest.slice(0, TOP)
  return (
    <WidgetCard
      icon={Receipt}
      question={`Mes plus grosses dépenses ${inMonth(a.reference, currentMonth)}`}
      caption="Sélectionne une dépense pour la revoir"
      className={className}
    >
      {top.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-soft">
          {a.isCurrentMonth ? 'Aucune dépense pour l’instant ce mois-ci.' : 'Aucune dépense ce mois-là.'}
        </p>
      ) : (
        <ul className="-mx-2 -my-1">
          {top.map((b) => {
            const content = (
              <>
                <GroupPill group={b.group ?? undefined} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{b.label}</span>
                  <span className="block truncate text-[12px] text-soft">
                    {fmtDateShort(b.tx.date)} · {b.categoryName ?? 'À catégoriser'}
                  </span>
                </span>
                <Amount cents={b.amount} className="shrink-0 text-[14px] font-semibold text-ink" />
              </>
            )
            return (
              <li key={b.tx.id}>
                {/* Une moitie de virement ne se modifie pas depuis le formulaire
                    (meme regle que la liste des transactions). */}
                {b.tx.transferGroupId ? (
                  <div className={ROW}>
                    {content}
                    <span aria-hidden className="w-4 shrink-0" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditTx(b.tx)}
                    className={cn(ROW, 'pressable group text-left transition-colors hover:bg-surface2/70')}
                  >
                    {content}
                    <ChevronRight
                      aria-hidden
                      className="h-4 w-4 shrink-0 text-soft/60 transition-transform duration-200 group-hover:translate-x-0.5"
                    />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}

export function BiggestExpensesSkeleton({
  reference,
  currentMonth,
  className,
}: {
  reference: string
  currentMonth: string
  className?: string
}) {
  return (
    <WidgetCard
      icon={Receipt}
      question={`Mes plus grosses dépenses ${inMonth(reference, currentMonth)}`}
      caption="Sélectionne une dépense pour la revoir"
      className={className}
    >
      <div aria-hidden className="-my-1">
        {Array.from({ length: TOP }).map((_, i) => (
          <div key={i} className="flex min-h-[3.25rem] items-center gap-3 py-2">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </WidgetCard>
  )
}
