import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { BarChart3, Moon, Sparkles, Sprout, TrendingUp } from 'lucide-react'
import { useReports, useTransactions } from '@/lib/queries'
import { useBootstrap, type Bootstrap } from '@/lib/data'
import { parseBankLabel } from '@/lib/bankLabel'
import { useUiStore } from '@/stores/ui'
import { useChartPalette } from '@/hooks/useTheme'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { computeAnalytics, type Analytics, type TaxonomyLite } from '@/lib/analytics'
import { fmtEUR, fmtMonthLong, fmtMonthShort, fmtPercent, CURRENT_MONTH, TODAY } from '@/lib/format'
import type { ReportsData } from '@/lib/reports'
import { TrendBadge, WidgetCard } from '@/components/reports/WidgetCard'
import { Amount } from '@/components/shared/Amount'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number }[]
  label?: string
}) {
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

function buildTaxo(boot: Bootstrap): TaxonomyLite {
  return {
    onBudget: new Set(boot.accounts.filter((a) => a.onBudget).map((a) => a.id)),
    incomeCats: new Set(boot.categories.filter((c) => c.isIncome).map((c) => c.id)),
    catName: new Map(boot.categories.map((c) => [c.id, c.name])),
    catGroup: new Map(boot.categories.map((c) => [c.id, c.groupId])),
    groupName: new Map(boot.groups.map((g) => [g.id, g.name])),
    groupColor: new Map(boot.groups.map((g) => [g.id, g.color])),
  }
}

// ---------------------------------------------------------------------------
// Widgets bases sur les agregations serveur (ReportsData)
// ---------------------------------------------------------------------------

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
  const list = data.topMerchants.map((m) => ({ ...m, label: parseBankLabel(m.label).short }))
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

// ---------------------------------------------------------------------------
// Widgets bases sur l'analyse client (Analytics) — richesse desktop
// ---------------------------------------------------------------------------

function StatTile({
  label,
  children,
  sub,
}: {
  label: string
  children: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <Card className="p-4">
      <p className="label-caps">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tnum">{children}</p>
      {sub && <p className="mt-0.5 text-[12.5px] text-soft">{sub}</p>}
    </Card>
  )
}

function SuggestionCard({ title, detail, annual }: { title: string; detail: string; annual: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface2/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{title}</p>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-success/10 px-2.5 py-1 text-[12px] font-semibold text-success tnum">
          +{fmtEUR(annual)}/an
        </span>
      </div>
      <p className="text-[13px] leading-relaxed text-soft">{detail}</p>
    </div>
  )
}

// Bandeau "coach" : taux d'epargne, alerte de rythme, et suggestions chiffrees
// en economie annuelle. Ton volontairement encourageant (pas culpabilisant).
function SavingsCoach({ a }: { a: Analytics }) {
  const potential = a.suggestions.reduce((s, x) => s + x.annual, 0)
  const overPace = a.isCurrentMonth && a.avgSpending > 0 && a.projectedSpending > a.avgSpending
  const overBy = a.projectedSpending - a.avgSpending

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Sprout className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[16px] font-semibold">Coach d'épargne</p>
            <p className="text-[13px] text-soft">
              Tu épargnes {fmtPercent(a.savingsRate)} de tes revenus ce mois-ci
              {a.avgSavingsRate > 0 && ` · moyenne ${fmtPercent(a.avgSavingsRate)}`}.
            </p>
          </div>
        </div>
        {potential > 0 && (
          <div className="text-right">
            <p className="label-caps">Potentiel d'économies</p>
            <p className="text-[22px] font-semibold text-success tnum">
              {fmtEUR(potential)}
              <span className="text-[13px] font-medium text-soft"> /an</span>
            </p>
          </div>
        )}
      </div>

      {overPace && (
        <div className="flex items-start gap-2.5 rounded-xl bg-warning/10 p-3 text-[13px] text-ink">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            À ce rythme, tu finiras le mois autour de{' '}
            <span className="font-semibold tnum">{fmtEUR(a.projectedSpending)}</span> — soit{' '}
            <span className="font-semibold tnum">{fmtEUR(overBy)}</span> de plus que ta moyenne (
            {fmtEUR(a.avgSpending)}). Un petit coup de frein et tu repasses dessous.
          </p>
        </div>
      )}

      {a.suggestions.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {a.suggestions.map((s) => (
            <SuggestionCard key={s.id} title={s.title} detail={s.detail} annual={s.annual} />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl bg-success/10 p-3 text-[13px] text-ink">
          <Sparkles className="h-4 w-4 shrink-0 text-success" />
          <p>Rien à signaler : tes dépenses sont maîtrisées et régulières. Continue comme ça.</p>
        </div>
      )}
    </Card>
  )
}

// Depense mois par mois sur 12 mois glissants (revenus vs depenses).
function MonthlyTrend({ a }: { a: Analytics }) {
  const palette = useChartPalette()
  const chartData = a.monthly.map((m) => ({
    name: fmtMonthShort(m.month),
    Revenus: m.income,
    Dépenses: m.spending,
  }))
  return (
    <WidgetCard question="Revenus contre dépenses, sur 12 mois" className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div>
          <p className="text-[12.5px] text-soft">Dépense moyenne (mois complets)</p>
          <Amount cents={a.avgSpending} className="text-[22px] font-semibold" />
        </div>
        <div className="text-right">
          <p className="text-[12.5px] text-soft">Ce mois-ci</p>
          <Amount cents={a.currentSpending} className="text-[22px] font-semibold" />
        </div>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="trend-income" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.success} stopOpacity={0.3} />
                <stop offset="100%" stopColor={palette.success} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="trend-spend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={0.28} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11 }}
              dy={6}
              interval="preserveStartEnd"
            />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="Revenus" stroke={palette.success} strokeWidth={2} fill="url(#trend-income)" />
            <Area type="monotone" dataKey="Dépenses" stroke={palette.accent} strokeWidth={2} fill="url(#trend-spend)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  )
}

// Patrimoine (valeur nette) mois par mois + ventilation par compte.
function NetWorthWidget({ a }: { a: Analytics }) {
  const palette = useChartPalette()
  const boot = useBootstrap()
  const accounts = boot.data?.accounts ?? []
  const series = a.netWorth
  const current = series[series.length - 1]?.value ?? 0
  const prev = series[series.length - 2]?.value ?? 0
  const delta = prev !== 0 ? (current - prev) / Math.abs(prev) : 0
  const chartData = series.map((p) => ({ name: fmtMonthShort(p.month), Patrimoine: p.value }))
  const onBudget = accounts.filter((x) => x.onBudget)
  const tracking = accounts.filter((x) => !x.onBudget)

  const AccountList = ({ title, list }: { title: string; list: typeof accounts }) => (
    <div className="min-w-0">
      <p className="label-caps mb-1.5">{title}</p>
      <ul className="space-y-1.5">
        {list.map((acc) => (
          <li key={acc.id} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className="min-w-0 flex-1 truncate">{acc.name}</span>
            <Amount cents={acc.balance} signed colored className="shrink-0 font-medium" />
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <WidgetCard question="Comment évolue mon patrimoine ?" className="lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Amount cents={current} signed colored className="text-[26px] font-semibold" />
        {prev !== 0 && <TrendBadge delta={delta} label="vs mois précédent" />}
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="networth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.accent} stopOpacity={0.3} />
                <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: palette.soft, fontSize: 11 }}
              dy={6}
              interval="preserveStartEnd"
            />
            <Tooltip content={<ChartTooltip />} />
            <Area type="monotone" dataKey="Patrimoine" stroke={palette.accent} strokeWidth={2} fill="url(#networth)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid gap-4 border-t border-line/60 pt-3 sm:grid-cols-2">
        {onBudget.length > 0 && <AccountList title="Comptes budget" list={onBudget} />}
        {tracking.length > 0 && <AccountList title="Hors budget" list={tracking} />}
      </div>
    </WidgetCard>
  )
}

// Tableau des categories : ce mois vs moyenne, avec l'ecart colore (les postes
// "qui derapent" sautent aux yeux).
function CategoryTable({ a }: { a: Analytics }) {
  const palette = useChartPalette()
  const rows = a.byCategory.filter((c) => c.thisMonth > 0 || c.avgRecent > 0).slice(0, 12)
  return (
    <WidgetCard question="Où va l'argent, et où ça dérape ?" className="lg:col-span-2">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-soft">
            <th className="py-2 text-left label-caps font-medium">Catégorie</th>
            <th className="py-2 text-right label-caps font-medium">Ce mois</th>
            <th className="py-2 text-right label-caps font-medium">Moyenne</th>
            <th className="py-2 text-right label-caps font-medium">Écart</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="border-b border-line/50 last:border-0">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: c.color ? palette.cats[c.color] : palette.soft }}
                  />
                  <span className="truncate font-medium">{c.name}</span>
                </span>
              </td>
              <td className="py-2 text-right">
                <Amount cents={c.thisMonth} />
              </td>
              <td className="py-2 text-right text-soft">
                <Amount cents={c.avgRecent} />
              </td>
              <td className="py-2 text-right">
                {c.avgRecent > 0 ? (
                  <span className={cn('tnum font-medium', c.deltaVsAvg > 0 ? 'text-danger' : 'text-success')}>
                    {c.deltaVsAvg > 0 ? '+' : ''}
                    {fmtEUR(c.deltaVsAvg)}
                  </span>
                ) : (
                  <span className="text-soft/60">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </WidgetCard>
  )
}

function Subscriptions({ a }: { a: Analytics }) {
  return (
    <WidgetCard question="Mes abonnements récurrents">
      {a.subscriptions.length === 0 ? (
        <p className="py-4 text-[13px] text-soft">
          Aucun prélèvement mensuel régulier détecté sur les 12 derniers mois.
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <Amount cents={a.subscriptionsMonthly} className="text-[26px] font-semibold" />
            <p className="text-right text-[12.5px] text-soft">
              par mois · <span className="tnum">{fmtEUR(a.subscriptionsMonthly * 12)}</span>/an
            </p>
          </div>
          <ul className="space-y-2">
            {a.subscriptions.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-[13.5px]">
                <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[11.5px] text-soft">{s.months} mois</span>
                  <Amount cents={s.monthly} className="font-semibold" />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  )
}

function BiggestTx({ a }: { a: Analytics }) {
  return (
    <WidgetCard question="Mes plus grosses dépenses ce mois">
      {a.biggest.length === 0 ? (
        <p className="py-4 text-[13px] text-soft">Aucune dépense ce mois-ci.</p>
      ) : (
        <ul className="space-y-2.5">
          {a.biggest.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.label}</span>
                <span className="text-[11.5px] text-soft">
                  {new Date(t.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                  {t.categoryName ? ` · ${t.categoryName}` : ''}
                </span>
              </span>
              <Amount cents={t.amount} className="shrink-0 font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function WeekdaySpend({ a }: { a: Analytics }) {
  const palette = useChartPalette()
  const data = a.weekday.map((v, i) => ({ name: WEEKDAYS[i], value: v }))
  const maxIdx = a.weekday.reduce((best, v, i) => (v > a.weekday[best]! ? i : best), 0)
  return (
    <WidgetCard question="Quels jours je dépense le plus ?">
      <p className="text-[13px] text-soft">
        En moyenne, tu dépenses le plus le{' '}
        <span className="font-medium text-ink">{['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'][maxIdx]}</span>.
      </p>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: palette.soft, fontSize: 11 }} dy={6} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={i === maxIdx ? palette.accent : palette.soft} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Zakat (independant du mois affiche)
// ---------------------------------------------------------------------------

const ZAKAT_RATE = 0.025
const ZAKAT_RATE_SOLAR = 0.02577
const USER_RATE = 0.03
const NISAB_KEY = 'inab-zakat-nisab'
const ZAKAT_DATE_KEY = 'inab-zakat-date'

function readLS(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function eurToCents(input: string): number {
  const cleaned = input.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '')
  const val = Number.parseFloat(cleaned)
  return Number.isFinite(val) ? Math.round(val * 100) : 0
}

function ZakatWidget() {
  const { data: txs } = useTransactions()
  const [date, setDate] = useState(() => readLS(ZAKAT_DATE_KEY, `${TODAY.slice(0, 4)}-01-01`))
  const [nisab, setNisab] = useState(() => readLS(NISAB_KEY, ''))

  const setDatePersist = (v: string) => {
    setDate(v)
    try {
      localStorage.setItem(ZAKAT_DATE_KEY, v)
    } catch {
      /* stockage indisponible */
    }
  }
  const setNisabPersist = (v: string) => {
    setNisab(v)
    try {
      localStorage.setItem(NISAB_KEY, v)
    } catch {
      /* idem */
    }
  }

  const base = useMemo(() => {
    let sum = 0
    for (const t of txs ?? []) {
      if (t.date <= date) sum += t.amount
    }
    return sum
  }, [txs, date])

  const nisabCents = eurToCents(nisab)
  const hasNisab = nisabCents > 0
  const belowNisab = hasNisab && base < nisabCents
  const zakatBase = base > 0 && !belowNisab ? base : 0
  const due = Math.round(zakatBase * ZAKAT_RATE)

  const inputClass =
    'h-10 rounded-xl border border-line bg-surface px-3 text-[15px] text-ink outline-none transition-colors focus:border-accent'

  return (
    <WidgetCard question="Combien de Zakat dois-je verser ?">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Amount cents={due} className="text-[26px] font-semibold" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent">
          <Moon className="h-3.5 w-3.5" />
          2,5 % du net
        </span>
      </div>

      {belowNisab ? (
        <p className="text-[13px] text-soft">
          En dessous du nisab (<span className="tnum">{fmtEUR(nisabCents)}</span>) au{' '}
          {new Date(date).toLocaleDateString('fr-FR')} : aucune zakât due.
        </p>
      ) : (
        <p className="text-[13px] text-soft">
          Sur une valeur nette de <Amount cents={base} className="font-medium text-ink" /> au{' '}
          {new Date(date).toLocaleDateString('fr-FR')}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Date de calcul</span>
          <input type="date" value={date} max={TODAY} onChange={(e) => setDatePersist(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label-caps">Nisab (85 g d'or, €)</span>
          <input
            type="text"
            inputMode="decimal"
            value={nisab}
            placeholder="ex. 6 000"
            onChange={(e) => setNisabPersist(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-1.5 border-t border-line/60 pt-3 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-soft">Année solaire (2,577 %)</span>
          <Amount cents={Math.round(zakatBase * ZAKAT_RATE_SOLAR)} className="font-medium" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-soft">Ta méthode (3 %)</span>
          <Amount cents={Math.round((base > 0 ? base : 0) * USER_RATE)} className="font-medium" />
        </div>
      </div>

      {!hasNisab && (
        <p className="text-[12px] text-soft/80">
          Renseigne le nisab (valeur de 85 g d'or du moment) pour savoir si tu dépasses le seuil.
        </p>
      )}
    </WidgetCard>
  )
}

// ---------------------------------------------------------------------------
// Squelette / vues mobile & desktop
// ---------------------------------------------------------------------------

function ReportsSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-72 rounded-2xl" />
      ))}
    </div>
  )
}

// MOBILE : volontairement minimal. L'essentiel en un coup d'oeil, aucun graphe.
function MobileReports({ a, report }: { a: Analytics | null; report: ReportsData | undefined }) {
  const palette = useChartPalette()
  if (!a) return <ReportsSkeleton />
  const trend = a.avgSpending > 0 ? (a.currentSpending - a.avgSpending) / a.avgSpending : 0
  const top3 = a.byCategory.filter((c) => c.thisMonth > 0).slice(0, 3)
  const maxTop = top3[0]?.thisMonth ?? 1
  const tip = a.suggestions[0]
  const nw = a.netWorth[a.netWorth.length - 1]?.value ?? 0
  const nwPrev = a.netWorth[a.netWorth.length - 2]?.value ?? 0
  const nwDelta = nwPrev !== 0 ? (nw - nwPrev) / Math.abs(nwPrev) : 0

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-5">
        <p className="label-caps">Dépensé ce mois</p>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Amount cents={a.currentSpending} className="text-[32px] font-semibold" />
          {a.avgSpending > 0 && <TrendBadge delta={trend} downIsGood label="vs ta moyenne" />}
        </div>
        {a.isCurrentMonth && a.projectedSpending > 0 && (
          <p className="text-[13px] text-soft">
            Projection fin de mois : <span className="font-medium text-ink tnum">{fmtEUR(a.projectedSpending)}</span>
          </p>
        )}
      </Card>

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="label-caps">Taux d'épargne</p>
          <p className={cn('mt-1 text-[26px] font-semibold tnum', a.savingsRate < 0 && 'text-danger')}>
            {fmtPercent(a.savingsRate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12.5px] text-soft">mis de côté</p>
          <Amount cents={a.currentIncome - a.currentSpending} signed colored className="text-[18px] font-semibold" />
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="label-caps">Patrimoine</p>
          <Amount cents={nw} signed colored className="mt-1 text-[26px] font-semibold" />
        </div>
        {nwPrev !== 0 && <TrendBadge delta={nwDelta} label="vs mois dernier" />}
      </Card>

      {top3.length > 0 && (
        <Card className="flex flex-col gap-3 p-5">
          <p className="label-caps">Top catégories ce mois</p>
          <ul className="space-y-2.5">
            {top3.map((c) => (
              <li key={c.id} className="relative overflow-hidden rounded-lg">
                <div
                  className="absolute inset-y-0 left-0 rounded-lg opacity-15"
                  style={{
                    width: `${(c.thisMonth / maxTop) * 100}%`,
                    backgroundColor: c.color ? palette.cats[c.color] : palette.soft,
                  }}
                />
                <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <Amount cents={c.thisMonth} className="font-semibold" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tip && (
        <Card className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <p className="font-semibold">{tip.title}</p>
          </div>
          <p className="text-[13px] leading-relaxed text-soft">{tip.detail}</p>
          <p className="text-[13px] font-semibold text-success tnum">
            Jusqu'à {fmtEUR(tip.annual)} d'économies sur l'année.
          </p>
        </Card>
      )}

      {report && report.totalSpending === 0 && (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="Rien à analyser pour ce mois"
            description="Les rapports se rempliront dès que des transactions arriveront."
          />
        </Card>
      )}

      <ZakatWidget />
    </div>
  )
}

// DESKTOP : carte blanche. Stats dans tous les sens + coach d'epargne.
function DesktopReports({ a, report }: { a: Analytics | null; report: ReportsData | undefined }) {
  if (!a) return <ReportsSkeleton />
  const net = a.currentIncome - a.currentSpending
  return (
    <div className="space-y-5">
      <SavingsCoach a={a} />

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Dépensé ce mois"
          sub={a.avgSpending > 0 ? <>moyenne {fmtEUR(a.avgSpending)}</> : undefined}
        >
          <Amount cents={a.currentSpending} />
        </StatTile>
        <StatTile label="Revenus ce mois">
          <Amount cents={a.currentIncome} />
        </StatTile>
        <StatTile label="Épargné ce mois">
          <Amount cents={net} signed colored />
        </StatTile>
        <StatTile
          label="Taux d'épargne"
          sub={a.avgSavingsRate > 0 ? <>moyenne {fmtPercent(a.avgSavingsRate)}</> : undefined}
        >
          <span className={cn(a.savingsRate < 0 && 'text-danger')}>{fmtPercent(a.savingsRate)}</span>
        </StatTile>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <NetWorthWidget a={a} />
        <MonthlyTrend a={a} />
        {report && <SpendingDonut data={report} />}
        <WeekdaySpend a={a} />
        <CategoryTable a={a} />
        <Subscriptions a={a} />
        <BiggestTx a={a} />
        {report && <TopMerchants data={report} />}
        <ZakatWidget />
      </div>
    </div>
  )
}

export function ReportsPage() {
  const month = useUiStore((s) => s.month)
  const { data: report } = useReports(month)
  const { data: txs } = useTransactions()
  const boot = useBootstrap()
  const isDesktop = useIsDesktop()

  const analytics = useMemo(() => {
    if (!txs || !boot.data) return null
    return computeAnalytics(txs, buildTaxo(boot.data), month, TODAY)
  }, [txs, boot.data, month])

  return isDesktop ? (
    <DesktopReports a={analytics} report={report} />
  ) : (
    <MobileReports a={analytics} report={report} />
  )
}
