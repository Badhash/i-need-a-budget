import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarDays } from 'lucide-react'
import type { Analytics } from '@/lib/analytics'
import { fmtEUR, fmtMonthLong } from '@/lib/format'
import { useChartPalette } from '@/hooks/useTheme'
import { Amount } from '@/components/shared/Amount'
import { Skeleton } from '@/components/ui/skeleton'
import { CaptionSkeleton, InlineSkeleton, WidgetCard } from '@/components/reports/WidgetCard'
import {
  chartMotion,
  GlassTooltip,
  TooltipRow,
  useChartIds,
  usePrefersReducedMotion,
} from '@/components/reports/chartKit'
import { cn } from '@/lib/utils'

const SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const CHART_HEIGHT = 'h-36'

/**
 * Habitudes : depense moyenne par jour de semaine sur la periode, hors
 * prelevements recurrents. Emphase : le jour le plus depensier en accent
 * (degrade de marque), les autres en gris sur leur piste.
 */
export function WeekdayWidget({ a, className }: { a: Analytics; className?: string }) {
  const palette = useChartPalette()
  const reduced = usePrefersReducedMotion()
  const ids = useChartIds('peak', 'rest')
  const { average, peak, peakMerchant } = a.weekday
  const data = average.map((value, i) => ({ name: SHORT[i]!, day: LONG[i]!, value, index: i }))

  const renderTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: { payload?: { day: string; value: number; index: number } }[]
  }) => {
    const p = payload?.[0]?.payload
    if (!active || !p) return null
    return (
      <GlassTooltip title={p.day.charAt(0).toUpperCase() + p.day.slice(1)}>
        <TooltipRow
          color={p.index === peak ? palette.accent : palette.soft}
          shape="bar"
          value={fmtEUR(p.value)}
          label="en moyenne"
        />
      </GlassTooltip>
    )
  }

  return (
    <WidgetCard
      icon={CalendarDays}
      question="Quels jours je dépense le plus ?"
      caption={`Hors prélèvements récurrents, depuis ${fmtMonthLong(a.months[0] ?? a.reference)}`}
      className={className}
    >
      {peak === null ? (
        <p className="py-10 text-center text-[13.5px] text-soft">Pas encore assez d’achats pour dégager une habitude.</p>
      ) : (
        <>
          <div>
            <p className="text-[12.5px] text-soft">Ton jour le plus dépensier</p>
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[26px] font-semibold tracking-[-0.015em] text-ink">
              <span className="capitalize">{LONG[peak]}</span>
              <span className="text-[15px] font-medium text-soft">
                <Amount cents={average[peak]!} className="text-ink" /> en moyenne
              </span>
            </p>
            {peakMerchant && (
              <p className="mt-1 truncate text-[12.5px] text-soft">
                Surtout chez <span className="font-medium text-ink">{peakMerchant}</span>
              </p>
            )}
          </div>

          <div className={cn('-mx-1', CHART_HEIGHT)} aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
                <defs>
                  <linearGradient id={ids.peak} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: 'rgb(var(--accent-2))' }} />
                    <stop offset="100%" style={{ stopColor: 'rgb(var(--accent))' }} />
                  </linearGradient>
                  <linearGradient id={ids.rest} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.soft} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={palette.soft} stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  tick={{ fill: palette.soft, fontSize: 11 }}
                  dy={6}
                />
                <YAxis hide domain={[0, 'dataMax']} />
                <Tooltip content={renderTooltip as never} cursor={false} isAnimationActive={false} />
                <Bar
                  dataKey="value"
                  radius={8}
                  maxBarSize={26}
                  background={{ fill: palette.grid, radius: 8, fillOpacity: 0.55 } as never}
                  {...chartMotion(reduced)}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={i === peak ? `url(#${ids.peak})` : `url(#${ids.rest})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="sr-only">
            <table>
              <caption>Dépense moyenne par jour de la semaine</caption>
              <tbody>
                {data.map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{d.day}</th>
                    <td>{fmtEUR(d.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </WidgetCard>
  )
}

export function WeekdaySkeleton({ className }: { className?: string }) {
  return (
    <WidgetCard
      icon={CalendarDays}
      question="Quels jours je dépense le plus ?"
      caption={<CaptionSkeleton className="w-48" />}
      className={className}
    >
      <div aria-hidden>
        <p className="text-[12.5px] text-soft">Ton jour le plus dépensier</p>
        <p className="mt-0.5 text-[26px] font-semibold">
          <InlineSkeleton className="h-[0.8em] w-[6em]" />
        </p>
        <p className="mt-1 text-[12.5px]">
          <InlineSkeleton className="h-3 w-44" />
        </p>
      </div>
      <div aria-hidden className={cn('flex items-end justify-around gap-3 px-2', CHART_HEIGHT)}>
        {[0.55, 0.7, 0.45, 0.6, 0.8, 1, 0.5].map((h, i) => (
          <Skeleton key={i} className="w-6 rounded-lg" style={{ height: `${h * 85}%` }} />
        ))}
      </div>
    </WidgetCard>
  )
}
