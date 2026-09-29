import { useState } from 'react'
import { ChevronDown, Gauge } from 'lucide-react'
import type { Analytics, CategoryStat } from '@/lib/analytics'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CaptionSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

// Lignes affichees avant « Voir les autres » (une ligne mobile est plus haute).
const VISIBLE_DESKTOP = 8
const VISIBLE_MOBILE = 5
const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})

function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })
  return name.charAt(0).toUpperCase() + name.slice(1)
}

const thisMonthLabel = (reference: string, currentMonth: string) =>
  reference === currentMonth ? 'Ce mois-ci' : monthTitle(reference)

/**
 * Ton d'une ligne : ambre au-dessus de la moyenne (au-dela de 10 % et 10 €),
 * vert en dessous (mois termine seulement : un mois en cours n'est pas encore
 * « sous la moyenne »), accent sinon, neutre sans historique.
 */
function toneOf(c: CategoryStat, inProgress: boolean): ProgressTone {
  if (c.average <= 0) return 'neutral'
  const margin = Math.max(1_000, c.average * 0.1)
  if (c.delta > margin) return 'warning'
  if (!inProgress && c.delta < -margin) return 'success'
  return 'accent'
}

const GRID = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,2fr)_repeat(3,minmax(0,0.75fr))] items-center gap-5'

/** Ligne d'en-tete du tableau desktop (partagee avec le squelette). */
function HeaderRow({ thisLabel }: { thisLabel: string }) {
  return (
    <div role="row" className={cn(GRID, 'border-b border-line/70 pb-2')}>
      <span role="columnheader" className="label-caps">
        Catégorie
      </span>
      <span role="columnheader" className="label-caps" title="Le repère marque la moyenne">
        Face à la moyenne
      </span>
      <span role="columnheader" className="label-caps text-right">
        {thisLabel}
      </span>
      <span role="columnheader" className="label-caps text-right">
        Moyenne
      </span>
      <span role="columnheader" className="label-caps text-right">
        Écart
      </span>
    </div>
  )
}

const DELTA_TEXT: Record<ProgressTone, string> = {
  warning: 'text-warning',
  success: 'text-success',
  accent: 'text-soft',
  neutral: 'text-soft',
  danger: 'text-danger',
}

function Delta({ c, tone }: { c: CategoryStat; tone: ProgressTone }) {
  if (c.average <= 0) return <span className="text-soft">nouveau</span>
  return <span className={cn('font-medium tnum', DELTA_TEXT[tone])}>{EUROS.format(c.delta / 100)}</span>
}

/** Jauge : le mois (remplissage) face a la moyenne (repere). */
function Bar({ c, tone }: { c: CategoryStat; tone: ProgressTone }) {
  const scale = Math.max(c.thisMonth, c.average) * 1.15 || 1
  return (
    <ProgressBar
      value={c.thisMonth / scale}
      target={c.average > 0 ? c.average / scale : undefined}
      tone={tone}
      size="sm"
      label={`${c.name} : ${Math.round(c.average > 0 ? (c.thisMonth / c.average) * 100 : 100)} % de la moyenne`}
    />
  )
}

/**
 * « Où ça dérape ? » : chaque categorie du mois face a sa moyenne sur la
 * periode choisie. La jauge montre le mois, le repere la moyenne.
 */
