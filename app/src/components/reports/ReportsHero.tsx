import type { ReactNode } from 'react'
import { Area, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Sprout, TrendingUp } from 'lucide-react'
import { inMonth, type Analytics } from '@/lib/analytics'
import { fmtEUR, fmtMonthShort, fmtPercent } from '@/lib/format'
import { useChartPalette } from '@/hooks/useTheme'
import { Amount } from '@/components/shared/Amount'
import { ProgressRing } from '@/components/shared/ProgressRing'
import type { ProgressTone } from '@/components/shared/ProgressBar'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BadgeSkeleton, InlineSkeleton, TrendBadge } from '@/components/reports/WidgetCard'
import {
  chartMotion,
  GlassTooltip,
  LegendChip,
  TooltipRow,
  useChartIds,
  usePrefersReducedMotion,
  useRevealNumber,
} from '@/components/reports/chartKit'
import { cn } from '@/lib/utils'

const EUROS = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

// Hauteurs fixes (squelette identique au rendu final : aucun decalage).
const CHART_HEIGHT = 'h-32 sm:h-36 lg:h-44'

function rateTone(rate: number | null): ProgressTone {
  if (rate === null) return 'neutral'
  if (rate < 0) return 'danger'
  if (rate < 0.1) return 'warning'
  return rate < 0.2 ? 'accent' : 'success'
}

interface KpiSlots {
  label: string
  value: ReactNode
  badge: ReactNode
  caption?: ReactNode
}

interface HeroSlots {
  spendingLabel: string
  spendingValue: ReactNode
  spendingBadge: ReactNode
  subline: ReactNode
  overPace?: boolean
  chart: ReactNode
  legend: ReactNode
  saved: KpiSlots
  rate: KpiSlots
}

/**
 * Mise en page UNIQUE du heros, partagee par le rendu et son squelette : memes
 * boites, memes hauteurs de ligne, donc aucun decalage a l'arrivee des
 * donnees (la phrase sous le montant reserve deux lignes sur mobile).
 */
