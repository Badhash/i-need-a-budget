import { useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'
import { inMonth, REST_KEY, type Analytics, type GroupSlice } from '@/lib/analytics'
import { addMonths, fmtEUR, fmtMonthLong, fmtMonthShort, fmtMonthTitle, fmtPercent } from '@/lib/format'
import { useChartPalette } from '@/hooks/useTheme'
import type { ChartPalette } from '@/styles/themes'
import { Amount } from '@/components/shared/Amount'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionSkeleton, TrendBadge, WidgetCard } from '@/components/reports/WidgetCard'
import { chartMotion, SeriesKey, usePrefersReducedMotion } from '@/components/reports/chartKit'
import { cn } from '@/lib/utils'

// Corps a hauteur FIXE (6 lignes de legende au plus) : le squelette occupe
// exactement la meme place, rien ne bouge a l'arrivee des donnees.
const BODY = 'h-[168px] gap-4 lg:h-[196px] lg:gap-7'
// Anneau : 140px sur mobile (la legende garde la place de noms entiers), toute
// la hauteur du corps en desktop.
const RING = 'h-[140px] w-[140px] lg:h-full lg:w-auto lg:aspect-square'
const FOOTER = 'flex min-h-9 items-center justify-between gap-3 border-t border-line/70 pt-3 text-[12.5px] text-soft'
const ROW = 'h-[26px] lg:h-[30px]'
const ROWS_GAP = 'gap-[2px] lg:gap-[3px]'

function sliceColor(slice: GroupSlice, palette: ChartPalette): string {
  return slice.group ? palette.cats[slice.group.color] : palette.soft
}

function question(reference: string, currentMonth: string): string {
  if (reference === currentMonth) return 'Où part mon argent ce mois-ci ?'
  return reference < currentMonth
    ? `Où est parti mon argent en ${fmtMonthLong(reference)} ?`
    : `Où partira mon argent en ${fmtMonthLong(reference)} ?`
}

const caption = (reference: string, currentMonth: string) =>
  `Par groupe de catégories, ${inMonth(reference, currentMonth)}`

/** Repartition des depenses du mois par groupe de categories (donut + legende chiffree). */
export function SpendingDonut({ a, currentMonth }: { a: Analytics; currentMonth: string }) {
  const palette = useChartPalette()
  const reduced = usePrefersReducedMotion()
  const [active, setActive] = useState<number | null>(null)
  const slices = a.byGroup
  const current = active !== null ? slices[active] : undefined

  // Tendance vs mois precedent (a la meme date pour le mois courant).
  const ref = a.toDate ? a.toDate.spending : a.spending
  const prev = a.previousSpending
  const delta = prev !== null && prev > 0 ? (ref - prev) / prev : null
  const previousMonth = addMonths(a.reference, -1)

  return (
    <WidgetCard icon={PieIcon} question={question(a.reference, currentMonth)} caption={caption(a.reference, currentMonth)}>
      <div className={cn('flex items-center', BODY)}>
        <div className={cn('relative shrink-0', RING)}>
          {slices.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="total"
                  nameKey="label"
                  innerRadius="70%"
                  outerRadius="94%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={slices.length > 1 ? 2 : 0}
                  cornerRadius={4}
                  stroke="none"
                  activeIndex={active ?? undefined}
                  activeShape={(props: object) => {
                    const p = props as { outerRadius: number }
                    return <Sector {...props} outerRadius={p.outerRadius + 5} />
                  }}
                  onMouseEnter={(_: unknown, i: number) => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onClick={(_: unknown, i: number) => setActive((cur) => (cur === i ? null : i))}
                  {...chartMotion(reduced)}
                >
                  {slices.map((s, i) => (
                    <Cell
                      key={s.key}
                      fill={sliceColor(s, palette)}
                      fillOpacity={s.key === REST_KEY ? 0.5 : active === null || active === i ? 1 : 0.35}
                      className="cursor-pointer outline-none transition-[fill-opacity] duration-200"
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div aria-hidden className="absolute inset-[3%] rounded-full border-[14px] border-ink/[0.06] lg:border-[17px]" />
          )}
          {/* Centre : total du mois, ou la part survolee. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-5 text-center lg:px-6">
            {current ? (
              <>
                <span className="max-w-full truncate text-[11.5px] font-medium text-soft">{current.label}</span>
                <span className="text-[15px] font-semibold tracking-tight text-ink tnum lg:text-[19px]">
                  {fmtEUR(current.total)}
                </span>
                <span className="text-[11.5px] text-soft tnum">{fmtPercent(current.share)}</span>
              </>
            ) : (
              <>
                <Amount
                  cents={a.spending}
                  animate
                  className="text-[15px] font-semibold tracking-tight text-ink lg:text-[19px]"
                />
                <span className="text-[11.5px] text-soft">dépensés</span>
              </>
            )}
          </div>
        </div>

        {slices.length > 0 ? (
          <ul className={cn('flex min-w-0 flex-1 flex-col', ROWS_GAP)}>
            {slices.map((s, i) => (
              <li
                key={s.key}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-1.5 text-[13px] transition-opacity duration-200 lg:gap-2.5 lg:px-2 lg:text-[13.5px]',
                  ROW,
                  active !== null && active !== i && 'opacity-45',
                )}
              >
                <SeriesKey color={sliceColor(s, palette)} className={cn('h-2.5 w-2.5', s.key === REST_KEY && 'opacity-50')} />
                <span className="min-w-0 flex-1 truncate text-ink">{s.label}</span>
                <span className="shrink-0 text-soft tnum">{fmtPercent(s.share)}</span>
                <span className="hidden w-[5.5rem] shrink-0 text-right font-semibold text-ink tnum sm:inline">
                  {fmtEUR(s.total)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-soft">
            {a.isCurrentMonth ? 'Aucune dépense pour l’instant ce mois-ci.' : 'Aucune dépense ce mois-là.'}
          </p>
        )}
      </div>
      <div className={FOOTER}>
        <span className="min-w-0 truncate">
          {prev !== null ? (
            <>
              {fmtMonthTitle(previousMonth).replace(/ \d{4}$/, '')}
              {a.toDate ? ' à la même date' : ''}
              {'\u00a0: '}
              <Amount cents={prev} className="font-medium text-ink" />
            </>
          ) : (
            'Pas de mois précédent à comparer'
          )}
        </span>
        <TrendBadge
          delta={delta}
          downIsGood
          label={`vs ${fmtMonthShort(previousMonth)}`}
          emptyLabel="Pas de comparaison"
          className="shrink-0"
        />
      </div>
    </WidgetCard>
  )
}

export function SpendingDonutSkeleton({ reference, currentMonth }: { reference: string; currentMonth: string }) {
  return (
    <WidgetCard icon={PieIcon} question={question(reference, currentMonth)} caption={caption(reference, currentMonth)}>
      <div aria-hidden className={cn('flex items-center', BODY)}>
        <div className={cn('relative shrink-0', RING)}>
          <Skeleton className="absolute inset-[3%] rounded-full" />
          <div className="absolute inset-[18%] rounded-full bg-surface" />
        </div>
        <div className={cn('flex min-w-0 flex-1 flex-col', ROWS_GAP)}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={cn('flex items-center gap-2.5 px-2', ROW)}>
              <Skeleton className="h-2.5 w-2.5 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-9" />
              <Skeleton className="hidden h-3.5 w-[5.5rem] sm:block" />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden className={FOOTER}>
        <Skeleton className="h-3.5 w-44" />
        <ActionSkeleton />
      </div>
    </WidgetCard>
  )
}
