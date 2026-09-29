import { useMemo } from 'react'
import { BarChart3, CalendarClock, CloudOff } from 'lucide-react'
import { useTransactions } from '@/lib/queries'
import { useAccountsList, useBootstrap, useServerFeatures } from '@/lib/data'
import { SERVER_FEATURES } from '@/lib/features'
import { useUiStore } from '@/stores/ui'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { computeAnalytics, taxonomyFrom, type Analytics } from '@/lib/analytics'
import { fmtMonthLong, today } from '@/lib/format'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { comparisonPhrase, PeriodToolbar, useReportPeriod } from '@/components/reports/PeriodToolbar'
import { ReportsHero, ReportsHeroSkeleton } from '@/components/reports/ReportsHero'
import { SavingsCoach, SavingsCoachSkeleton } from '@/components/reports/SavingsCoach'
import { SpendingDonut, SpendingDonutSkeleton } from '@/components/reports/SpendingDonut'
import { TopMerchants, TopMerchantsSkeleton } from '@/components/reports/TopMerchants'
import { CategoryBreakdown, CategoryBreakdownSkeleton } from '@/components/reports/CategoryBreakdown'
import { IncomeExpenseSkeleton, IncomeExpenseWidget } from '@/components/reports/IncomeExpenseWidget'
import { NetWorthSkeleton, NetWorthWidget } from '@/components/reports/NetWorthWidget'
import { WeekdaySkeleton, WeekdayWidget } from '@/components/reports/WeekdayWidget'
import { RecurringSkeleton, RecurringWidget } from '@/components/reports/RecurringWidget'
import { BiggestExpenses, BiggestExpensesSkeleton } from '@/components/reports/BiggestExpenses'
import { ZakatWidget } from '@/components/reports/ZakatWidget'

// Page Rapports : TOUT est calcule cote client depuis le cache des
// transactions (lib/analytics.ts), sans appel reseau ni au changement de mois
// ni au changement de periode : la page suit instantanement les mises a jour
// optimistes (categorisation, ajout) et ne relit jamais l'historique serveur.
// Les virements budget <-> suivi ne comptent qu'avec un serveur qui annonce
// crossBudgetTransfers (sinon : comportement historique, virements neutres).

interface LayoutProps {
  a: Analytics
  currentMonth: string
  isDesktop: boolean
}

// DESKTOP : heros pleine largeur, coach, puis grille de widgets par paires
// (repartition du mois, derapages, tendances, habitudes).
function DesktopReports({ a, currentMonth, isDesktop }: LayoutProps) {
  const accounts = useAccountsList()
  return (
    <div className="stagger grid gap-5 lg:grid-cols-2">
      <ReportsHero a={a} currentMonth={currentMonth} className="lg:col-span-2" />
      <SavingsCoach a={a} className="lg:col-span-2" />
      <SpendingDonut a={a} currentMonth={currentMonth} />
      <TopMerchants a={a} currentMonth={currentMonth} />
      <CategoryBreakdown a={a} currentMonth={currentMonth} isDesktop={isDesktop} className="lg:col-span-2" />
      <IncomeExpenseWidget
        monthly={a.monthly}
        months={a.monthly.length}
        reference={a.reference}
        average={a.average}
        averageCount={a.averageMonths.length}
      />
      <NetWorthWidget a={a} accounts={accounts} />
      <WeekdayWidget a={a} />
      <RecurringWidget a={a} />
      <BiggestExpenses a={a} currentMonth={currentMonth} />
      <ZakatWidget />
    </div>
  )
}

// MOBILE : un fil de cartes, de l'essentiel (heros, coach, repartition) au
// detail (tendances, habitudes, patrimoine).
function MobileReports({ a, currentMonth, isDesktop }: LayoutProps) {
  const accounts = useAccountsList()
  return (
    <div className="stagger space-y-4">
      <ReportsHero a={a} currentMonth={currentMonth} />
      <SavingsCoach a={a} />
      <SpendingDonut a={a} currentMonth={currentMonth} />
      <CategoryBreakdown a={a} currentMonth={currentMonth} isDesktop={isDesktop} />
      <IncomeExpenseWidget
        monthly={a.monthly}
        months={a.monthly.length}
        reference={a.reference}
        average={a.average}
        averageCount={a.averageMonths.length}
      />
      <TopMerchants a={a} currentMonth={currentMonth} />
      <WeekdayWidget a={a} />
      <RecurringWidget a={a} />
      <BiggestExpenses a={a} currentMonth={currentMonth} />
      <NetWorthWidget a={a} accounts={accounts} />
      <ZakatWidget />
    </div>
  )
}

