import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CalendarRange, EyeOff, FolderPlus, LifeBuoy, ListFilter } from 'lucide-react'
import type { Category } from '@/types/domain'
import type { BudgetGroupBlock, BudgetRow } from '@/lib/budget'
import { useBudgetMonth, useBootstrap, useCategoriesMap, useGroupsMap } from '@/lib/data'
import { useTargets, neededThisMonth, type Target } from '@/lib/targets'
import { fmtEUR, fmtMonthLong } from '@/lib/format'
import { dismissToast, toast } from '@/lib/toast'
import { useUiStore } from '@/stores/ui'
import { useBudgetHistory } from '@/stores/budgetHistory'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useDialogOpen } from '@/components/ui/dialog'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/EmptyState'
import { FundTargetsSheet, type FundPlanItem } from '@/components/budget/FundTargetsSheet'
import { CoverOverspendingDialog, type CoverItem } from '@/components/budget/CoverOverspendingDialog'
import { FundTargetsButton, FundTargetsCard, type FundStatus } from '@/components/budget/FundTargetsAction'
import { RtaBanner } from '@/components/budget/RtaBanner'
import { TriageCard } from '@/components/budget/TriageCard'
import { TargetDialog } from '@/components/budget/TargetDialog'
import { BudgetToolbar } from '@/components/budget/BudgetToolbar'
import { HiddenEnvelopes, type HiddenEntry } from '@/components/budget/HiddenEnvelopes'
import { useEnvelopeVisibility } from '@/components/budget/useEnvelopeVisibility'
import {
  findRow,
  HISTORY_TOAST,
  isEmptyRow,
  useAssignBatchMutation,
  useBudgetUndo,
} from '@/components/budget/budgetMutations'
import { DesktopGrid } from '@/components/budget/DesktopGrid'
import { MobileGroups } from '@/components/budget/MobileGroups'
import { BudgetError, BudgetSkeleton } from '@/components/budget/BudgetStates'

// Libelles des actions groupees : titre de l'etape d'historique (toast
// d'annulation) et cle de l'annulation ciblee depuis leur confirmation.
const FUND_LABEL = 'Financer les objectifs'
const COVER_LABEL = 'Couvrir les dépassements'

