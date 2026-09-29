import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  CalendarRange,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  LifeBuoy,
  Redo2,
  Sparkles,
  Undo2,
  Wand2,
} from 'lucide-react'
import type { Category } from '@/types/domain'
import { useBudgetMonth, useBootstrap } from '@/lib/data'
import { useTargets, neededThisMonth, type Target } from '@/lib/targets'
import { FundTargetsSheet, type FundPlanItem } from '@/components/budget/FundTargetsSheet'
import { CoverOverspendingDialog, type CoverItem } from '@/components/budget/CoverOverspendingDialog'
import { Button } from '@/components/ui/button'
import { fmtEUR, fmtMonthLong } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { RtaBanner } from '@/components/budget/RtaBanner'
import { TriageCard } from '@/components/budget/TriageCard'
import { OverspendingCard } from '@/components/budget/OverspendingCard'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useBudgetHistory } from '@/stores/budgetHistory'
import { TargetDialog } from '@/components/budget/TargetDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { useAssignMutation } from '@/components/budget/budgetMutations'
import { DesktopGrid } from '@/components/budget/DesktopGrid'
import { MobileGroups } from '@/components/budget/MobileGroups'
import { BudgetError, BudgetSkeleton } from '@/components/budget/BudgetStates'

export function BudgetPage() {
  const month = useUiStore((s) => s.month)
  const setMonth = useUiStore((s) => s.setMonth)
  const navigate = useNavigate()
  // Ouvre la liste des transactions filtree sur la categorie cliquee et le mois
  // affiche (mois comptable = date.slice(0,7) cote Transactions).
  const viewActivity = (categoryId: string) =>
    navigate({ to: '/transactions', search: { categorie: categoryId, mois: month } })
  const boot = useBootstrap()
  const { data: budget, isError, refetch } = useBudgetMonth(month)
  const { data: targets } = useTargets()
  const [targetCat, setTargetCat] = useState<Category | null>(null)
  const [fundOpen, setFundOpen] = useState(false)
  // Recapitulatif apres « Couvrir les depassements » (null = ferme).
  const [coverDone, setCoverDone] = useState<CoverItem[] | null>(null)
  // Mutation d'assignation partagee pour l'assignation guidee : chaque ligne du
  // plan est appliquee via la MEME mutation optimiste que la saisie manuelle
  // (cache mis a jour immediatement, POST en fond, rollback par ligne si echec).
  const assign = useAssignMutation(month)
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const setCollapsedGroups = useUiStore((s) => s.setCollapsedGroups)
  const hideEmptyRows = useUiStore((s) => s.hideEmptyRows)
  const setHideEmptyRows = useUiStore((s) => s.setHideEmptyRows)
  // Ne monter qu'une seule variante (desktop OU mobile) au lieu de monter les
  // deux et d'en masquer une en CSS : evite un arbre React entier inutile.
  const isDesktop = useIsDesktop()

  // Undo/redo LOCAL, limite a la page Budget et aux assignations. L'historique est
  // vide au changement de mois affiche (les entrees ne concernent que ce mois-la).
  const undo = useBudgetHistory((s) => s.undo)
  const redo = useBudgetHistory((s) => s.redo)
  const clearHistory = useBudgetHistory((s) => s.clear)
  const canUndo = useBudgetHistory((s) => s.past.length > 0)
  const canRedo = useBudgetHistory((s) => s.future.length > 0)

  useEffect(() => {
    clearHistory()
  }, [month, clearHistory])

  const handleUndo = useCallback(() => {
    const change = undo()
    if (change) assign.mutate({ categoryId: change.categoryId, amount: change.prev, skipHistory: true })
  }, [undo, assign])
  const handleRedo = useCallback(() => {
    const change = redo()
    if (change) assign.mutate({ categoryId: change.categoryId, amount: change.next, skipHistory: true })
  }, [redo, assign])

  // Raccourcis clavier (desktop) : Ctrl/Cmd+Z = annuler, Ctrl/Cmd+Maj+Z = refaire.
  // Ignore quand le focus est dans un champ de saisie (edition inline de l'assigne).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo])

  const targetMap = targets ?? new Map<string, Target>()

  // Plan de financement du mois courant : pour chaque categorie ayant un objectif,
  // le supplement a assigner (neededThisMonth). On ignore les objectifs deja
  // finances (add = 0). Recalcule a chaque changement de budget/objectifs.
  const fundPlan = useMemo<FundPlanItem[]>(() => {
    if (!budget) return []
    const items: FundPlanItem[] = []
    for (const block of budget.groups) {
      for (const row of block.rows) {
        const target = targetMap.get(row.category.id)
        if (!target) continue
        const add = neededThisMonth(target, month, row.assigned, row.available)
        if (add <= 0) continue
        items.push({
          categoryId: row.category.id,
          categoryName: row.category.name,
          group: block.group,
          currentAssigned: row.assigned,
          add,
        })
      }
    }
    return items
  }, [budget, targetMap, month])

  const fundTotal = fundPlan.reduce((sum, item) => sum + item.add, 0)

  // Enveloppes en depassement (disponible < 0) du mois affiche : couvrir un
  // depassement = assigner le manque pour ramener le disponible a 0 (l'argent
  // vient du Pret a assigner). budget peut etre undefined avant le garde-fou de
  // rendu : on securise avec un tableau vide (les hooks restent inconditionnels).
  const overspentRows = useMemo(() => {
    const rows: CoverItem[] = []
    if (!budget) return rows
    for (const block of budget.groups) {
      for (const row of block.rows) {
        if (row.available < 0) {
          rows.push({
            categoryId: row.category.id,
            categoryName: row.category.name,
            group: block.group,
            previousAssigned: row.assigned,
            added: -row.available,
          })
        }
      }
    }
    return rows
  }, [budget])

  const overspentTotal = overspentRows.reduce((sum, r) => sum + r.added, 0)

  // Couvre TOUS les depassements en une action : chaque enveloppe negative
  // recoit le manque (nouvel assigne = assigne + manque -> disponible = 0).
  // Chaque mutate part independamment (rollback par ligne si echec reseau).
  // Le recapitulatif s'ouvre ensuite avec la liste figee de ce qui a ete fait
  // (les lignes ne sont plus « en depassement » une fois le cache patche).
  const coverOverspending = () => {
    const done = overspentRows
    for (const row of done) {
      assign.mutate({ categoryId: row.categoryId, amount: row.previousAssigned + row.added })
    }
    setCoverDone(done)
  }

  const confirmFunding = () => {
    // Applique chaque assignation en absolu (assigne actuel + supplement). Chaque
    // mutate part independamment : rollback individuel en cas d'echec reseau.
    for (const item of fundPlan) {
      assign.mutate({ categoryId: item.categoryId, amount: item.currentAssigned + item.add })
    }
    setFundOpen(false)
  }

  // L'erreur du bootstrap desactive la query budget : on la surveille aussi
  // pour ne pas rester bloque en skeleton.
  if (boot.isError || isError) {
    return (
      <BudgetError
        onRetry={() => {
          void boot.refetch()
          void refetch()
        }}
      />
    )
  }

  if (!budget) return <BudgetSkeleton />

  // Mois anterieur au depart du budget (« Nouveau budget ») : rien a montrer.
  const startMonth = boot.data?.budgetStartMonth ?? null
  if (startMonth && month < startMonth) {
    return (
      <Card>
        <EmptyState
          icon={CalendarRange}
          title={`Le budget commence en ${fmtMonthLong(startMonth)}`}
          description="Les mois précédents sont gelés : leurs mouvements forment le solde de départ versé au Prêt à assigner."
          actionLabel={`Aller à ${fmtMonthLong(startMonth)}`}
          onAction={() => setMonth(startMonth)}
        />
      </Card>
    )
  }

  const groupIds = budget.groups.map((b) => b.group.id)
  const allCollapsed = groupIds.length > 0 && groupIds.every((id) => collapsedGroups[id])
  const toggleAllGroups = () => {
    if (allCollapsed) setCollapsedGroups({})
    else setCollapsedGroups(Object.fromEntries(groupIds.map((id) => [id, true])))
  }

  return (
    <div className="space-y-5">
      {/* Desktop : le resume est dans le header (HeaderBudgetSummary). Mobile :
          on garde le grand bandeau sticky. */}
      <div className="lg:hidden">
        <RtaBanner budget={budget} overspent={overspentTotal} />
      </div>
      {/* Mobile uniquement : raccourci vers le tri des transactions a categoriser. */}
      <TriageCard />
      {/* Mobile uniquement : depassements du mois et action « Couvrir » (le
          desktop a le bouton dans la barre d'actions). */}
      <OverspendingCard count={overspentRows.length} missing={overspentTotal} onCover={coverOverspending} />
      {/* Tout replier / tout deplier les groupes du budget. */}
      {groupIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Annuler / Refaire : LOCAL a la page Budget, uniquement les
              assignations d'enveloppe. Raccourcis Ctrl/Cmd+Z et Ctrl/Cmd+Maj+Z. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Annuler la dernière assignation (Ctrl+Z)"
              aria-label="Annuler la dernière assignation"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Annuler</span>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              title="Refaire (Ctrl+Maj+Z)"
              aria-label="Refaire l'assignation annulée"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Refaire</span>
            </button>
            {/* Actions rapides DESKTOP UNIQUEMENT : affecter automatiquement.
                Assigner aux objectifs (financer le supplement necessaire ce
                mois) et couvrir les depassements (ramener les disponibles
                negatifs a 0). Chacune est desactivee quand elle n'a rien a
                faire, avec le montant concerne en indice. */}
            {(fundTotal > 0 || overspentTotal > 0) && (
              <div className="ml-1.5 hidden items-center gap-1.5 border-l border-line pl-2.5 lg:flex">
                <button
                  type="button"
                  onClick={() => setFundOpen(true)}
                  disabled={fundTotal === 0}
                  title="Assigner automatiquement le montant nécessaire aux objectifs de ce mois"
                  className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Wand2 className="h-4 w-4" />
                  Assigner aux objectifs
                  {fundTotal > 0 && <span className="tnum text-soft">{fmtEUR(fundTotal)}</span>}
                </button>
                <button
                  type="button"
                  onClick={coverOverspending}
                  disabled={overspentTotal === 0}
                  title="Couvrir les enveloppes en dépassement (ramener le disponible à 0)"
                  className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <LifeBuoy className="h-4 w-4" />
                  Couvrir les dépassements
                  {overspentTotal > 0 && <span className="tnum text-danger">{fmtEUR(overspentTotal)}</span>}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setHideEmptyRows(!hideEmptyRows)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink"
          >
            {hideEmptyRows ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {hideEmptyRows ? 'Afficher toutes les lignes' : 'Masquer les lignes vides'}
          </button>
          <button
            type="button"
            onClick={toggleAllGroups}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-4 w-4" />
            ) : (
              <ChevronsDownUp className="h-4 w-4" />
            )}
            {allCollapsed ? 'Tout déplier' : 'Tout replier'}
          </button>
          </div>
        </div>
      )}
      {fundPlan.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card lg:hidden">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Financer les objectifs</p>
            <p className="text-[13px] text-soft">
              {fundPlan.length === 1
                ? '1 catégorie à compléter'
                : `${fundPlan.length} catégories à compléter`}{' '}
              · <span className="tnum">{fmtEUR(fundTotal)}</span>
            </p>
          </div>
          <Button className="h-11 shrink-0 gap-2" onClick={() => setFundOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Financer
          </Button>
        </div>
      )}
      {isDesktop ? (
        <DesktopGrid
          groups={budget.groups}
          month={month}
          targets={targetMap}
          onOpenTarget={setTargetCat}
          onViewActivity={viewActivity}
          hideEmptyRows={hideEmptyRows}
        />
      ) : (
        <MobileGroups
          groups={budget.groups}
          month={month}
          targets={targetMap}
          onOpenTarget={setTargetCat}
          onViewActivity={viewActivity}
          hideEmptyRows={hideEmptyRows}
        />
      )}
      <CoverOverspendingDialog items={coverDone} rtaAfter={budget.rta} onClose={() => setCoverDone(null)} />
      <FundTargetsSheet
        open={fundOpen}
        items={fundPlan}
        total={fundTotal}
        rta={budget.rta}
        onConfirm={confirmFunding}
        onClose={() => setFundOpen(false)}
      />
      <TargetDialog
        category={targetCat}
        target={targetCat ? targetMap.get(targetCat.id) ?? null : null}
        onClose={() => setTargetCat(null)}
      />
    </div>
  )
}
