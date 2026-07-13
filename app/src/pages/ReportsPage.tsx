import { useMemo } from 'react'
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { useReports, useTransactions } from '@/lib/queries'
import { useAccountsMap } from '@/lib/data'
import { parseBankLabel } from '@/lib/bankLabel'
import { useUiStore } from '@/stores/ui'
import { useChartPalette } from '@/hooks/useTheme'
import { fmtEUR, fmtMonthLong, fmtMonthShort, fmtPercent, CURRENT_MONTH } from '@/lib/format'
import type { ReportsData } from '@/lib/reports'
import { TrendBadge, WidgetCard } from '@/components/reports/WidgetCard'
import { Amount } from '@/components/shared/Amount'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-card">
      {label && <p className="mb-1 font-semibold">{label}</p>}
      {payload.map((entry) => (
        <p key={entry.name} className="text-soft">
          {entry.name} : <span className="font-medium text-ink tnum">{fmtEUR(entry.value)}</span>
        </p>
      ))}
    </div>
  )
}

function SpendingDonut({ data }: { data: ReportsData }) {
  const palette = useChartPalette()
  const delta =
    data.prevTotalSpending > 0
      ? (data.totalSpending - data.prevTotalSpending) / data.prevTotalSpending
      : 0

  return (
    <WidgetCard
      question={
        data.month === CURRENT_MONTH
          ? 'Où part mon argent ce mois-ci ?'
          : `Où part mon argent en ${fmtMonthLong(data.month)} ?`
      }
    >
      <div className="flex items-center justify-between gap-3">
        <Amount cents={data.totalSpending} className="text-[26px] font-semibold" />
        <TrendBadge delta={delta} downIsGood label="vs mois précédent" />
      </div>
      <div className="flex items-center gap-5">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.spendingByGroup.map((g) => ({ name: g.label, value: g.total }))}
                dataKey="value"
                nameKey="name"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={3}
                strokeWidth={0}
              >
                {data.spendingByGroup.map((g) => (
                  <Cell key={g.key} fill={g.color ? palette.cats[g.color] : palette.soft} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 flex-1 space-y-2">
          {data.spendingByGroup.map((g) => (
            <li key={g.key} className="flex items-center gap-2.5 text-[13px]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: g.color ? palette.cats[g.color] : palette.soft }}
              />
              <span className="min-w-0 flex-1 truncate text-soft">{g.label}</span>
              <Amount cents={g.total} className="font-medium" />
            </li>
          ))}
        </ul>
      </div>
    </WidgetCard>
  )
}

function TopMerchants({ data }: { data: ReportsData }) {
  // Calcule cote client a partir des libelles COURTS (parseBankLabel) : le
  // serveur groupe par libelle brut, ce qui eclate un meme marchand (PayPal…)
  // en dizaines d'entrees aux libelles interminables qui cassaient l'affichage
  // mobile. Ici : depenses du mois, hors transferts, groupees par marchand.
  const { data: txs } = useTransactions()
  const accountById = useAccountsMap()

  const merchants = useMemo(() => {
    const byMerchant = new Map<string, { total: number; count: number }>()
    for (const t of txs ?? []) {
      if (t.amount >= 0 || t.transferGroupId) continue
      if (t.date.slice(0, 7) !== data.month) continue
      const account = accountById.get(t.accountId)
      if (account && !account.onBudget) continue
      const key = parseBankLabel(t.label).short
      const entry = byMerchant.get(key) ?? { total: 0, count: 0 }
      entry.total -= t.amount
      entry.count += 1
      byMerchant.set(key, entry)
    }
    return [...byMerchant.entries()]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
  }, [txs, accountById, data.month])

  const list = merchants.length > 0 ? merchants : data.topMerchants
  const max = list[0]?.total ?? 1
  return (
    <WidgetCard question="Chez qui je dépense le plus ?">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[26px] font-semibold tnum">{list.length}</p>
        <p className="min-w-0 truncate text-right text-[12.5px] text-soft">
          marchands principaux · {fmtMonthLong(data.month)}
        </p>
      </div>
      <ul className="space-y-2.5">
        {list.map((m) => (
          <li key={m.label} className="relative overflow-hidden rounded-lg">
            <div
              className="absolute inset-y-0 left-0 rounded-lg bg-accent/10"
              style={{ width: `${(m.total / max) * 100}%` }}
            />
            <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
              <span className="min-w-0 flex-1 truncate font-medium">{m.label}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="whitespace-nowrap text-[11.5px] text-soft">
                  {m.count} {m.count > 1 ? 'achats' : 'achat'}
                </span>
                <Amount cents={m.total} className="font-semibold" />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </WidgetCard>
  )
}

function CashflowArea({ data }: { data: ReportsData }) {
  const palette = useChartPalette()
  const totalNet = data.cashflow.reduce((s, m) => s + m.net, 0)
  const chartData = data.cashflow.map((m) => ({
    name: fmtMonthShort(m.month),
    Revenus: m.income,
    Dépenses: m.spending,
    net: m.net,
  }))

  return (
    <WidgetCard question="Mon cash-flow tient-il sur 6 mois ?">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Amount cents={totalNet} signed colored className="text-[26px] font-semibold" />
          <p className="mt-0.5 text-[12.5px] text-soft">
            net cumulé sur 6 mois
            {data.month === CURRENT_MONTH ? ` · ${fmtMonthLong(data.month)} en cours` : ''}
          </p>
        </div>
      </div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="cashflow-income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.success} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.success} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11.5 }}
              dy={6}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="Revenus"
              stroke={palette.success}
              strokeWidth={2}
              fill="url(#cashflow-income)"
            />
            <Area
              type="monotone"
              dataKey="Dépenses"
              stroke={palette.danger}
              strokeWidth={2}
              fill="transparent"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  )
}

function SavingsRate({ data }: { data: ReportsData }) {
  const palette = useChartPalette()
  const { rate, prevRate, month, saved } = data.savingsRate
  const sparkData = data.cashflow.slice(0, -1).map((m) => ({
    name: fmtMonthShort(m.month),
    taux: m.income > 0 ? Math.max(m.net / m.income, 0) : 0,
  }))

  return (
    <WidgetCard question="Est-ce que j'épargne assez ?">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={cn('text-[26px] font-semibold tnum', rate < 0 && 'text-danger')}>
            {fmtPercent(rate)}
          </p>
          <p className="mt-0.5 text-[12.5px] text-soft">
            en {fmtMonthLong(month)} · <Amount cents={saved} signed colored className="font-medium" /> mis de côté
          </p>
        </div>
        <TrendBadge delta={rate - prevRate} label="vs mois précédent" />
      </div>
      <div className="h-24">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={sparkData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="savings-spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={0.35} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11 }}
              dy={6}
            />
            <Area
              type="monotone"
              dataKey="taux"
              stroke={palette.accent}
              strokeWidth={2}
              fill="url(#savings-spark)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  )
}

function ReportsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-72 rounded-2xl" />
      ))}
    </div>
  )
}

export function ReportsPage() {
  const month = useUiStore((s) => s.month)
  const { data } = useReports(month)

  if (!data) return <ReportsSkeleton />

  if (data.totalSpending === 0) {
    return (
      <Card>
        <EmptyState
          icon={BarChart3}
          title="Rien à analyser pour ce mois"
          description="Aucune dépense enregistrée sur cette période. Les rapports se rempliront dès que des transactions arriveront."
        />
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <SpendingDonut data={data} />
      <TopMerchants data={data} />
      <CashflowArea data={data} />
      <SavingsRate data={data} />
    </div>
  )
}
