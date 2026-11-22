import { useMemo, useState } from 'react'
import { BarChart3, CalendarClock, ChevronRight, CloudOff, EyeOff } from 'lucide-react'
import { useTransactions } from '@/lib/queries'
import { useAccountsList, useBootstrap, useServerFeatures } from '@/lib/data'
import { SERVER_FEATURES } from '@/lib/features'
import { useUiStore } from '@/stores/ui'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { computeAnalytics, monthsRangePhrase, taxonomyFrom, type Analytics } from '@/lib/analytics'
import type { ReportScope } from '@/lib/exceptional'
import { useReportScope } from '@/lib/reportScope'
import { fmtMonthLong, monthOf, today } from '@/lib/format'
import { EmptyState } from '@/components/shared/EmptyState'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { Card } from '@/components/ui/card'
import { comparisonPhrase, PeriodToolbar, useReportPeriod } from '@/components/reports/PeriodToolbar'
import { ReportsHero, ReportsHeroSkeleton } from '@/components/reports/ReportsHero'
import { SavingsCoach, SavingsCoachSkeleton } from '@/components/reports/SavingsCoach'
import { SpendingDonut, SpendingDonutSkeleton } from '@/components/reports/SpendingDonut'
import { SpendingLeaders, SpendingLeadersSkeleton } from '@/components/reports/SpendingLeaders'
import { CategoryBreakdown, CategoryBreakdownSkeleton } from '@/components/reports/CategoryBreakdown'
import { IncomeExpenseSkeleton, IncomeExpenseWidget } from '@/components/reports/IncomeExpenseWidget'
import { NetWorthSkeleton, NetWorthWidget } from '@/components/reports/NetWorthWidget'
import { RunwaySkeleton, RunwayWidget } from '@/components/reports/RunwayWidget'
import { WeekdaySkeleton, WeekdayWidget } from '@/components/reports/WeekdayWidget'
import { RecurringSkeleton, RecurringWidget } from '@/components/reports/RecurringWidget'
import { ScopeSheet } from '@/components/reports/ScopeSheet'
import { ZakatWidget } from '@/components/reports/ZakatWidget'
import { InlineSkeleton } from '@/components/reports/WidgetCard'
import { cn } from '@/lib/utils'

// Page Rapports : TOUT est calcule cote client depuis le cache des
// transactions (lib/analytics.ts), sans appel reseau ni au changement de mois
// ni au changement de periode : la page suit instantanement les mises a jour
// optimistes (categorisation, ajout) et ne relit jamais l'historique serveur.
// Les virements budget <-> suivi ne comptent qu'avec un serveur qui annonce
// crossBudgetTransfers (sinon : comportement historique, virements neutres).
//
// Perimetre (lib/exceptional.ts, lib/reportScope.ts) : les operations
// exceptionnelles (vente d'un bien, solde d'un credit), les virements entre ses
// comptes importes des deux cotes, les operations ecartees a la main et les
// categories « hors depenses » ne faussent plus moyennes et repartitions ; le
// patrimoine compte tout. La barre de periode ouvre leur liste.
//
// Lecture en trois temps : le mois (heros, repartition, ou je depense, ecarts
// par categorie, coach), la duree (entrees et sorties, matelas, patrimoine,
// prelevements), puis les habitudes et outils.

interface LayoutProps {
  a: Analytics
  currentMonth: string
  isDesktop: boolean
}

const TRENDS_TITLE = 'Sur la durée'
const HABITS_TITLE = 'Habitudes et outils'

function trendsCaption(a: Analytics): string {
  const first = a.monthly[0]?.month
  const last = a.monthly[a.monthly.length - 1]?.month
  return first && last && first !== last
    ? `Évolution ${monthsRangePhrase(first, last)}`
    : 'Le mois affiché, en attendant l’historique'
}

// DESKTOP : heros pleine largeur, repartition et classement cote a cote,
// ecarts par categorie et coach, puis la duree et les habitudes par paires de
// hauteurs voisines. Tout ce qui precede le tableau a une hauteur fixe : le
// premier ecran ne bouge pas a l'arrivee des donnees.
function DesktopReports({ a, currentMonth, isDesktop }: LayoutProps) {
  const accounts = useAccountsList()
  return (
    <div data-reports="content" className="stagger grid gap-5 lg:grid-cols-2">
      <ReportsHero a={a} currentMonth={currentMonth} className="lg:col-span-2" />
      <SpendingDonut a={a} currentMonth={currentMonth} />
      <SpendingLeaders a={a} currentMonth={currentMonth} />
      <CategoryBreakdown a={a} currentMonth={currentMonth} isDesktop={isDesktop} className="lg:col-span-2" />
      <SavingsCoach a={a} className="lg:col-span-2" />
      <SectionHeader title={TRENDS_TITLE} description={trendsCaption(a)} className="mt-3 lg:col-span-2" />
      <IncomeExpenseWidget
        monthly={a.monthly}
        months={a.monthly.length}
        reference={a.reference}
        average={a.average}
        averageCount={a.averageMonths.length}
        currentMonth={currentMonth}
      />
      <RunwayWidget a={a} />
      <NetWorthWidget a={a} accounts={accounts} />
      <RecurringWidget a={a} />
      <SectionHeader title={HABITS_TITLE} className="mt-3 lg:col-span-2" />
      <WeekdayWidget a={a} />
      <ZakatWidget />
    </div>
  )
}

