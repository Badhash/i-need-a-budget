import { useState } from 'react'
import { ChevronDown, Repeat } from 'lucide-react'
import type { Analytics } from '@/lib/analytics'
import { fmtEUR } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MerchantAvatar } from '@/components/reports/MerchantAvatar'
import { InlineSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

const VISIBLE = 6

/**
 * Ce qui part chaque mois sans y penser : prelevements detectes sur 12 mois
 * (un passage par mois, montant stable, toujours actifs), regroupes par tiers.
 */
export function RecurringWidget({ a, className }: { a: Analytics; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const list = a.recurring
  const shown = expanded ? list : list.slice(0, VISIBLE)

  return (
    <WidgetCard
      icon={Repeat}
      question="Qu’est-ce qui part chaque mois ?"
      caption="Prélèvements réguliers détectés sur 12 mois"
      className={className}
    >
      {list.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] leading-relaxed text-soft">
          Aucun prélèvement régulier détecté sur les 12 derniers mois.
        </p>
      ) : (
        <>
          <div>
            <Amount cents={a.recurringMonthly} animate className="block text-[26px] font-semibold tracking-[-0.015em]" />
            <p className="mt-0.5 text-[12.5px] text-soft">
              par mois, soit <span className="tnum">{fmtEUR(a.recurringMonthly * 12)}</span> par an ·{' '}
              {list.length} prélèvement{list.length > 1 ? 's' : ''}
            </p>
          </div>
          <ul className="stagger -my-1 divide-y divide-line/50">
            {shown.map((r) => (
              <li key={r.key} className="flex items-center gap-3 py-2.5">
                <MerchantAvatar initial={r.initial} group={r.group} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{r.label}</p>
                  <p className="text-[12px] text-soft tnum">{fmtEUR(r.monthly * 12)} par an</p>
                </div>
                <Amount cents={r.monthly} className="shrink-0 text-[14px] font-semibold text-ink" />
              </li>
            ))}
          </ul>
          {list.length > VISIBLE && (
            <Button variant="ghost" className="w-full" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? 'Afficher moins' : `Voir les ${list.length - VISIBLE} autres`}
              <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')} />
            </Button>
          )}
        </>
      )}
    </WidgetCard>
  )
}

export function RecurringSkeleton({ className }: { className?: string }) {
  return (
    <WidgetCard
      icon={Repeat}
      question="Qu’est-ce qui part chaque mois ?"
      caption="Prélèvements réguliers détectés sur 12 mois"
      className={className}
    >
      <div aria-hidden>
        <span className="block text-[26px] font-semibold">
          <InlineSkeleton className="h-[0.8em] w-[4.5em]" />
        </span>
        <p className="mt-0.5 text-[12.5px]">
          <InlineSkeleton className="h-3 w-60 max-w-full" />
        </p>
      </div>
      <div aria-hidden className="-my-1 divide-y divide-line/50">
        {Array.from({ length: VISIBLE }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2.5">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px]">
                <InlineSkeleton className="h-3.5 w-2/5" />
              </p>
              <p className="text-[12px]">
                <InlineSkeleton className="h-3 w-20" />
              </p>
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <Skeleton aria-hidden className="h-11 w-full rounded-xl lg:h-10" />
    </WidgetCard>
  )
}
