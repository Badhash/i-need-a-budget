import { Store } from 'lucide-react'
import { inMonth, type Analytics } from '@/lib/analytics'
import { fmtMonthLong, fmtPercent } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MerchantAvatar } from '@/components/reports/MerchantAvatar'
import { ActionSkeleton, CaptionSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

const TOP = 5
// Liste a hauteur FIXE (5 lignes de 48px) : le squelette occupe exactement la
// meme place, meme si le mois compte moins de 5 marchands.
const LIST = 'min-h-[264px] gap-1.5'
const ROW = 'h-12'

function question(reference: string, currentMonth: string): string {
  if (reference === currentMonth) return 'Chez qui je dépense le plus ?'
  return reference < currentMonth
    ? `Chez qui j’ai le plus dépensé en ${fmtMonthLong(reference)} ?`
    : `Chez qui je dépenserai en ${fmtMonthLong(reference)} ?`
}

/**
 * Marchands du mois, regroupes par cle de tiers (payeeKey) : « CB CARREFOUR
 * 12/03 » et « CB CARREFOUR 15/03 » ne font qu'un, sous le nom le plus frequent.
 */
export function TopMerchants({ a, currentMonth }: { a: Analytics; currentMonth: string }) {
  const top = a.merchants.slice(0, TOP)
  const max = top[0]?.total ?? 1
  const share = a.spending > 0 ? top.reduce((s, m) => s + m.total, 0) / a.spending : 0
  const count = a.merchants.length

  return (
    <WidgetCard
      icon={Store}
      question={question(a.reference, currentMonth)}
      caption={`${count} marchand${count > 1 ? 's' : ''} ${inMonth(a.reference, currentMonth)}`}
      action={
        top.length > 0 ? (
          <Badge variant="accent" className="py-1 font-semibold">
            {top.length > 1 ? `Top ${top.length}` : 'Le seul'} · {fmtPercent(share)} des dépenses
          </Badge>
        ) : undefined
      }
    >
      <ol className={cn('flex flex-col', LIST)}>
        {top.map((m, i) => (
          <li key={m.key} className={cn('flex items-center gap-3', ROW)}>
            <MerchantAvatar initial={m.initial} group={m.group} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[14px] font-medium text-ink">
                  <span className="sr-only">{i + 1}. </span>
                  {m.label}
                </span>
                <Amount cents={m.total} className="shrink-0 text-[14px] font-semibold text-ink" />
              </div>
              <div className="mt-1.5 flex items-center gap-2.5">
                <ProgressBar value={m.total / max} tone="accent" size="sm" className="flex-1" />
                <span className="w-[4.5rem] shrink-0 text-right text-[11.5px] text-soft tnum">
                  {m.count} {m.count > 1 ? 'achats' : 'achat'}
                </span>
              </div>
            </div>
          </li>
        ))}
        {top.length === 0 && (
          <li className="flex flex-1 items-center justify-center text-center text-[13.5px] text-soft">
            {a.isCurrentMonth ? 'Aucun achat pour l’instant ce mois-ci.' : 'Aucun achat ce mois-là.'}
          </li>
        )}
      </ol>
    </WidgetCard>
  )
}

export function TopMerchantsSkeleton({ reference, currentMonth }: { reference: string; currentMonth: string }) {
  return (
    <WidgetCard
      icon={Store}
      question={question(reference, currentMonth)}
      caption={<CaptionSkeleton className="w-36" />}
      action={<ActionSkeleton className="w-40" />}
    >
      <div aria-hidden className={cn('flex flex-col', LIST)}>
        {Array.from({ length: TOP }).map((_, i) => (
          <div key={i} className={cn('flex items-center gap-3', ROW)}>
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3 w-[4.5rem]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  )
}
