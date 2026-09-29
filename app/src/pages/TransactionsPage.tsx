import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Plus,
  ReceiptText,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import type { Transaction } from '@/types/domain'
import {
  countsAsUncategorized,
  useAccountsList,
  useAccountsMap,
  useBootstrap,
  useCategoriesList,
  useCategoriesMap,
  useGroupsList,
  useGroupsMap,
  useIsCrossBudgetTransfer,
} from '@/lib/data'
import { payeeDefaultOf, payeeKey, restorePayeeMemory, useCategorize } from '@/lib/categorize'
import { isUnconfirmedTx, txDayRank } from '@/lib/transactions'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useTransactions } from '@/lib/queries'
import { ruleValueFromLabel, useApplyRules, useRules } from '@/lib/rules'
import { currentMonth, monthOf } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { CreateRuleDialog } from '@/components/transactions/CreateRuleDialog'
import { MobileFiltersSheet } from '@/components/transactions/MobileFiltersSheet'
import { useCategorizeMany } from '@/components/transactions/useCategorizeMany'
import { EmptyState } from '@/components/shared/EmptyState'
import { Amount } from '@/components/shared/Amount'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { MonthPicker } from '@/components/ui/month-picker'
import { cn } from '@/lib/utils'
import { canSelect, normSearch, PAGE_SIZE, toRow, type Maps, type TxRow } from '@/components/transactions/txRow'
import { TxListContext, type TxListActions } from '@/components/transactions/listContext'
import { DesktopTable } from '@/components/transactions/DesktopTable'
import { MobileList } from '@/components/transactions/MobileList'
import { SelectionBar } from '@/components/transactions/SelectionBar'
import { TransactionDetail } from '@/components/transactions/TransactionDetail'
import { TransactionsSkeleton } from '@/components/transactions/TransactionsSkeleton'
import { TriageBanner } from '@/components/transactions/TriageBanner'
import { TxToast } from '@/components/transactions/TxToast'
import { dropFeedback, expireFeedback, showFeedback, useFeedbackStore } from '@/components/transactions/feedback'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// Puce de filtre (mobile) : 40px a l'oeil, zone tactile etendue a 44px.
const chipClass = (active: boolean) =>
  cn(
    "relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-medium ring-1 ring-inset transition-[background-color,color,box-shadow,transform] duration-150 ease-spring after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[''] active:scale-95",
    active
      ? 'bg-accent/10 text-accent-ink ring-accent/30 dark:text-accent'
      : 'bg-surface text-soft shadow-card ring-edge hover:text-ink',
  )