function HeroLayout({ slots, className, busy }: { slots: HeroSlots; className?: string; busy?: boolean }) {
  return (
    <Card variant="hero" className={cn('p-5 lg:p-7', className)} aria-busy={busy || undefined}>
      <div className="lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <p className="label-caps">{slots.spendingLabel}</p>
              <div className="mt-1.5 text-ink">{slots.spendingValue}</div>
            </div>
            <div className="lg:mt-1">{slots.spendingBadge}</div>
          </div>

          <p
            className={cn(
              'mt-2 flex min-h-[2.3rem] items-start gap-1.5 text-[13.5px] leading-snug text-soft lg:min-h-0',
              slots.overPace && 'text-ink',
            )}
          >
            {slots.overPace && <TrendingUp aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
            <span>{slots.subline}</span>
          </p>

          <div className={cn('mt-4', CHART_HEIGHT)}>{slots.chart}</div>

          <div className="mt-3 flex flex-wrap gap-2">{slots.legend}</div>
        </div>

        <div className="mt-5 grid gap-5 border-t border-line/70 pt-5 lg:mt-0 lg:content-center lg:gap-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <Kpi {...slots.saved} />
          <Kpi {...slots.rate} />
        </div>
      </div>
    </Card>
  )
}

/** Indicateur du heros : libelle, valeur et tendance sur une ligne, precision dessous. */
function Kpi({ label, value, badge, caption }: KpiSlots) {
  return (
    <div className="min-w-0">
      <p className="label-caps">{label}</p>
      <div className="mt-1.5 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {value}
        {badge}
      </div>
      <p className="mt-1.5 min-h-[1.1rem] text-[12.5px] leading-snug text-soft">{caption}</p>
    </div>
  )
}

const KPI_VALUE = 'block text-[24px] font-semibold tracking-[-0.015em] lg:text-[30px]'

/**
 * Heros de la page Rapports : ce que j'ai depense (et a quel rythme, compare a
 * ma moyenne), ce que j'ai mis de cote, et mon taux d'epargne. Les chiffres
 * se revelent au montage puis suivent en douceur les changements de mois et
 * de periode.
 */
export function ReportsHero({ a, currentMonth, className }: { a: Analytics; currentMonth: string; className?: string }) {
  const when = inMonth(a.reference, currentMonth)
  const avg = a.average

  // Mois courant : on compare le cumul A DATE au cumul moyen a la meme date
  // (le mois n'est pas fini) ; mois passe : le mois complet a la moyenne.
  const spendRef = a.toDate ? a.toDate.spending : a.spending
  const spendAvg = a.toDate ? a.toDate.averageSpending : (avg?.spending ?? null)
  const spendDelta = spendAvg && spendAvg > 0 ? (spendRef - spendAvg) / spendAvg : null
  const netRef = a.toDate ? a.toDate.net : a.net
  const netAvg = a.toDate ? a.toDate.averageNet : (avg?.net ?? null)
  const rateDelta = a.savingsRate !== null && avg?.savingsRate != null ? a.savingsRate - avg.savingsRate : null

  const spent = useRevealNumber(a.spending)
  const saved = useRevealNumber(a.net)
  const ratePermille = useRevealNumber(Math.round((a.savingsRate ?? 0) * 1000))

  const overPace =
    a.projectedSpending !== null && avg !== null && avg.spending > 0 && a.projectedSpending > avg.spending * 1.05

  const subline =
    a.projectedSpending !== null ? (
      <>
        {'À ce rythme\u00a0: '}
        <span className="font-medium text-ink tnum">~{EUROS.format(a.projectedSpending / 100)}</span> d’ici la fin
        du mois
        {avg && (
          <>
            {' '}
            · moyenne <span className="tnum">{EUROS.format(avg.spending / 100)}</span>
          </>
        )}
      </>
    ) : avg ? (
      <>
        Moyenne sur {a.averageMonths.length} mois{'\u00a0: '}
        <span className="font-medium text-ink tnum">{fmtEUR(avg.spending)}</span>
      </>
    ) : (
      'Premier mois suivi\u00a0: la moyenne viendra avec l’historique.'
    )

  return (
    <HeroLayout
      className={className}
      slots={{
        spendingLabel: `Dépensé ${when}`,
        spendingValue: <Amount cents={spent} size="hero" className="block" />,
        spendingBadge: (
          <TrendBadge
            delta={spendDelta}
            downIsGood
            label={a.toDate ? 'vs moyenne à date' : 'vs moyenne'}
            emptyLabel="Pas encore de moyenne"
          />
        ),
        subline,
        overPace,
        chart: <CumulativeChart a={a} className="h-full" />,
        legend: <CumulativeLegend a={a} />,
        saved: {
          label: `Épargné ${when}`,
          value: <Amount cents={saved} signed colored className={KPI_VALUE} />,
          badge: (
            <TrendBadge
              delta={netAvg === null ? null : netRef - netAvg}
              format="amount"
              label="vs moyenne"
              emptyLabel="Pas encore de moyenne"
            />
          ),
          caption:
            a.income > 0 ? (
              <>
                sur <span className="tnum">{fmtEUR(a.income)}</span> de revenus
              </>
            ) : a.isCurrentMonth ? (
              'Pas encore de revenus ce mois-ci'
            ) : (
              'Aucun revenu ce mois-là'
            ),
        },
        rate: {
          label: 'Taux d’épargne',
          value: (
            <span className="flex items-center gap-3">
              <ProgressRing
                value={Math.max(0, a.savingsRate ?? 0)}
                tone={rateTone(a.savingsRate)}
                size={44}
                strokeWidth={5}
                label="Taux d’épargne"
              >
                <Sprout aria-hidden className="h-4 w-4 text-success" />
              </ProgressRing>
              <span className={cn(KPI_VALUE, 'tnum', a.savingsRate !== null && a.savingsRate < 0 && 'text-danger')}>
                {a.savingsRate === null ? '—' : fmtPercent(ratePermille / 1000)}
              </span>
            </span>
          ),
          badge: (
            <TrendBadge
              delta={rateDelta}
              format="points"
              label="vs moyenne"
              emptyLabel={a.savingsRate === null ? 'En attente de revenus' : 'Pas encore de moyenne'}
            />
          ),
          caption:
            avg?.savingsRate != null ? (
              <>
                moyenne <span className="tnum">{fmtPercent(avg.savingsRate)}</span> sur {a.averageMonths.length} mois
              </>
            ) : undefined,
        },
      }}
    />
  )
}

/** Squelette du heros : la MEME mise en page, des reflets a la place des chiffres. */
export function ReportsHeroSkeleton({
  reference,
  currentMonth,
  className,
}: {
  reference: string
  currentMonth: string
  className?: string
}) {
  const when = inMonth(reference, currentMonth)
  return (
    <HeroLayout
      busy
      className={className}
      slots={{
        spendingLabel: `Dépensé ${when}`,
        spendingValue: (
          <span className="num-hero block">
            <InlineSkeleton className="h-[0.8em] w-[4.6em]" />
          </span>
        ),
        spendingBadge: <BadgeSkeleton text="+00 % vs moyenne à date" />,
        subline: <InlineSkeleton className="h-3.5 w-64 max-w-full" />,
        chart: <Skeleton className="h-full rounded-2xl" />,
        legend: (
          <>
            <Skeleton className="h-[26px] w-24 rounded-full" />
            <Skeleton className="h-[26px] w-32 rounded-full" />
          </>
        ),
        saved: {
          label: `Épargné ${when}`,
          value: (
            <span className={KPI_VALUE}>
              <InlineSkeleton className="h-[0.8em] w-[4.4em]" />
            </span>
          ),
          badge: <BadgeSkeleton text="−000 € vs moyenne" />,
          caption: <InlineSkeleton className="h-3 w-40" />,
        },
        rate: {
          label: 'Taux d’épargne',
          value: (
            <span className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-full" />
              <span className={KPI_VALUE}>
                <InlineSkeleton className="h-[0.8em] w-[2.4em]" />
              </span>
            </span>
          ),
          badge: <BadgeSkeleton text="−0 pts vs moyenne" />,
          caption: <InlineSkeleton className="h-3 w-36" />,
        },
      }}
    />
  )
}

function CumulativeLegend({ a }: { a: Analytics }) {
  const palette = useChartPalette()
  return (
    <>
      <LegendChip color={palette.accent} shape="line">
        {a.isCurrentMonth ? 'Ce mois-ci' : fmtMonthShort(a.reference).replace(/^./, (c) => c.toUpperCase())}
      </LegendChip>
      {a.average && (
        <LegendChip color={palette.soft} shape="dash">
          Moyenne {a.averageMonths.length} mois
        </LegendChip>
      )}
    </>
  )
}

interface CumulTooltipProps {
  active?: boolean
  payload?: { dataKey?: string | number; value?: number | null }[]
  label?: number
}

/** Cumul des depenses jour apres jour : le mois affiche contre le mois moyen. */
function CumulativeChart({ a, className }: { a: Analytics; className?: string }) {
  const palette = useChartPalette()
  const reduced = usePrefersReducedMotion()
  const ids = useChartIds('fill', 'stroke')
  const days = a.daily.length
  const month = fmtMonthShort(a.reference)
  const last = [...a.daily].reverse().find((d) => d.current !== null)
  const lastAverage = last ? a.daily[last.day - 1]?.average ?? null : null
  const summary = last
    ? `Cumul des dépenses : ${fmtEUR(last.current ?? 0)} au ${last.day} ${month}` +
      (lastAverage !== null ? `, contre ${fmtEUR(lastAverage)} en moyenne à la même date.` : '.')
    : 'Aucune dépense ce mois-ci.'

  const renderTooltip = ({ active, payload, label }: CumulTooltipProps) => {
    if (!active || !payload?.length || label === undefined) return null
    const current = payload.find((p) => p.dataKey === 'current')?.value
    const average = payload.find((p) => p.dataKey === 'average')?.value
    return (
      <GlassTooltip title={`${label} ${month}`}>
        {current != null && (
          <TooltipRow
            color={palette.accent}
            shape="line"
            value={fmtEUR(current)}
            label={a.isCurrentMonth ? 'ce mois-ci' : `en ${month}`}
          />
        )}
        {average != null && <TooltipRow color={palette.soft} shape="dash" value={fmtEUR(average)} label="en moyenne" />}
      </GlassTooltip>
    )
  }

  return (
    <div role="img" aria-label={summary} className={cn('-mx-1', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={a.daily} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
          <defs>
            <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={palette.accent} stopOpacity={0.28} />
              <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
            </linearGradient>
            {/* Trait en degrade de marque (accent -> accent-2), en unites de
                l'utilisateur : un trait plat (mois sans depense) reste visible. */}
            <linearGradient id={ids.stroke} gradientUnits="userSpaceOnUse" x1="0%" y1="0" x2="100%" y2="0">
              <stop offset="0%" style={{ stopColor: 'rgb(var(--accent))' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--accent-2))' }} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            type="number"
            domain={[1, days]}
            ticks={[1, 15, days]}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={(props: { x: number; y: number; payload: { value: number } }) => {
              const d = props.payload.value
              // Premiere et derniere graduations calees sur les bords : jamais rognees.
              const anchor = d === 1 ? 'start' : d === days ? 'end' : 'middle'
              return (
                <text x={props.x} y={props.y} dy={14} textAnchor={anchor} fontSize={11} fill={palette.soft}>
                  {d} {month}
                </text>
              )
            }}
          />
          <YAxis hide domain={[0, (max: number) => Math.max(1, max * 1.1)]} />
          <Tooltip
            content={renderTooltip as never}
            cursor={{ stroke: palette.grid, strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {a.average && (
            <Line
              dataKey="average"
              type="monotone"
              stroke={palette.soft}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              {...chartMotion(reduced)}
            />
          )}
          <Area
            dataKey="current"
            type="monotone"
            stroke={`url(#${ids.stroke})`}
            strokeWidth={2}
            strokeLinecap="round"
            fill={`url(#${ids.fill})`}
            dot={false}
            activeDot={{ r: 4, fill: palette.accent, strokeWidth: 2, style: { stroke: 'rgb(var(--surface))' } }}
            connectNulls={false}
            {...chartMotion(reduced)}
          />
          {last && last.current !== null && (
            <ReferenceDot
              x={last.day}
              y={last.current}
              ifOverflow="visible"
              shape={(props: { cx?: number; cy?: number }) => (
                <g>
                  <circle cx={props.cx} cy={props.cy} r={9} fill={palette.accent} fillOpacity={0.18} />
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={4.5}
                    fill={palette.accent}
                    strokeWidth={2}
                    style={{ stroke: 'rgb(var(--surface))' }}
                  />
                </g>
              )}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
