import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Inbox, Plus, Search, SlidersHorizontal, Wand2, X } from 'lucide-react'
import type { Transaction } from '@/types/domain'
import { countsAsUncategorized, useAccountsList, useAccountsMap, useBootstrap, useCategoriesList, useCategoriesMap, useGroupsList, useGroupsMap } from '@/lib/data'
import { payeeKey } from '@/lib/categorize'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useTransactions } from '@/lib/queries'
import { ruleValueFromLabel, useApplyRules, useRules } from '@/lib/rules'
import { currentMonth, monthOf } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { CategorizeToast, type CategorizeToastData } from '@/components/transactions/CategorizeToast'
import { CreateRuleDialog } from '@/components/transactions/CreateRuleDialog'
import { MobileFiltersSheet } from '@/components/transactions/MobileFiltersSheet'
import { useCategorizeMany } from '@/components/transactions/useCategorizeMany'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { MonthPicker } from '@/components/ui/month-picker'
import { cn } from '@/lib/utils'
import {
  type TxRow,
  type Maps,
  toRow,
  PAGE_SIZE,
  normSearch,
} from '@/components/transactions/txRow'
import { CategorizedContext } from '@/components/transactions/CategoryBadge'
import { DesktopTable } from '@/components/transactions/DesktopTable'
import { MobileList } from '@/components/transactions/MobileList'
import { TransactionsSkeleton } from '@/components/transactions/TransactionsSkeleton'