/** Squelette de la page : memes cartes, memes hauteurs que le rendu final. */
function ReportsSkeleton({ reference, currentMonth, isDesktop }: { reference: string; currentMonth: string; isDesktop: boolean }) {
  if (isDesktop) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <ReportsHeroSkeleton className="lg:col-span-2" />
        <SavingsCoachSkeleton className="lg:col-span-2" />
        <SpendingDonutSkeleton reference={reference} currentMonth={currentMonth} />
        <TopMerchantsSkeleton reference={reference} currentMonth={currentMonth} />
        <CategoryBreakdownSkeleton isDesktop className="lg:col-span-2" />
        <IncomeExpenseSkeleton />
        <NetWorthSkeleton />
        <WeekdaySkeleton />
        <RecurringSkeleton />
        <BiggestExpensesSkeleton reference={reference} currentMonth={currentMonth} />
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <ReportsHeroSkeleton />
      <SavingsCoachSkeleton />
      <SpendingDonutSkeleton reference={reference} currentMonth={currentMonth} />
      <CategoryBreakdownSkeleton isDesktop={false} />
      <IncomeExpenseSkeleton />
      <TopMerchantsSkeleton reference={reference} currentMonth={currentMonth} />
    </div>
  )
}

export function ReportsPage() {
  const month = useUiStore((s) => s.month)
  const resetMonth = useUiStore((s) => s.resetMonth)
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  const txsQuery = useTransactions()
  const bootQuery = useBootstrap()
  const features = useServerFeatures()
  const crossBudget = features.has(SERVER_FEATURES.crossBudgetTransfers)
  const [period, setPeriod] = useReportPeriod()
  const isDesktop = useIsDesktop()
  const day = today()
  const currentMonth = day.slice(0, 7)

  const taxo = useMemo(() => (bootQuery.data ? taxonomyFrom(bootQuery.data) : null), [bootQuery.data])
  const analytics = useMemo(
    () =>
      txsQuery.data && taxo ? computeAnalytics(txsQuery.data, taxo, month, day, { period, crossBudget }) : null,
    [txsQuery.data, taxo, month, day, period, crossBudget],
  )

  const failed = (txsQuery.isError && !txsQuery.data) || (bootQuery.isError && !bootQuery.data)
  if (failed) {
    return (
      <Card>
        <EmptyState
          icon={CloudOff}
          tone="danger"
          title="Rapports indisponibles"
          description="Les transactions n’ont pas pu être chargées. Vérifie ta connexion puis réessaie."
          actionLabel="Réessayer"
          onAction={() => {
            if (txsQuery.isError) void txsQuery.refetch()
            if (bootQuery.isError) void bootQuery.refetch()
          }}
        />
      </Card>
    )
  }

  if (analytics && !analytics.hasData) {
    return (
      <Card>
        <EmptyState
          icon={BarChart3}
          title="Tes rapports arrivent bientôt"
          description="Ajoute une première transaction ou connecte ta banque : tes dépenses s’analyseront ici, mois après mois."
          actionLabel="Ajouter une transaction"
          onAction={() => setAddTxOpen(true)}
        />
      </Card>
    )
  }

  // Mois sans aucune donnee (futur, ou avant le premier import) : un etat vide
  // clair plutot qu'une page de zeros. Le mois courant garde sa page, meme vide.
  if (analytics && !analytics.hasActivity && month !== currentMonth) {
    const future = month > currentMonth
    return (
      <div className="space-y-4 lg:space-y-5">
        <Card variant="hero" tone="neutral">
          <EmptyState
            icon={CalendarClock}
            title={`Rien à analyser en ${fmtMonthLong(month)}`}
            description={
              future
                ? 'Ce mois n’a pas encore commencé : ses dépenses et ses revenus apparaîtront ici au fil des jours.'
                : 'Aucune dépense ni aucun revenu enregistrés ce mois-là.'
            }
            actionLabel={`Revenir à ${fmtMonthLong(currentMonth)}`}
            onAction={resetMonth}
          />
        </Card>
        <div className="lg:grid lg:grid-cols-2 lg:gap-5">
          <ZakatWidget />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <PeriodToolbar
        period={period}
        onChange={setPeriod}
        caption={
          analytics ? (
            comparisonPhrase(analytics.averageMonths, period)
          ) : (
            <Skeleton className="inline-block h-3 w-64 max-w-full align-middle" />
          )
        }
      />
      {analytics ? (
        isDesktop ? (
          <DesktopReports a={analytics} currentMonth={currentMonth} isDesktop />
        ) : (
          <MobileReports a={analytics} currentMonth={currentMonth} isDesktop={false} />
        )
      ) : (
        <ReportsSkeleton reference={month} currentMonth={currentMonth} isDesktop={isDesktop} />
      )}
    </div>
  )
}