function sumTotals(rows: BudgetRow[]): BudgetGroupBlock['totals'] {
  return {
    assigned: rows.reduce((s, r) => s + r.assigned, 0),
    activity: rows.reduce((s, r) => s + r.activity, 0),
    available: rows.reduce((s, r) => s + r.available, 0),
  }
}

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
  // Drapeaux « masquee » lus dans le cache bootstrap : les mutations de
  // taxonomie les patchent en optimiste, masquer / afficher est instantane.
  const categoriesMap = useCategoriesMap()
  const groupsMap = useGroupsMap()
  const [targetCat, setTargetCat] = useState<Category | null>(null)
  const [fundOpen, setFundOpen] = useState(false)
  // Recapitulatif apres « Couvrir les depassements » (null = ferme).
  const [coverDone, setCoverDone] = useState<CoverItem[] | null>(null)
  // Assignation GROUPEE (financer, couvrir) : une seule mise a jour optimiste,
  // une seule etape d'historique, un seul rollback si le lot echoue.
  const assignBatch = useAssignBatchMutation(month)
  const { undo, redo, undoLast, canUndo, canRedo } = useBudgetUndo(month)
  const { showCategory, showGroup } = useEnvelopeVisibility()
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const setCollapsedGroups = useUiStore((s) => s.setCollapsedGroups)
  const hideEmptyRows = useUiStore((s) => s.hideEmptyRows)
  const setHideEmptyRows = useUiStore((s) => s.setHideEmptyRows)
  // Ne monter qu'une seule variante (desktop OU mobile) au lieu de monter les
  // deux et d'en masquer une en CSS : evite un arbre React entier inutile.
  const isDesktop = useIsDesktop()
  const dialogOpen = useDialogOpen()

  // Undo/redo LOCAL, limite a la page Budget et aux assignations. L'historique est
  // vide au changement de mois affiche (les entrees ne concernent que ce mois-la).
  const clearHistory = useBudgetHistory((s) => s.clear)
  useEffect(() => {
    clearHistory()
  }, [month, clearHistory])

  // Raccourcis clavier (desktop) : Ctrl/Cmd+Z = annuler, Ctrl/Cmd+Maj+Z (ou
  // Ctrl+Y) = refaire. Ignores dans un champ de saisie (edition inline de
  // l'assigne) et tant qu'une feuille ou une modale est ouverte : le raccourci
  // appartient alors au dialog, pas a la page dessous.
  useEffect(() => {
    if (dialogOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      if (key === 'y' || e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialogOpen, undo, redo])

  const targetMap = useMemo(() => targets ?? new Map<string, Target>(), [targets])

  // Enveloppes AFFICHEES vs MASQUEES. Une enveloppe masquee (ou toutes celles
  // d'un groupe masque) quitte la grille pour la section « Categories
  // masquees » en bas de page ; son argent reste compte dans le budget.
  const { visibleGroups, hiddenEntries } = useMemo(() => {
    const visible: BudgetGroupBlock[] = []
    const hidden: HiddenEntry[] = []
    for (const block of budget?.groups ?? []) {
      if (groupsMap.get(block.group.id)?.hidden ?? block.group.hidden) {
        hidden.push({ kind: 'group', block })
        continue
      }
      const rows: BudgetRow[] = []
      for (const row of block.rows) {
        if (categoriesMap.get(row.category.id)?.hidden ?? row.category.hidden) {
          hidden.push({ kind: 'category', row, group: block.group })
        } else {
          rows.push(row)
        }
      }
      if (rows.length === 0) continue
      // Totaux du groupe = enveloppes affichees (la carte additionne ce qu'elle montre).
      visible.push(rows.length === block.rows.length ? block : { ...block, rows, totals: sumTotals(rows) })
    }
    return { visibleGroups: visible, hiddenEntries: hidden }
  }, [budget, categoriesMap, groupsMap])

  // Plan de financement du mois courant : pour chaque enveloppe AFFICHEE ayant
  // un objectif, le supplement a assigner (neededThisMonth). Les objectifs deja
  // finances (add = 0) et les enveloppes masquees sont ignores.
  const { fundPlan, targetCount } = useMemo(() => {
    const items: FundPlanItem[] = []
    let count = 0
    for (const block of visibleGroups) {
      for (const row of block.rows) {
        const target = targetMap.get(row.category.id)
        if (!target) continue
        count += 1
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
    return { fundPlan: items, targetCount: count }
  }, [visibleGroups, targetMap, month])

  const fundTotal = fundPlan.reduce((sum, item) => sum + item.add, 0)
  const fundStatus: FundStatus =
    targetCount === 0
      ? { kind: 'none' }
      : fundPlan.length > 0
        ? { kind: 'todo', count: fundPlan.length, total: fundTotal }
        : { kind: 'done', targetCount }

  // Enveloppes en depassement (disponible < 0) du mois affiche, masquees
  // COMPRISES (de l'argent reel manque) : couvrir un depassement = assigner le
  // manque pour ramener le disponible a 0 (l'argent vient du Pret a assigner).
  const overspentRows = useMemo(() => {
    const rows: CoverItem[] = []
    for (const block of budget?.groups ?? []) {
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

  // Couvre TOUS les depassements en une action (une etape d'historique) :
  // chaque enveloppe negative recoit le manque (nouvel assigne = assigne +
  // manque -> disponible = 0). Le recapitulatif s'ouvre ensuite avec la liste
  // figee de ce qui a ete fait (les lignes ne sont plus « en depassement »).
  const coverOverspending = () => {
    const done = overspentRows
    if (done.length === 0) return
    assignBatch.mutate({
      changes: done.map((row) => ({ categoryId: row.categoryId, amount: row.previousAssigned + row.added })),
      label: COVER_LABEL,
    })
    setCoverDone(done)
  }

  const confirmFunding = () => {
    const plan = fundPlan
    if (plan.length === 0) return setFundOpen(false)
    // Assignations absolues (assigne actuel + supplement) en UN lot. En cas
    // d'echec, le rollback remet les chiffres et le toast de confirmation
    // disparait (l'erreur est signalee par la notification globale).
    assignBatch.mutate(
      {
        changes: plan.map((item) => ({ categoryId: item.categoryId, amount: item.currentAssigned + item.add })),
        label: FUND_LABEL,
      },
      { onError: () => dismissToast(HISTORY_TOAST) },
    )
    setFundOpen(false)
    toast({
      id: HISTORY_TOAST,
      tone: 'success',
      message: plan.length === 1 ? `Objectif financé : ${plan[0]!.categoryName}` : `${plan.length} objectifs financés`,
      description: `${fmtEUR(fundTotal)} assignés`,
      action: { label: 'Annuler', onClick: () => undoLast(FUND_LABEL) },
    })
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
      <Card className="animate-fade-in">
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

  const groupIds = visibleGroups.map((b) => b.group.id)
  const allCollapsed = groupIds.length > 0 && groupIds.every((id) => collapsedGroups[id])
  const toggleAllGroups = () => {
    if (allCollapsed) setCollapsedGroups({})
    else setCollapsedGroups(Object.fromEntries(groupIds.map((id) => [id, true])))
  }
  const everyRowEmpty =
    hideEmptyRows && visibleGroups.length > 0 && visibleGroups.every((b) => b.rows.every(isEmptyRow))

  const overspentNames = overspentRows.map((r) => r.categoryName)
  const uncategorized = boot.data?.uncategorizedCount ?? 0
  const targetRow = targetCat ? (findRow(budget, targetCat.id) ?? null) : null

  const desktopActions =
    fundStatus.kind !== 'none' || overspentTotal > 0 ? (
      <>
        <FundTargetsButton status={fundStatus} onFund={() => setFundOpen(true)} />
        {overspentTotal > 0 && (
          <button
            type="button"
            onClick={coverOverspending}
            title="Couvrir les enveloppes en dépassement (ramener le disponible à 0)"
            className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <LifeBuoy className="h-4 w-4" />
            <span>
              Couvrir<span className="hidden 2xl:inline"> les dépassements</span>
            </span>
            <span className="tnum text-danger">{fmtEUR(overspentTotal)}</span>
          </button>
        )}
      </>
    ) : undefined

  return (
    <div className="space-y-4 lg:space-y-5">
      {/* Mobile : heros du Pret a assigner (barre compacte au defilement).
          Desktop : le resume est dans le header (HeaderBudgetSummary). */}
      {!isDesktop && (
        <RtaBanner
          budget={budget}
          overspent={{ count: overspentRows.length, missing: overspentTotal, names: overspentNames }}
          onCover={coverOverspending}
        />
      )}
      {/* Mobile : actions du mois dans une seule carte (tri des transactions a
          categoriser, financement des objectifs ou son etat de reussite). */}
      {!isDesktop && (uncategorized > 0 || fundStatus.kind !== 'none') && (
        <div className="divide-y divide-line/70 overflow-hidden rounded-2xl border border-edge bg-surface shadow-card">
          <TriageCard />
          <FundTargetsCard status={fundStatus} onFund={() => setFundOpen(true)} />
        </div>
      )}

      {visibleGroups.length > 0 && (
        <BudgetToolbar
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          hideEmptyRows={hideEmptyRows}
          onToggleEmptyRows={() => setHideEmptyRows(!hideEmptyRows)}
          allCollapsed={allCollapsed}
          onToggleCollapsed={toggleAllGroups}
          desktopActions={desktopActions}
        />
      )}

      {budget.groups.length === 0 ? (
        <Card className="animate-fade-in">
          <EmptyState
            icon={FolderPlus}
            title="Aucune enveloppe pour l'instant"
            description="Créez vos groupes et catégories dans les Réglages pour donner un rôle à chaque euro."
            actionLabel="Ouvrir les Réglages"
            onAction={() => navigate({ to: '/reglages' })}
          />
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card className="animate-fade-in">
          <EmptyState
            icon={EyeOff}
            compact
            title="Toutes vos enveloppes sont masquées"
            description={'Réaffichez celles dont vous avez besoin depuis «\u00a0Catégories masquées\u00a0», juste en dessous.'}
          />
        </Card>
      ) : everyRowEmpty ? (
        <Card className="animate-fade-in">
          <EmptyState
            icon={ListFilter}
            compact
            title="Aucune enveloppe utilisée ce mois-ci"
            description="Les lignes vides sont masquées. Affichez-les pour commencer à assigner."
            actionLabel="Afficher toutes les lignes"
            onAction={() => setHideEmptyRows(false)}
          />
        </Card>
      ) : isDesktop ? (
        <DesktopGrid
          groups={visibleGroups}
          month={month}
          targets={targetMap}
          onOpenTarget={setTargetCat}
          onViewActivity={viewActivity}
          hideEmptyRows={hideEmptyRows}
        />
      ) : (
        <MobileGroups
          groups={visibleGroups}
          month={month}
          targets={targetMap}
          onOpenTarget={setTargetCat}
          onViewActivity={viewActivity}
          hideEmptyRows={hideEmptyRows}
        />
      )}

      <HiddenEnvelopes entries={hiddenEntries} onShowCategory={showCategory} onShowGroup={showGroup} />

      <CoverOverspendingDialog
        items={coverDone}
        rtaAfter={budget.rta}
        onUndo={() => undoLast(COVER_LABEL)}
        onClose={() => setCoverDone(null)}
      />
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
        row={targetRow}
        onClose={() => setTargetCat(null)}
      />
    </div>
  )
}
