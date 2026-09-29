import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Landmark } from 'lucide-react'
import type { Analytics } from '@/lib/analytics'
import type { AccountWithBalance } from '@/lib/data'
import { fmtEUR, fmtMonthShort, fmtMonthTitle } from '@/lib/format'
import { useChartPalette } from '@/hooks/useTheme'
import { Amount } from '@/components/shared/Amount'
import { Skeleton } from '@/components/ui/skeleton'
import { BadgeSkeleton, CaptionSkeleton, InlineSkeleton, TrendBadge, WidgetCard } from '@/components/reports/WidgetCard'
import {
  chartMotion,
  GlassTooltip,
  TooltipRow,
  useChartIds,
  usePrefersReducedMotion,
} from '@/components/reports/chartKit'
import { cn } from '@/lib/utils'

const CHART_HEIGHT = 'h-36'

interface AccountLine {
  id: string
  name: string
  balance: number
  closed: boolean
}

function AccountColumn({ title, lines }: { title: string; lines: AccountLine[] }) {
  const total = lines.reduce((s, l) => s + l.balance, 0)
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="label-caps">{title}</p>
        <Amount cents={total} className="text-[12.5px] font-semibold text-soft" />
      </div>
      <ul className="space-y-1.5">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 flex-1 truncate text-ink">
              {l.name}
              {l.closed && <span className="text-soft"> · clos</span>}
            </span>
            <Amount cents={l.balance} signed colored className="shrink-0 font-medium" />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Patrimoine (valeur nette de TOUS les comptes) fin de chaque mois de la
 * periode, et detail par compte a la fin du mois affiche.
 */
export function NetWorthWidget({
  a,
  accounts,
  className,
}: {
  a: Analytics
  accounts: AccountWithBalance[]
  className?: string
}) {
  const palette = useChartPalette()
  const reduced = usePrefersReducedMotion()
  const ids = useChartIds('wealth')
  const series = a.netWorth
  const last = series[series.length - 1]?.value ?? 0
  const first = series[0]?.value ?? 0
  const spanMonths = series.length - 1
  const data = series.map((p) => ({ ...p, label: fmtMonthShort(p.month) }))

  // Soldes a la fin du mois affiche ; un compte clos a zero n'apporte rien.
  const lines: (AccountLine & { onBudget: boolean })[] = accounts
    .map((acc) => ({
      id: acc.id,
      name: acc.name,
      balance: a.balances.get(acc.id) ?? 0,
      closed: acc.closed === true,
      onBudget: acc.onBudget,
    }))
    .filter((l) => !(l.closed && l.balance === 0))
    .sort((x, y) => y.balance - x.balance)
  const budget = lines.filter((l) => l.onBudget)
  const tracking = lines.filter((l) => !l.onBudget)

  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: { payload?: { month: string; value: number } }[] }) => {
    const p = payload?.[0]?.payload
    if (!active || !p) return null
    return (
      <GlassTooltip title={`Fin ${fmtMonthTitle(p.month).toLowerCase()}`}>
        <TooltipRow color={palette.accent} shape="line" value={fmtEUR(p.value)} label="de patrimoine" />
      </GlassTooltip>
    )
  }

  return (
    <WidgetCard
      icon={Landmark}
      question="Comment évolue mon patrimoine ?"
      caption={a.isCurrentMonth ? 'Tous comptes confondus, à ce jour' : `Tous comptes confondus, fin ${fmtMonthTitle(a.reference).toLowerCase()}`}
      action={
        <TrendBadge
          delta={spanMonths > 0 ? last - first : null}
          format="amount"
          label={`en ${spanMonths} mois`}
          emptyLabel="Pas encore d’historique"
        />
      }
      className={className}
    >
      <Amount cents={last} signed colored animate className="block text-[26px] font-semibold tracking-[-0.015em]" />

      <div className={cn('-mx-1', CHART_HEIGHT)} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id={ids.wealth} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={0.26} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11 }}
              dy={6}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip content={renderTooltip as never} cursor={{ stroke: palette.grid, strokeWidth: 1 }} isAnimationActive={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={palette.accent}
              strokeWidth={2}
              fill={`url(#${ids.wealth})`}
              dot={false}
              activeDot={{ r: 4, fill: palette.accent, strokeWidth: 2, style: { stroke: 'rgb(var(--surface))' } }}
              {...chartMotion(reduced)}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="sr-only">
        <table>
          <caption>Patrimoine en fin de mois</caption>
          <tbody>
            {series.map((p) => (
              <tr key={p.month}>
                <th scope="row">{fmtMonthTitle(p.month)}</th>
                <td>{fmtEUR(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lines.length > 0 && (
        <div className="grid gap-5 border-t border-line/70 pt-4 sm:grid-cols-2">
          {budget.length > 0 && <AccountColumn title="Comptes budget" lines={budget} />}
          {tracking.length > 0 && <AccountColumn title="Suivi" lines={tracking} />}
        </div>
      )}
    </WidgetCard>
  )
}

export function NetWorthSkeleton({ className }: { className?: string }) {
  return (
    <WidgetCard
      icon={Landmark}
      question="Comment évolue mon patrimoine ?"
      caption={<CaptionSkeleton className="w-44" />}
      action={<BadgeSkeleton text="+0 000 € en 6 mois" />}
      className={className}
    >
      <span aria-hidden className="block text-[26px] font-semibold">
        <InlineSkeleton className="h-[0.8em] w-[6em]" />
      </span>
      <Skeleton aria-hidden className={cn('rounded-2xl', CHART_HEIGHT)} />
      <div className="grid gap-5 border-t border-line/70 pt-4 sm:grid-cols-2" aria-hidden>
        {[3, 1].map((count, i) => (
          <div key={i} className="min-w-0">
            <p className="label-caps mb-2">
              <InlineSkeleton className="h-3 w-28" />
            </p>
            <ul className="space-y-1.5">
              {Array.from({ length: count }).map((_, j) => (
                <li key={j} className="flex items-center justify-between gap-3 text-[13.5px]">
                  <span>
                    <InlineSkeleton className="h-3.5 w-28" />
                  </span>
                  <span>
                    <InlineSkeleton className="h-3.5 w-20" />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </WidgetCard>
  )
}