export function TransactionsPage() {
  const queryClient = useQueryClient()
  const isDesktop = useIsDesktop()
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  const { data: txs } = useTransactions()
  const boot = useBootstrap()
  const accounts = useAccountsList()
  const accountById = useAccountsMap()
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const categoriesList = useCategoriesList()
  const groupsList = useGroupsList()

  // Pre-filtres poses par la navigation (tous optionnels, combinables) :
  //   ?compte=<id>     (depuis Comptes)
  //   ?categorie=<id>  (clic sur une activite du Budget)
  //   ?mois=YYYY-MM    (clic sur une activite du Budget)
  const { compte, categorie, mois } = useSearch({ from: '/_app/transactions' })
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState(compte ?? 'all')
  const [categoryFilter, setCategoryFilter] = useState(categorie ?? 'all')
  const [monthFilter, setMonthFilter] = useState(mois ?? 'all')
  const [onlyUncat, setOnlyUncat] = useState(false)
  // Synchronise les filtres quand les search params changent (ex. nouveau clic
  // sur une activite alors qu'on est deja sur la page). Ne touche qu'aux filtres
  // reellement fournis pour laisser l'utilisateur ajuster les autres a la main.
  useEffect(() => {
    if (compte) setAccountFilter(compte)
  }, [compte])
  useEffect(() => {
    if (categorie) setCategoryFilter(categorie)
  }, [categorie])
  useEffect(() => {
    if (mois) setMonthFilter(mois)
  }, [mois])

  // Bornes de mois : premier / dernier mois comptable reellement present, pour
  // borner la navigation du selecteur de mois (le filtre reste libre via 'all').
  const monthBounds = useMemo(() => {
    let min: string | undefined
    let max: string | undefined
    for (const t of txs ?? []) {
      const m = monthOf(t.date)
      if (!min || m < min) min = m
      if (!max || m > max) max = m
    }
    return { min, max }
  }, [txs])

  // Options du combobox categorie : regroupees par groupe, pastille coloree.
  const categoryOptions = useMemo<ComboboxOption[]>(() => {
    const opts: ComboboxOption[] = [{ value: 'all', label: 'Toutes les catégories' }]
    for (const group of groupsList) {
      for (const cat of categoriesList.filter((c) => c.groupId === group.id)) {
        opts.push({
          value: cat.id,
          label: cat.name,
          group: group.name,
          colorVar: `cat-${group.color}-fg`,
        })
      }
    }
    return opts
  }, [groupsList, categoriesList])

  // Options du combobox compte.
  const accountOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: 'all', label: 'Tous les comptes' },
      ...accounts.map((acc) => ({ value: acc.id, label: acc.name })),
    ],
    [accounts],
  )

  const hasFilters =
    Boolean(search) ||
    accountFilter !== 'all' ||
    categoryFilter !== 'all' ||
    monthFilter !== 'all' ||
    onlyUncat

  const clearFilters = () => {
    setSearch('')
    setAccountFilter('all')
    setCategoryFilter('all')
    setMonthFilter('all')
    setOnlyUncat(false)
  }

  // Non categorisee au sens du badge : compte budget, hors transfert, pas dans
  // le futur ni avant le mois de depart (meme regle que le compteur de la nav,
  // sinon chip et badge se contredisaient apres « Nouveau budget »).
  const isUncat = useCallback(
    (t: Transaction) => countsAsUncategorized(queryClient, t),
    // La taxonomie est lue dans le cache ; on recalcule quand elle change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, boot.data],
  )

  // Filtres appliques a TOUTES les transactions (tous mois confondus), tri
  // anti-chronologique, puis pagination. Le filtre mois se base sur le mois
  // comptable de la transaction (date -> YYYY-MM), coherent avec l'activite du
  // budget : la somme des lignes affichees redonne l'activite du mois.
  const rows = useMemo(() => {
    if (!txs || !boot.data) return []
    const maps: Maps = { accountById, categoryById, groupById }
    const q = normSearch(search)
    return txs
      .filter((t) => accountFilter === 'all' || t.accountId === accountFilter)
      .filter((t) => categoryFilter === 'all' || t.categoryId === categoryFilter)
      .filter((t) => monthFilter === 'all' || monthOf(t.date) === monthFilter)
      .filter((t) => !onlyUncat || isUncat(t))
      .map((t) => toRow(t, maps))
      .filter((r): r is TxRow => r !== null)
      .filter(
        (r) =>
          !q ||
          normSearch(r.tx.label).includes(q) ||
          normSearch(r.parsed.short).includes(q) ||
          (r.category ? normSearch(r.category.name).includes(q) : false) ||
          (r.tx.note ? normSearch(r.tx.note).includes(q) : false),
      )
      .sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : 0))
  }, [
    txs,
    boot.data,
    accountById,
    categoryById,
    groupById,
    search,
    accountFilter,
    categoryFilter,
    monthFilter,
    onlyUncat,
    isUncat,
  ])

  const uncatCount = useMemo(() => (txs ?? []).filter(isUncat).length, [txs, isUncat])

  // Toast « Appliquer aux N autres » apres une categorisation manuelle : les
  // autres transactions non categorisees du meme tiers (cle payee) sont
  // proposees en un tap. Aucune lecture reseau : tout vient du cache.
  const [toast, setToast] = useState<CategorizeToastData | null>(null)
  const [ruleDialog, setRuleDialog] = useState<{ value: string; categoryId: string } | null>(null)
  const categorizeMany = useCategorizeMany()
  const dismissToast = useCallback(() => setToast(null), [])
  const onCategorized = useCallback<(row: TxRow, categoryId: string | null) => void>(
    (row, categoryId) => {
      if (!categoryId) {
        setToast(null)
        return
      }
      const category = categoryById.get(categoryId)
      if (!category) return
      const key = payeeKey(row.tx.label)
      const similarIds = key
        ? (txs ?? [])
            .filter((t) => t.id !== row.tx.id && isUncat(t) && payeeKey(t.label) === key)
            .map((t) => t.id)
        : []
      if (similarIds.length === 0) {
        setToast(null)
        return
      }
      setToast({
        shortLabel: row.parsed.short,
        rawLabel: row.tx.label,
        categoryName: category.name,
        categoryId,
        similarIds,
      })
    },
    [categoryById, txs, isUncat],
  )
  const applyToast = () => {
    if (!toast) return
    haptic([10, 30, 10])
    categorizeMany.mutate({ txIds: toast.similarIds, categoryId: toast.categoryId })
    setToast(null)
  }
  const openRuleFromToast = () => {
    if (!toast) return
    setRuleDialog({ value: ruleValueFromLabel(toast.rawLabel), categoryId: toast.categoryId })
    setToast(null)
  }

  // Filtres mobile : chips + feuille basse (memes variables d'etat que la
  // barre desktop, qui reste inchangee).
  const [filtersOpen, setFiltersOpen] = useState(false)
  const sheetFilterCount =
    (accountFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (monthFilter !== 'all' ? 1 : 0)
  const isAllChip = !onlyUncat && sheetFilterCount === 0
  const chipClass = (active: boolean) =>
    cn(
      'flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors',
      active ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface text-soft',
    )

  // Categorisation automatique : meme action que la page Regles, proposee ici
  // parce que c'est ici qu'on constate le retard. Sans regle definie, l'action
  // ne peut rien faire : on n'affiche alors pas la banniere du tout.
  const { data: rules } = useRules()
  const applyRules = useApplyRules()
  const applied = applyRules.data
  const ruleCount = rules?.length ?? 0
  const showApplyBanner = ruleCount > 0 && (uncatCount > 0 || applyRules.isSuccess)
  const applyTitle = applyRules.isError
    ? 'La catégorisation automatique a échoué.'
    : applyRules.isSuccess
      ? applied === 0
        ? 'Aucune transaction ne correspond à tes règles.'
        : `${applied} transaction${applied === 1 ? '' : 's'} catégorisée${applied === 1 ? '' : 's'}.`
      : `${uncatCount} transaction${uncatCount === 1 ? '' : 's'} à catégoriser`
  const applySub = applyRules.isError
    ? (applyRules.error?.message ?? 'Réessaie dans un instant.')
    : applyRules.isSuccess && applied === 0
      ? 'Ajuste tes règles dans Réglages, onglet Règles.'
      : `${ruleCount} règle${ruleCount === 1 ? '' : 's'} de catégorisation active${ruleCount === 1 ? '' : 's'}, évaluées par ordre de priorité.`
  // La banniere prend la couleur de son message : ambre tant qu'il reste du
  // travail, vert quand des transactions viennent d'etre traitees, rouge en cas
  // d'echec.
  const applyTone = applyRules.isError
    ? 'danger'
    : applyRules.isSuccess && (applied ?? 0) > 0
      ? 'success'
      : 'warning'

  // Pagination : remise a la premiere page a chaque changement de filtre.
  const [page, setPage] = useState(0)
  useEffect(() => {
    setPage(0)
  }, [search, accountFilter, categoryFilter, monthFilter, onlyUncat])
  const filtersKey = [search, accountFilter, categoryFilter, monthFilter, onlyUncat ? '1' : '0'].join('|')
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)

  if (!txs) return <TransactionsSkeleton />

  return (
    <CategorizedContext.Provider value={onCategorized}>
    <div className="space-y-4">
      {/* Mobile : recherche pleine largeur + chips defilantes + feuille de filtres */}
      <div className="space-y-2.5 lg:hidden">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un libellé, une catégorie…"
            className="h-11 pl-10"
          />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => {
              setOnlyUncat(false)
              setAccountFilter('all')
              setCategoryFilter('all')
              setMonthFilter('all')
            }}
            className={chipClass(isAllChip)}
          >
            Tout
          </button>
          <button type="button" onClick={() => setOnlyUncat((v) => !v)} className={chipClass(onlyUncat)}>
            À catégoriser
            {uncatCount > 0 && (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-bold text-warning tnum">
                {uncatCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setMonthFilter((m) => (m === currentMonth() ? 'all' : currentMonth()))}
            className={chipClass(monthFilter === currentMonth())}
          >
            Ce mois
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={chipClass(sheetFilterCount > 0)}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtres
            {sheetFilterCount > 0 && (
              <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold text-accent tnum">
                {sheetFilterCount}
              </span>
            )}
          </button>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className={chipClass(false)} aria-label="Effacer les filtres">
              <X className="h-3.5 w-3.5" />
              Effacer
            </button>
          )}
        </div>
        <MobileFiltersSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          categoryOptions={categoryOptions}
          accountOptions={accountOptions}
          categoryFilter={categoryFilter}
          onCategoryChange={setCategoryFilter}
          accountFilter={accountFilter}
          onAccountChange={setAccountFilter}
          monthFilter={monthFilter}
          onMonthChange={setMonthFilter}
          monthMin={monthBounds.min}
          monthMax={monthBounds.max}
          hasFilters={hasFilters}
          onClear={clearFilters}
        />
      </div>

      {/* Desktop : barre de filtres inchangee */}
      <div className="hidden flex-wrap items-center gap-2.5 lg:flex">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un libellé, une catégorie…"
            className="pl-10"
          />
        </div>
        <Combobox
          options={categoryOptions}
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="Toutes les catégories"
          searchPlaceholder="Rechercher une catégorie…"
          className="w-48"
          aria-label="Filtrer par catégorie"
        />
        <Combobox
          options={accountOptions}
          value={accountFilter}
          onChange={setAccountFilter}
          placeholder="Tous les comptes"
          searchPlaceholder="Rechercher un compte…"
          className="w-44"
          aria-label="Filtrer par compte"
        />
        <MonthPicker
          value={monthFilter}
          onChange={setMonthFilter}
          min={monthBounds.min}
          max={monthBounds.max}
          allowAll
          className="w-40"
          aria-label="Filtrer par mois"
        />
        <button
          onClick={() => setOnlyUncat((v) => !v)}
          className={cn(
            'flex h-10 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-medium transition-colors',
            onlyUncat
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-line bg-surface text-soft hover:text-ink',
          )}
        >
          À catégoriser
          {uncatCount > 0 && (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-bold text-warning tnum">
              {uncatCount}
            </span>
          )}
        </button>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-[13px] font-medium text-soft transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
            Effacer les filtres
          </button>
        )}
        <Button onClick={() => setAddTxOpen(true)} className="hidden lg:inline-flex">
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {showApplyBanner && (
        <Card
          className={cn(
            'flex flex-wrap items-center gap-x-3.5 gap-y-3 px-4 py-3.5',
            applyTone === 'danger' && 'border-danger/30 bg-danger/[0.06]',
            applyTone === 'success' && 'border-success/30 bg-success/[0.06]',
            applyTone === 'warning' && 'border-warning/30 bg-warning/[0.06]',
          )}
        >
          <span
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              applyTone === 'danger' && 'bg-danger/15 text-danger',
              applyTone === 'success' && 'bg-success/15 text-success',
              applyTone === 'warning' && 'bg-warning/15 text-warning',
            )}
          >
            <Wand2 className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink">{applyTitle}</p>
            <p className="text-[13px] leading-snug text-soft">{applySub}</p>
          </div>
          <Button
            onClick={() => applyRules.mutate()}
            disabled={applyRules.isPending || uncatCount === 0}
            className="w-full shrink-0 sm:w-auto"
          >
            <Wand2 className="h-4 w-4" />
            {applyRules.isPending ? 'Catégorisation…' : 'Catégoriser automatiquement'}
          </Button>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Aucune transaction"
            description={
              onlyUncat
                ? 'Tout est catégorisé. Bravo, rien ne traîne.'
                : 'Aucune transaction ne correspond à ces filtres.'
            }
            actionLabel="Ajouter une transaction"
            onAction={() => setAddTxOpen(true)}
          />
        </Card>
      ) : (
        <>
          {/* Un seul arbre monte : les deux (table + liste) coutaient une
              centaine de pickers et de mesures clavier sur telephone. */}
          {isDesktop ? (
            <DesktopTable rows={rows} page={safePage} />
          ) : (
            <MobileList rows={rows} resetKey={filtersKey} />
          )}
          {pageCount > 1 && (
            <div className="hidden items-center justify-between gap-3 px-1 lg:flex">
              <p className="text-[12.5px] text-soft tnum">
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, rows.length)} sur{' '}
                {rows.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10 px-3.5"
                  onClick={() => setPage(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Précédent
                </Button>
                <Button
                  variant="outline"
                  className="h-10 px-3.5"
                  onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                  disabled={safePage >= pageCount - 1}
                >
                  Suivant
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <CategorizeToast
        data={toast}
        onApply={applyToast}
        onCreateRule={openRuleFromToast}
        onDismiss={dismissToast}
      />
      <CreateRuleDialog
        open={ruleDialog !== null}
        onOpenChange={(open) => !open && setRuleDialog(null)}
        initialValue={ruleDialog?.value ?? ''}
        initialCategoryId={ruleDialog?.categoryId}
      />
    </div>
    </CategorizedContext.Provider>
  )
}