export function CategoryBreakdown({
  a,
  currentMonth,
  isDesktop,
  className,
}: {
  a: Analytics
  currentMonth: string
  isDesktop: boolean
  className?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const rows = a.byCategory
  const visible = isDesktop ? VISIBLE_DESKTOP : VISIBLE_MOBILE
  const shown = expanded ? rows : rows.slice(0, visible)
  const inProgress = a.reference >= currentMonth
  const thisLabel = thisMonthLabel(a.reference, currentMonth)
  const caption =
    a.averageMonths.length > 0
      ? `${thisLabel} face à ta moyenne sur ${a.averageMonths.length} mois`
      : `${thisLabel}\u00a0: la moyenne viendra avec l’historique`

  return (
    <WidgetCard icon={Gauge} question="Où va l’argent, et où ça dérape ?" caption={caption} className={className}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-soft">Aucune dépense à comparer.</p>
      ) : isDesktop ? (
        <div role="table" aria-label="Dépenses par catégorie face à la moyenne" className="text-[13.5px]">
          <HeaderRow thisLabel={thisLabel} />
          <div className="stagger divide-y divide-line/50">
            {shown.map((c) => {
              const tone = toneOf(c, inProgress)
              return (
                <div key={c.id} role="row" className={cn(GRID, 'h-12')}>
                  <span role="cell" className="flex min-w-0 items-center gap-2.5">
                    <GroupPill group={c.group ?? undefined} size="sm" />
                    <span className="truncate font-medium text-ink">{c.name}</span>
                  </span>
                  <span role="cell">
                    <Bar c={c} tone={tone} />
                  </span>
                  <span role="cell" className="text-right">
                    <Amount cents={c.thisMonth} className="font-semibold text-ink" />
                  </span>
                  <span role="cell" className="text-right text-soft">
                    {c.average > 0 ? <Amount cents={c.average} /> : '—'}
                  </span>
                  <span role="cell" className="text-right">
                    <Delta c={c} tone={tone} />
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <ul className="stagger -my-1 divide-y divide-line/50">
          {shown.map((c) => {
            const tone = toneOf(c, inProgress)
            return (
              <li key={c.id} className="py-3">
                <div className="flex items-center gap-3">
                  <GroupPill group={c.group ?? undefined} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{c.name}</span>
                  <Amount cents={c.thisMonth} className="shrink-0 text-[14px] font-semibold text-ink" />
                </div>
                <div className="ml-10 mt-2">
                  <Bar c={c} tone={tone} />
                </div>
                <div className="ml-10 mt-1.5 flex items-center justify-between gap-3 text-[12px]">
                  <span className="text-soft">
                    {c.average > 0 ? (
                      <>
                        moyenne <Amount cents={c.average} />
                      </>
                    ) : (
                      'pas encore de moyenne'
                    )}
                  </span>
                  <Delta c={c} tone={tone} />
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {rows.length > visible && (
        <Button variant="ghost" className="w-full" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Afficher moins' : `Voir les ${rows.length - visible} autres catégories`}
          <ChevronDown aria-hidden className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')} />
        </Button>
      )}
    </WidgetCard>
  )
}

export function CategoryBreakdownSkeleton({
  reference,
  currentMonth,
  isDesktop,
  className,
}: {
  reference: string
  currentMonth: string
  isDesktop: boolean
  className?: string
}) {
  const rows = Array.from({ length: isDesktop ? VISIBLE_DESKTOP : VISIBLE_MOBILE })
  return (
    <WidgetCard
      icon={Gauge}
      question="Où va l’argent, et où ça dérape ?"
      caption={<CaptionSkeleton className="w-56" />}
      className={className}
    >
      {isDesktop ? (
        <div aria-hidden className="text-[13.5px]">
          <HeaderRow thisLabel={thisMonthLabel(reference, currentMonth)} />
          <div className="divide-y divide-line/50">
            {rows.map((_, i) => (
              <div key={i} className={cn(GRID, 'h-12')}>
                <span className="flex items-center gap-2.5">
                  <Skeleton className="h-7 w-7 rounded-full" />
                  <Skeleton className="h-4 w-28" />
                </span>
                <Skeleton className="h-1.5 rounded-full" />
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="ml-auto h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div aria-hidden className="-my-1 divide-y divide-line/50">
          {rows.map((_, i) => (
            <div key={i} className="py-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="ml-10 mt-2 h-1.5 rounded-full" />
              <div className="ml-10 mt-1.5 flex h-[18px] items-center justify-between">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
          ))}
        </div>
      )}
      <Skeleton aria-hidden className="h-11 w-full rounded-xl lg:h-10" />
    </WidgetCard>
  )
}
