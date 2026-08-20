import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { useChartPalette } from '@/hooks/useTheme'
import { fmtEUR, fmtMonthShort } from '@/lib/format'
import type { MonthPoint } from '@/lib/analytics'
import { TrendBadge, WidgetCard } from '@/components/reports/WidgetCard'
import { Amount } from '@/components/shared/Amount'

/**
 * Widget "Entrees vs Depenses" — mobile ET desktop. Barres APPARIEES par mois :
 * forme la plus lisible pour comparer deux grandeurs mois par mois (les aires
 * superposees masquent la plus petite serie ; l'ordre fixe Entrees-a-gauche /
 * Depenses-a-droite sert d'encodage secondaire en plus de la couleur).
 * Couleurs flowIn/flowOut : paire dediee validee daltonisme (cf. themes.ts) —
 * PAS success/danger, dont l'ecart de luminosite est insuffisant en deutan.
 * Regle widget : une question, un chiffre principal (epargne du mois), une
 * tendance (vs mois precedent), un seul graphe.
 */
export function IncomeExpenseWidget({
  monthly,
  months,
  className,
}: {
  monthly: MonthPoint[]
  /** Nombre de mois affiches (6 sur mobile, 12 sur desktop). */
  months: number
  className?: string
}) {
  const palette = useChartPalette()
  const points = monthly.slice(-months)
  const chartData = points.map((m) => ({
    name: fmtMonthShort(m.month),
    'Entrées': m.income,
    'Dépenses': m.spending,
  }))
  const last = monthly[monthly.length - 1]
  const prev = monthly[monthly.length - 2]
  const net = last?.net ?? 0
  const delta = prev && prev.net !== 0 ? (net - prev.net) / Math.abs(prev.net) : 0

  return (
    <WidgetCard question="Qu'est-ce qui rentre, qu'est-ce qui sort ?" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div>
          <p className="text-[12.5px] text-soft">Épargné ce mois</p>
          <Amount cents={net} signed colored className="text-[26px] font-semibold" />
        </div>
        {prev && prev.net !== 0 && <TrendBadge delta={delta} label="vs mois précédent" />}
      </div>

      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="24%">
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11 }}
              dy={6}
              interval="preserveStartEnd"
            />
            <Tooltip
              cursor={{ fill: palette.grid, opacity: 0.35 }}
              content={<FlowTooltip inColor={palette.flowIn} outColor={palette.flowOut} />}
            />
            <Bar dataKey="Entrées" fill={palette.flowIn} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="Dépenses" fill={palette.flowOut} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legende a ordre FIXE (jamais recyclee) : l'identite ne repose pas que
          sur la couleur — position gauche/droite + libelles. */}
      <div className="flex items-center gap-5 text-[12.5px] text-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.flowIn }} />
          Entrées
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.flowOut }} />
          Dépenses
        </span>
      </div>
    </WidgetCard>
  )
}

function FlowTooltip({
  active,
  payload,
  label,
  inColor,
  outColor,
}: {
  active?: boolean
  payload?: { name: string; value: number }[]
  label?: string
  inColor: string
  outColor: string
}) {
  if (!active || !payload?.length) return null
  const income = payload.find((p) => p.name === 'Entrées')?.value ?? 0
  const spending = payload.find((p) => p.name === 'Dépenses')?.value ?? 0
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-card">
      {label && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-1.5 text-soft">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.name === 'Entrées' ? inColor : outColor }}
          />
          {entry.name} : <span className="font-medium text-ink tnum">{fmtEUR(entry.value)}</span>
        </p>
      ))}
      <p className="mt-1 border-t border-line/60 pt-1 text-soft">
        Balance :{' '}
        <span
          className="font-semibold tnum"
          style={{ color: income - spending >= 0 ? inColor : outColor }}
        >
          {income - spending > 0 ? '+' : ''}
          {fmtEUR(income - spending)}
        </span>
      </p>
    </div>
  )
}
