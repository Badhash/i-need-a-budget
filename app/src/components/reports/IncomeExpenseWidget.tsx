import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeftRight } from 'lucide-react'
import { useChartPalette } from '@/hooks/useTheme'
import { fmtEUR, fmtEURSigned, fmtMonthShort, fmtMonthTitle } from '@/lib/format'
import type { Averages, MonthPoint } from '@/lib/analytics'
import { Amount } from '@/components/shared/Amount'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionSkeleton, CaptionSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import {
  chartMotion,
  GlassTooltip,
  LegendChip,
  TooltipRow,
  useChartIds,
  usePrefersReducedMotion,
} from '@/components/reports/chartKit'
import { cn } from '@/lib/utils'

const CHART_HEIGHT = 'h-44'

/**
 * Widget « Entrees vs Depenses » — mobile ET desktop. Barres APPARIEES par mois :
 * forme la plus lisible pour comparer deux grandeurs mois par mois (les aires
 * superposees masquent la plus petite serie ; l'ordre fixe Entrees-a-gauche /
 * Depenses-a-droite sert d'encodage secondaire en plus de la couleur).
 * Couleurs flowIn/flowOut : paire dediee validee daltonisme (cf. themes.ts) —
 * PAS success/danger, dont l'ecart de luminosite est insuffisant en deutan.
 * Chiffre principal : l'epargne MOYENNE de la periode ; le mois affiche est
 * mis en avant sur l'axe, la depense moyenne tracee en pointilles.
 */
