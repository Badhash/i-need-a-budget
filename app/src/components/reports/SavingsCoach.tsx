import { Coffee, Repeat, Scissors, Sparkles, Sprout, TrendingUp, type LucideIcon } from 'lucide-react'
import { fmtMonthLong, fmtPercent } from '@/lib/format'
import type { Analytics, SuggestionKind } from '@/lib/analytics'
import { Amount } from '@/components/shared/Amount'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const KIND_ICON: Record<SuggestionKind, LucideIcon> = {
  subscriptions: Repeat,
  rise: TrendingUp,
  trim: Scissors,
  habit: Coffee,
}

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function headline(a: Analytics): string {
  const when = a.isCurrentMonth ? 'Ce mois-ci' : `En ${fmtMonthLong(a.reference)}`
  if (a.savingsRate === null) {
    return a.isCurrentMonth ? 'Tes revenus du mois ne sont pas encore arrivés.' : `${when}, aucun revenu n’a été enregistré.`
  }
  if (a.savingsRate < 0) {
    return `${when}, tes dépenses ont dépassé tes revenus de ${EUROS.format(-a.net / 100)}.`
  }
  const avg = a.average?.savingsRate
  return (
    `${when}, tu as mis de côté ${fmtPercent(a.savingsRate)} de tes revenus` +
    (avg != null ? ` (moyenne ${fmtPercent(avg)}).` : '.')
  )
}

/**
 * Coach d'epargne : ou j'en suis, et des idees chiffrees (economie annuelle)
 * pour faire mieux. Ton encourageant, jamais culpabilisant. Mobile : idees en
 * carrousel horizontal ; desktop : grille.
 */
export function SavingsCoach({ a, className }: { a: Analytics; className?: string }) {
  const potential = a.suggestions.reduce((s, x) => s + x.annual, 0)
  return (
    <Card className={cn('p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="bg-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-accentfg shadow-glow">
            <Sprout className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-snug tracking-tight text-ink">Coach d’épargne</h3>
            <p className="mt-0.5 text-[13px] leading-snug text-soft">{headline(a)}</p>
          </div>
        </div>
        {potential > 0 && (
          <div className="text-left sm:text-right">
            <p className="label-caps">Jusqu’à</p>
            <p className="text-[20px] font-semibold leading-tight tracking-tight text-success">
              <Amount cents={potential} animate />
              <span className="text-[13px] font-medium text-soft"> par an</span>
            </p>
          </div>
        )}
      </div>

      {a.suggestions.length > 0 ? (
        <ul
          aria-label="Idées d’économies"
          className="-mx-5 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 scrollbar-none lg:mx-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {a.suggestions.map((s) => {
            const Icon = KIND_ICON[s.kind]
            return (
              <li
                key={s.id}
                className="flex w-[84%] max-w-[22rem] shrink-0 snap-start flex-col gap-2 rounded-2xl bg-surface2/60 p-4 ring-1 ring-inset ring-edge lg:w-auto lg:max-w-none"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-accent-ink shadow-card ring-1 ring-inset ring-edge dark:text-accent"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="min-w-0 flex-1 pt-1 text-[14px] font-semibold leading-snug text-ink">{s.title}</p>
                </div>
                <p className="flex-1 text-[13px] leading-relaxed text-soft">{s.detail}</p>
                <Badge variant="success" className="self-start py-1 font-semibold">
                  +{EUROS.format(s.annual / 100)} par an
                </Badge>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-success/10 p-3 text-[13px] text-ink">
          <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-success" />
          <p>Rien à signaler : tes dépenses sont maîtrisées et régulières. Continue comme ça.</p>
        </div>
      )}
    </Card>
  )
}

export function SavingsCoachSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('p-5', className)} aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3.5 w-72 max-w-full" />
        </div>
      </div>
      <div className="-mx-5 mt-4 flex gap-3 overflow-hidden px-5 lg:mx-0 lg:grid lg:grid-cols-2 lg:px-0">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[9.5rem] w-[84%] max-w-[22rem] shrink-0 rounded-2xl lg:w-auto lg:max-w-none" />
        ))}
      </div>
    </Card>
  )
}