// MOBILE : un fil de cartes, dans le meme ordre de lecture.
function MobileReports({ a, currentMonth, isDesktop }: LayoutProps) {
  const accounts = useAccountsList()
  return (
    <div data-reports="content" className="stagger space-y-4">
      <ReportsHero a={a} currentMonth={currentMonth} />
      <SpendingDonut a={a} currentMonth={currentMonth} />
      <SpendingLeaders a={a} currentMonth={currentMonth} />
      <CategoryBreakdown a={a} currentMonth={currentMonth} isDesktop={isDesktop} />
      <SavingsCoach a={a} />
      <SectionHeader title={TRENDS_TITLE} description={trendsCaption(a)} className="pt-4" />
      <IncomeExpenseWidget
        monthly={a.monthly}
        months={a.monthly.length}
        reference={a.reference}
        average={a.average}
        averageCount={a.averageMonths.length}
        currentMonth={currentMonth}
      />
      <RunwayWidget a={a} />
      <NetWorthWidget a={a} accounts={accounts} />
      <RecurringWidget a={a} />
      <SectionHeader title={HABITS_TITLE} className="pt-4" />
      <WeekdayWidget a={a} />
      <ZakatWidget />
    </div>
  )
}

/** Squelette de la page : memes cartes, memes hauteurs que le rendu final. */
function ReportsSkeleton({ reference, currentMonth, isDesktop }: { reference: string; currentMonth: string; isDesktop: boolean }) {
  if (isDesktop) {
    return (
      <div data-reports="skeleton" aria-busy="true" className="grid gap-5 lg:grid-cols-2">
        <ReportsHeroSkeleton reference={reference} currentMonth={currentMonth} className="lg:col-span-2" />
        <SpendingDonutSkeleton reference={reference} currentMonth={currentMonth} />
        <SpendingLeadersSkeleton reference={reference} currentMonth={currentMonth} />
        <CategoryBreakdownSkeleton reference={reference} currentMonth={currentMonth} isDesktop className="lg:col-span-2" />
        <SavingsCoachSkeleton className="lg:col-span-2" />
        <SectionHeader title={TRENDS_TITLE} className="mt-3 lg:col-span-2" />
        <IncomeExpenseSkeleton />
        <RunwaySkeleton />
        <NetWorthSkeleton />
        <RecurringSkeleton />
        <WeekdaySkeleton />
      </div>
    )
  }
  return (
    <div data-reports="skeleton" aria-busy="true" className="space-y-4">
      <ReportsHeroSkeleton reference={reference} currentMonth={currentMonth} />
      <SpendingDonutSkeleton reference={reference} currentMonth={currentMonth} />
      <SpendingLeadersSkeleton reference={reference} currentMonth={currentMonth} />
      <CategoryBreakdownSkeleton reference={reference} currentMonth={currentMonth} isDesktop={false} />
      <SavingsCoachSkeleton />
    </div>
  )
}

/**
 * Acces au perimetre, sous la phrase de comparaison : nombre d'operations
 * ecartees sur les mois affiches (un virement interne compte une fois) et de
 * categories hors depenses.
 */
function ScopeButton({ scope, months, onOpen }: { scope: ReportScope; months: string[]; onOpen: () => void }) {
  const first = months[0] ?? ''
  const last = months[months.length - 1] ?? ''
  const count = scope.items.filter(
    (i) =>
      i.excluded &&
      !(i.reason === 'internal' && i.tx.amount > 0) &&
      monthOf(i.tx.date) >= first &&
      monthOf(i.tx.date) <= last,
  ).length
  const categories = scope.excludedCategories.size
  const parts = [
    count > 0 ? `${count} opération${count > 1 ? 's' : ''} écartée${count > 1 ? 's' : ''}` : 'Aucune opération écartée',
    categories > 0 ? `${categories} catégorie${categories > 1 ? 's' : ''} hors dépenses` : null,
  ].filter(Boolean)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-accent-ink transition-colors hover:bg-accent/10 dark:text-accent lg:-ml-2 lg:min-h-8 lg:text-[13px]',
      )}
    >
      <EyeOff aria-hidden className="h-3.5 w-3.5" />
      {parts.join(' · ')}
      <ChevronRight aria-hidden className="h-3.5 w-3.5" />
    </button>
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

  const { scope } = useReportScope()
  const [scopeOpen, setScopeOpen] = useState(false)

  const taxo = useMemo(() => (bootQuery.data ? taxonomyFrom(bootQuery.data) : null), [bootQuery.data])
  const analytics = useMemo(
    () =>
      txsQuery.data && taxo && scope
        ? computeAnalytics(txsQuery.data, taxo, month, day, { period, crossBudget, scope })
        : null,
    [txsQuery.data, taxo, month, day, period, crossBudget, scope],
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
            <InlineSkeleton className="h-3 w-64 max-w-full" />
          )
        }
        scope={
          analytics && scope ? (
            <ScopeButton scope={scope} months={analytics.months} onOpen={() => setScopeOpen(true)} />
          ) : undefined
        }
      />
      {analytics && <ScopeSheet open={scopeOpen} onOpenChange={setScopeOpen} months={analytics.months} />}
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