function SearchField({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <div className={cn('group relative', className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-colors group-focus-within:text-accent" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Rechercher une transaction…"
        aria-label="Rechercher une transaction"
        className="h-11 w-full rounded-xl border border-line bg-surface pl-10 pr-10 text-[16px] text-ink shadow-[inset_0_1px_2px_rgb(var(--ink)/0.03)] outline-none transition-[border-color,box-shadow] duration-150 ease-spring placeholder:text-soft/70 hover:border-soft/40 focus:border-accent/70 focus:ring-4 focus:ring-accent/15 lg:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Effacer la recherche"
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-soft transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

/** Totaux de la liste filtree : sorties et entrees (virements neutres exclus). */
function FilteredSummary({ rows, className }: { rows: TxRow[]; className?: string }) {
  const { outflow, inflow } = useMemo(() => {
    let out = 0
    let inc = 0
    for (const r of rows) {
      if (r.tx.transferGroupId && !r.cross) continue
      if (r.tx.amount < 0) out += r.tx.amount
      else inc += r.tx.amount
    }
    return { outflow: out, inflow: inc }
  }, [rows])
  return (
    <p className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px] text-soft tnum', className)}>
      <span className="font-medium text-ink">
        {rows.length} {plural(rows.length, 'transaction', 'transactions')}
      </span>
      {outflow !== 0 && (
        <span>
          · sorties <Amount cents={outflow} className="font-medium text-ink" />
        </span>
      )}
      {inflow !== 0 && (
        <span>
          · entrées <Amount cents={inflow} signed className="font-medium text-success" />
        </span>
      )}
    </p>
  )
}

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
  const isCross = useIsCrossBudgetTransfer()
  const categorize = useCategorize()
  const categorizeMany = useCategorizeMany()

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

  // Comptes et categories presents dans les transactions : un compte clos ou
  // une categorie masquee n'apparait dans les filtres que s'il a des lignes.
  const usage = useMemo(() => {
    const accountIds = new Set<string>()
    const categoryIds = new Set<string>()
    for (const t of txs ?? []) {
      accountIds.add(t.accountId)
      if (t.categoryId) categoryIds.add(t.categoryId)
    }
    return { accountIds, categoryIds }
  }, [txs])

  // Options du combobox categorie : regroupees par groupe, pastille coloree.
  const categoryOptions = useMemo<ComboboxOption[]>(() => {
    const opts: ComboboxOption[] = [{ value: 'all', label: 'Toutes les catégories' }]
    for (const group of groupsList.slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      for (const cat of categoriesList
        .filter((c) => c.groupId === group.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)) {
        const hidden = cat.hidden || group.hidden
        if (hidden && !usage.categoryIds.has(cat.id) && cat.id !== categoryFilter) continue
        opts.push({
          value: cat.id,
          label: hidden ? `${cat.name} (masquée)` : cat.name,
          group: group.name,
          colorVar: `cat-${group.color}-fg`,
        })
      }
    }
    return opts
  }, [groupsList, categoriesList, usage, categoryFilter])

  // Options du combobox compte (clotures en dernier, marques).
  const accountOptions = useMemo<ComboboxOption[]>(
    () => [
      { value: 'all', label: 'Tous les comptes' },
      ...accounts.filter((a) => !a.closed).map((a) => ({ value: a.id, label: a.name })),
      ...accounts
        .filter((a) => a.closed && (usage.accountIds.has(a.id) || a.id === accountFilter))
        .map((a) => ({ value: a.id, label: `${a.name} (clôturé)` })),
    ],
    [accounts, usage, accountFilter],
  )

  const hasFilters =
    Boolean(search) || accountFilter !== 'all' || categoryFilter !== 'all' || monthFilter !== 'all' || onlyUncat

  const clearFilters = () => {
    setSearch('')
    setAccountFilter('all')
    setCategoryFilter('all')
    setMonthFilter('all')
    setOnlyUncat(false)
  }

  // Non categorisee au sens du badge : compte budget, hors transfert neutre,
  // pas dans le futur ni avant le mois de depart (meme regle que le compteur
  // de la nav, sinon chip et badge se contredisaient apres « Nouveau budget »).
  const isUncat = useCallback(
    (t: Transaction) => countsAsUncategorized(queryClient, t),
    // La taxonomie est lue dans le cache ; on recalcule quand elle change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, boot.data, txs],
  )

  // Moities de virement par groupe (compte miroir d'une ligne).
  const peers = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of txs ?? []) {
      if (!t.transferGroupId) continue
      const list = map.get(t.transferGroupId)
      if (list) list.push(t)
      else map.set(t.transferGroupId, [t])
    }
    return map
  }, [txs])
  const peerOf = useCallback(
    (t: Transaction) => (t.transferGroupId ? peers.get(t.transferGroupId)?.find((o) => o.id !== t.id) : undefined),
    [peers],
  )

  // Ordre stable au sein d'un jour (cf. txDayRank) : une saisie reste en tete
  // de sa journee, meme apres la reconciliation serveur.
  const rank = useMemo(() => (txs ? txDayRank(txs) : () => 0), [txs])

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
      .map((t) => toRow(t, maps, { isCross, peerOf, isUncat }))
      .filter((r): r is TxRow => r !== null)
      .filter(
        (r) =>
          !q ||
          normSearch(r.tx.label).includes(q) ||
          normSearch(r.name).includes(q) ||
          (r.category ? normSearch(r.category.name).includes(q) : false) ||
          (r.tx.note ? normSearch(r.tx.note).includes(q) : false) ||
          (r.tx.counterparty ? normSearch(r.tx.counterparty).includes(q) : false),
      )
      .sort((a, b) =>
        a.tx.date !== b.tx.date ? (a.tx.date < b.tx.date ? 1 : -1) : rank(a.tx.id) - rank(b.tx.id),
      )
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
    isCross,
    peerOf,
    rank,
  ])

  const uncatCount = useMemo(() => (txs ?? []).filter(isUncat).length, [txs, isUncat])

  // ---------------------------------------------------------------------------
  // Retours (toast unique) apres une categorisation manuelle
  // ---------------------------------------------------------------------------

  const [ruleDialog, setRuleDialog] = useState<{ value: string; categoryId?: string } | null>(null)
  const openCreateRule = useCallback((value: string, categoryId?: string) => setRuleDialog({ value, categoryId }), [])

  // Categorisation manuelle d'une ligne (pastille, detail) : optimiste, puis
  // « Catégorisé dans X » + « Annuler » (retour a la categorie d'avant par la
  // meme mutation optimiste) ; si d'autres transactions du meme tiers restent a
  // categoriser, « Appliquer aux N autres » ; « Créer une règle ». Aucune
  // lecture reseau : tout vient du cache.
  const categorizeRow = useCallback<TxListActions['categorizeRow']>(
    (row, categoryId) => {
      const previous = row.tx.categoryId
      if (categoryId === previous) return
      haptic(10)
      const category = categoryId ? categoryById.get(categoryId) : undefined
      const memoryBefore = payeeDefaultOf(queryClient, row.tx.label)
      const txId = row.tx.id
      const payee = payeeKey(row.tx.label)
      const similarIds =
        categoryId && payee
          ? (txs ?? [])
              .filter((t) => t.id !== txId && !isUnconfirmedTx(t.id) && isUncat(t) && payeeKey(t.label) === payee)
              .map((t) => t.id)
          : []
      const links = []
      if (category && similarIds.length > 0) {
        const n = similarIds.length
        links.push({
          label: `Appliquer ${plural(n, "à l'autre", `aux ${n} autres`)}`,
          onClick: () => {
            haptic([10, 30, 10])
            const toastKey = showFeedback({
              message: `${n} ${plural(n, 'autre transaction', 'autres transactions')}`,
              description: `${plural(n, 'Catégorisée', 'Catégorisées')} dans ${category.name}`,
              icon: 'check',
              undo: () => categorizeMany.mutate({ txIds: similarIds, categoryId: null }),
            })
            // Echec : le toast d'erreur global prend le relais.
            categorizeMany.mutate(
              { txIds: similarIds, categoryId: category.id },
              { onError: () => dropFeedback(toastKey) },
            )
          },
        })
      }
      if (category && !category.isIncome && !row.tx.transferGroupId) {
        links.push({
          label: 'Créer une règle',
          onClick: () => {
            expireFeedback()
            openCreateRule(ruleValueFromLabel(row.tx.label), category.id)
          },
        })
      }
      const tx = row.tx
      const toastKey = showFeedback({
        message: category ? `Catégorisé dans ${category.name}` : 'Remis à catégoriser',
        description: row.name,
        icon: 'check',
        undo: () => {
          categorize.mutate({ txId, categoryId: previous })
          // Le choix annule ne doit pas rester le defaut du tiers.
          restorePayeeMemory(queryClient, tx, categoryId, memoryBefore)
        },
        links,
        duration: links.length > 0 ? 6500 : 5000,
      })
      // Apres le toast : il a lu l'etat d'avant (memoire de tiers, similaires).
      // Echec : retour arriere discret, le toast d'erreur global prend le relais.
      categorize.mutate({ txId, categoryId }, { onError: () => dropFeedback(toastKey) })
    },
    [categoryById, queryClient, txs, isUncat, categorizeMany, categorize, openCreateRule],
  )

  // ---------------------------------------------------------------------------
  // Detail d'une ligne
  // ---------------------------------------------------------------------------

  const [detailId, setDetailId] = useState<string | null>(null)
  const openDetail = useCallback((row: TxRow) => setDetailId(row.tx.id), [])
  const closeDetail = useCallback(() => setDetailId(null), [])

  const listActions = useMemo<TxListActions>(
    () => ({ categorizeRow, openDetail, openCreateRule, singleAccount: accountFilter !== 'all' }),
    [categorizeRow, openDetail, openCreateRule, accountFilter],
  )

  // ---------------------------------------------------------------------------
  // Selection multiple (cases desktop, appui long mobile)
  // ---------------------------------------------------------------------------

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const setMany = useCallback((ids: string[], value: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (value) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])
  const toggleRow = useCallback(
    (row: TxRow) => {
      if (!canSelect(row)) return
      haptic(6)
      setMany([row.tx.id], !selectedRef.current.has(row.tx.id))
    },
    [setMany],
  )
  const enterSelect = useCallback(
    (row: TxRow) => {
      if (!canSelect(row)) return
      haptic(15)
      setMany([row.tx.id], true)
    },
    [setMany],
  )

  // Les lignes qui quittent la liste (filtre, categorisation sous « À
  // catégoriser », suppression) quittent aussi la selection.
  useEffect(() => {
    const visible = new Set(rows.map((r) => r.tx.id))
    if ([...selectedRef.current].some((id) => !visible.has(id))) {
      setSelected((prev) => new Set([...prev].filter((id) => visible.has(id))))
    }
  }, [rows])

  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size, clearSelection])

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.tx.id)), [rows, selected])
  // « Sélectionner les similaires » : lignes a categoriser des memes tiers.
  const similarIds = useMemo(() => {
    if (selectedRows.length === 0) return []
    const keys = new Set(selectedRows.map((r) => payeeKey(r.tx.label)).filter(Boolean))
    if (keys.size === 0) return []
    return rows
      .filter((r) => !selected.has(r.tx.id) && r.uncategorized && canSelect(r) && keys.has(payeeKey(r.tx.label)))
      .map((r) => r.tx.id)
  }, [rows, selectedRows, selected])

  const categorizeSelection = (categoryId: string | null) => {
    const targets = selectedRows.filter(canSelect)
    if (targets.length === 0) return
    haptic([10, 30, 10])
    const previous = new Map(targets.map((r) => [r.tx.id, r.tx.categoryId]))
    clearSelection()
    const n = targets.length
    const category = categoryId ? categoryById.get(categoryId) : undefined
    const toastKey = showFeedback({
      message: `${n} ${plural(n, 'transaction', 'transactions')}`,
      description: category
        ? `${plural(n, 'Catégorisée', 'Catégorisées')} dans ${category.name}`
        : `${plural(n, 'Remise', 'Remises')} à catégoriser`,
      icon: 'check',
      // Chaque ligne retrouve SA categorie d'avant (un appel par categorie).
      undo: () => {
        const byPrevious = new Map<string | null, string[]>()
        for (const [id, prev] of previous) byPrevious.set(prev, [...(byPrevious.get(prev) ?? []), id])
        for (const [prev, ids] of byPrevious) categorizeMany.mutate({ txIds: ids, categoryId: prev })
      },
    })
    categorizeMany.mutate({ txIds: [...previous.keys()], categoryId }, { onError: () => dropFeedback(toastKey) })
  }

  // ---------------------------------------------------------------------------
  // Categorisation automatique (regles)
  // ---------------------------------------------------------------------------

  const { data: rules } = useRules()
  const applyRules = useApplyRules()
  const ruleCount = rules?.length ?? 0

  // Filtres mobile : puces + feuille basse (memes etats que la barre desktop).
  const [filtersOpen, setFiltersOpen] = useState(false)
  const sheetFilterCount =
    (accountFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (monthFilter !== 'all' ? 1 : 0)
  const isAllChip = !onlyUncat && sheetFilterCount === 0

  // Pagination : remise a la premiere page a chaque changement de filtre.
  const [page, setPage] = useState(0)
  useEffect(() => {
    setPage(0)
  }, [search, accountFilter, categoryFilter, monthFilter, onlyUncat])
  const filtersKey = [search, accountFilter, categoryFilter, monthFilter, onlyUncat ? '1' : '0'].join('|')
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)

  // La barre de selection desktop occupe le bas : le toast se pose au-dessus.
  const feedbackVisible = useFeedbackStore((s) => s.item !== null)

  if (!txs) return <TransactionsSkeleton />

  const trierLink = uncatCount > 0 && (
    <Link
      to="/trier"
      className={cn(
        chipClass(false),
        'bg-accent/15 font-semibold text-accent-ink shadow-none ring-accent/30 hover:bg-accent/20 hover:text-accent-ink dark:text-accent lg:h-10 lg:rounded-xl',
      )}
    >
      Trier
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )

  const uncatBadge = uncatCount > 0 && (
    <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-bold leading-none text-warning tnum">
      {uncatCount}
    </span>
  )

  return (
    <TxListContext.Provider value={listActions}>
      <div className="space-y-4">
        {/* Mobile : recherche pleine largeur + puces defilantes + feuille de filtres */}
        <div className="space-y-3 lg:hidden">
          <SearchField value={search} onChange={setSearch} />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => {
                setOnlyUncat(false)
                setAccountFilter('all')
                setCategoryFilter('all')
                setMonthFilter('all')
              }}
              className={chipClass(isAllChip)}
              aria-pressed={isAllChip}
            >
              Tout
            </button>
            <button
              type="button"
              onClick={() => setOnlyUncat((v) => !v)}
              className={chipClass(onlyUncat)}
              aria-pressed={onlyUncat}
            >
              À catégoriser
              {uncatBadge}
            </button>
            {trierLink}
            <button
              type="button"
              onClick={() => setMonthFilter((m) => (m === currentMonth() ? 'all' : currentMonth()))}
              className={chipClass(monthFilter === currentMonth())}
              aria-pressed={monthFilter === currentMonth()}
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
                <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-bold leading-none tnum">
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
          {hasFilters && rows.length > 0 && <FilteredSummary rows={rows} className="px-1" />}
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
            resultCount={rows.length}
          />
        </div>

        {/* Desktop : recherche + ajout, puis filtres et resume de la liste */}
        <div className="hidden space-y-3 lg:block">
          <div className="flex items-center gap-3">
            <SearchField value={search} onChange={setSearch} className="flex-1" />
            <Button onClick={() => setAddTxOpen(true)} className="h-11">
              <Plus className="h-4 w-4" />
              Ajouter
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Combobox
              options={categoryOptions}
              value={categoryFilter}
              onChange={setCategoryFilter}
              placeholder="Toutes les catégories"
              searchPlaceholder="Rechercher une catégorie…"
              className="w-52"
              aria-label="Filtrer par catégorie"
            />
            <Combobox
              options={accountOptions}
              value={accountFilter}
              onChange={setAccountFilter}
              placeholder="Tous les comptes"
              searchPlaceholder="Rechercher un compte…"
              className="w-48"
              aria-label="Filtrer par compte"
            />
            <MonthPicker
              value={monthFilter}
              onChange={setMonthFilter}
              min={monthBounds.min}
              max={monthBounds.max}
              allowAll
              className="w-44"
              aria-label="Filtrer par mois"
            />
            <button
              type="button"
              onClick={() => setOnlyUncat((v) => !v)}
              aria-pressed={onlyUncat}
              className={cn(chipClass(onlyUncat), 'rounded-xl')}
            >
              À catégoriser
              {uncatBadge}
            </button>
            {trierLink}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className={cn(chipClass(false), 'rounded-xl bg-transparent shadow-none ring-transparent')}
              >
                <X className="h-3.5 w-3.5" />
                Effacer les filtres
              </button>
            )}
          </div>
          {hasFilters && rows.length > 0 && <FilteredSummary rows={rows} className="px-1" />}
        </div>

        <TriageBanner
          uncatCount={uncatCount}
          ruleCount={ruleCount}
          applying={applyRules.isPending}
          applied={applyRules.isSuccess ? (applyRules.data ?? 0) : null}
          applyError={applyRules.isError ? (applyRules.error?.message ?? 'Réessaie dans un instant.') : null}
          onApplyRules={() => applyRules.mutate()}
        />

        {rows.length === 0 ? (
          <Card>
            {txs.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="Aucune transaction pour l’instant"
                description="Ajoute ta première dépense, ou connecte ta banque dans les réglages pour les importer."
                actionLabel="Ajouter une transaction"
                onAction={() => setAddTxOpen(true)}
              />
            ) : onlyUncat && !search && sheetFilterCount === 0 ? (
              <EmptyState
                icon={CheckCheck}
                tone="success"
                title="Tout est catégorisé"
                description="Rien ne traîne : ton budget est à jour."
                actionLabel="Voir toutes les transactions"
                onAction={clearFilters}
              />
            ) : (
              <EmptyState
                icon={SearchX}
                title="Aucun résultat"
                description="Aucune transaction ne correspond à ces filtres."
                actionLabel="Effacer les filtres"
                onAction={clearFilters}
              />
            )}
          </Card>
        ) : (
          <>
            {/* Un seul arbre monte : les deux (table + liste) coutaient une
                centaine de pickers et de mesures clavier sur telephone. */}
            {isDesktop ? (
              <DesktopTable
                rows={rows}
                page={safePage}
                selected={selected}
                onSetMany={setMany}
                hideAccount={accountFilter !== 'all'}
              />
            ) : (
              <MobileList
                rows={rows}
                resetKey={filtersKey}
                selected={selected}
                onLongPress={enterSelect}
                onToggle={toggleRow}
              />
            )}
            {isDesktop && pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 px-1">
                <p className="text-[13px] text-soft tnum">
                  {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, rows.length)} sur {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="px-3.5"
                    onClick={() => setPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Précédent
                  </Button>
                  <Button
                    variant="outline"
                    className="px-3.5"
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

        {selected.size > 0 && (
          <SelectionBar
            variant={isDesktop ? 'desktop' : 'mobile'}
            count={selected.size}
            total={selectedRows.reduce((s, r) => s + r.tx.amount, 0)}
            label={selectedRows[0]?.tx.label}
            includeIncome={selectedRows.some((r) => r.tx.amount > 0)}
            similarCount={similarIds.length}
            onCategorize={categorizeSelection}
            onSelectSimilar={() => {
              haptic(8)
              setMany(similarIds, true)
            }}
            onClear={clearSelection}
          />
        )}

        <TxToast bottomInset={isDesktop && selected.size > 0 && feedbackVisible ? 64 : 0} />
        <TransactionDetail txId={detailId} onClose={closeDetail} />
        <CreateRuleDialog
          open={ruleDialog !== null}
          onOpenChange={(open) => !open && setRuleDialog(null)}
          initialValue={ruleDialog?.value ?? ''}
          initialCategoryId={ruleDialog?.categoryId}
        />
      </div>
    </TxListContext.Provider>
  )
}