export function IncomeExpenseWidget({
  monthly,
  months,
  reference,
  average,
  averageCount,
  className,
}: {
  monthly: MonthPoint[]
  /** Nombre de mois affiches (les plus recents). */
  months: number
  /** Mois mis en avant (defaut : le plus recent). */
  reference?: string
  /** Moyennes de la periode (defaut : calculees sur les mois precedant le dernier). */
  average?: Averages | null
  averageCount?: number
  className?: string
}) {
  const palette = useChartPalette()
  const reduced = usePrefersReducedMotion()
  const ids = useChartIds('in', 'out')
  const points = monthly.slice(-months)
  const ref = reference ?? points[points.length - 1]?.month
  const past = points.filter((p) => p.month !== ref)
  const avg =
    average !== undefined
      ? average
      : past.length > 0
        ? (() => {
            const income = Math.round(past.reduce((s, p) => s + p.income, 0) / past.length)
            const spending = Math.round(past.reduce((s, p) => s + p.spending, 0) / past.length)
            return { income, spending, net: income - spending, savingsRate: null }
          })()
        : null
  const count = averageCount ?? past.length
  const refPoint = points.find((p) => p.month === ref)
  // Meilleur mois de la fenetre (celui ou l'on a le plus mis de cote).
  const best = points.length > 1 ? points.reduce((b, p) => (p.net > b.net ? p : b), points[0]!) : null

  const data = points.map((p) => ({ ...p, label: fmtMonthShort(p.month) }))
  const refLabel = ref ? fmtMonthShort(ref) : ''
  const barSize = points.length > 8 ? 10 : 14

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: MonthPoint }[] }) => {
    const p = payload?.[0]?.payload
    if (!active || !p) return null
    return (
      <GlassTooltip title={fmtMonthTitle(p.month)}>
        <TooltipRow color={palette.flowIn} shape="bar" value={fmtEUR(p.income)} label="entrées" />
        <TooltipRow color={palette.flowOut} shape="bar" value={fmtEUR(p.spending)} label="dépenses" />
        <p className="mt-1.5 border-t border-line/60 pt-1.5 text-soft">
          Solde <span className="font-semibold text-ink tnum">{fmtEURSigned(p.net)}</span>
        </p>
      </GlassTooltip>
    )
  }

  return (
    <WidgetCard
      icon={ArrowLeftRight}
      question="Qu’est-ce qui rentre, qu’est-ce qui sort ?"
      caption={count > 0 ? `En moyenne sur ${count} mois` : 'Le mois affiché, en attendant l’historique'}
      action={
        best && best.net > 0 ? (
          <Badge variant="success" className="py-1 font-semibold">
            Meilleur mois : {fmtMonthShort(best.month)}
          </Badge>
        ) : undefined
      }
      className={className}
    >
      <div>
        <p className="text-[12.5px] text-soft">{avg ? 'Mis de côté par mois, en moyenne' : 'Mis de côté ce mois-là'}</p>
        <Amount
          cents={avg ? avg.net : (refPoint?.net ?? 0)}
          signed
          colored
          animate
          className="mt-0.5 block text-[26px] font-semibold tracking-[-0.015em]"
        />
        {avg && (
          <p className="mt-1 text-[12.5px] text-soft">
            <span className="tnum">{fmtEUR(avg.income)}</span> d’entrées pour{' '}
            <span className="tnum">{fmtEUR(avg.spending)}</span> de dépenses
          </p>
        )}
      </div>

      <div className={cn('-mx-1', CHART_HEIGHT)} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: 4, bottom: 0 }} barGap={3} barCategoryGap="26%">
            <defs>
              <linearGradient id={ids.in} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.flowIn} stopOpacity={1} />
                <stop offset="100%" stopColor={palette.flowIn} stopOpacity={0.62} />
              </linearGradient>
              <linearGradient id={ids.out} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.flowOut} stopOpacity={1} />
                <stop offset="100%" stopColor={palette.flowOut} stopOpacity={0.62} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval={0}
              dy={6}
              tick={(props: { x: number; y: number; payload: { value: string } }) => {
                const isRef = props.payload.value === refLabel
                return (
                  <text
                    x={props.x}
                    y={props.y}
                    dy={8}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={isRef ? 600 : 400}
                    fill={isRef ? 'rgb(var(--ink))' : palette.soft}
                    style={{ fill: isRef ? 'rgb(var(--ink))' : palette.soft }}
                  >
                    {props.payload.value}
                  </text>
                )
              }}
            />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip
              content={renderTooltip as never}
              cursor={{ fill: palette.grid, opacity: 0.45, radius: 8 } as never}
              isAnimationActive={false}
            />
            {avg && avg.spending > 0 && (
              <ReferenceLine y={avg.spending} stroke={palette.soft} strokeDasharray="4 4" strokeWidth={1.25} ifOverflow="extendDomain" />
            )}
            <Bar dataKey="income" name="Entrées" fill={`url(#${ids.in})`} radius={[4, 4, 0, 0]} maxBarSize={barSize} {...chartMotion(reduced)} />
            <Bar dataKey="spending" name="Dépenses" fill={`url(#${ids.out})`} radius={[4, 4, 0, 0]} maxBarSize={barSize} {...chartMotion(reduced)} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legende a ordre FIXE (jamais recyclee) : l'identite ne repose pas que
          sur la couleur — position gauche/droite + libelles. */}
      <div className="flex flex-wrap gap-2">
        <LegendChip color={palette.flowIn} shape="bar">
          Entrées
        </LegendChip>
        <LegendChip color={palette.flowOut} shape="bar">
          Dépenses
        </LegendChip>
        {avg && avg.spending > 0 && (
          <LegendChip color={palette.soft} shape="dash">
            Dépenses moyennes
          </LegendChip>
        )}
      </div>

      {/* Vue tableau (lecteurs d'ecran) : chaque valeur reste lisible sans survol. */}
      <div className="sr-only">
        <table>
          <caption>Entrées et dépenses par mois</caption>
          <thead>
            <tr>
              <th scope="col">Mois</th>
              <th scope="col">Entrées</th>
              <th scope="col">Dépenses</th>
              <th scope="col">Solde</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month}>
                <th scope="row">{fmtMonthTitle(p.month)}</th>
                <td>{fmtEUR(p.income)}</td>
                <td>{fmtEUR(p.spending)}</td>
                <td>{fmtEURSigned(p.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </WidgetCard>
  )
}

export function IncomeExpenseSkeleton({ className }: { className?: string }) {
  return (
    <WidgetCard
      icon={ArrowLeftRight}
      question="Qu’est-ce qui rentre, qu’est-ce qui sort ?"
      caption={<CaptionSkeleton className="w-36" />}
      action={<ActionSkeleton className="w-36" />}
      className={className}
    >
      <div aria-hidden>
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="mt-1.5 h-8 w-40" />
        <Skeleton className="mt-1.5 h-3.5 w-56" />
      </div>
      <Skeleton className={cn('rounded-2xl', CHART_HEIGHT)} />
      <div className="flex gap-2" aria-hidden>
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-36 rounded-full" />
      </div>
    </WidgetCard>
  )
}
