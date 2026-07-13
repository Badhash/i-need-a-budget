import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDownUp, ArrowLeftRight, Inbox, MoreHorizontal, Plus, Search } from 'lucide-react'
import type { Account, Category, CategoryGroup, Transaction } from '@/mocks/data'
import { apiCategorize, useAccountsList, useAccountsMap, useBootstrap, useCategoriesMap, useGroupsMap } from '@/lib/data'
import { apiCall } from '@/lib/api'
import { parseBankLabel, type ParsedLabel } from '@/lib/bankLabel'
import { useTransactions } from '@/lib/queries'
import { fmtDateShort, fmtDayLong, monthOf } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { TxKindChip } from '@/components/transactions/TxKindChip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface TxRow {
  tx: Transaction
  account: Account
  category: Category | null
  group: CategoryGroup | null
  parsed: ParsedLabel
}

type Maps = {
  accountById: Map<string, Account>
  categoryById: Map<string, Category>
  groupById: Map<string, CategoryGroup>
}

function toRow(tx: Transaction, maps: Maps): TxRow | null {
  const account = maps.accountById.get(tx.accountId)
  if (!account) return null
  const category = tx.categoryId ? (maps.categoryById.get(tx.categoryId) ?? null) : null
  const group = category ? (maps.groupById.get(category.groupId) ?? null) : null
  return { tx, account, category, group, parsed: parseBankLabel(tx.label) }
}

// Categorisation optimiste : le cache TanStack est mis a jour immediatement,
// l'appel reseau part en arriere-plan, rollback discret en cas d'echec.
function useCategorize() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ txId, categoryId }: { txId: string; categoryId: string | null }) =>
      apiCategorize(txId, categoryId),
    onMutate: async ({ txId, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      const snapshot = queryClient.getQueryData<Transaction[]>(['transactions'])
      queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
        old?.map((t) => (t.id === txId ? { ...t, categoryId } : t)),
      )
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
    },
    // Reconciliation silencieuse en arriere-plan (budget, compteurs, etc.)
    onSettled: () => queryClient.invalidateQueries(),
  })
}

// Menu discret par ligne : conversion transaction <-> virement entre comptes.
function RowMenu({ row, className }: { row: TxRow; className?: string }) {
  const queryClient = useQueryClient()
  const accounts = useAccountsList()
  const [error, setError] = useState<string | null>(null)
  const isTransfer = Boolean(row.tx.transferGroupId)
  const targets = accounts.filter((a) => a.id !== row.tx.accountId)

  const convert = useMutation({
    mutationFn: (targetAccountId: string) =>
      apiCall('convertToTransfer', { transactionId: row.tx.id, targetAccountId }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err) => showError(err),
  })
  const revert = useMutation({
    mutationFn: () => apiCall('convertTransferToNormal', { transactionId: row.tx.id }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (err) => showError(err),
  })

  function showError(err: unknown) {
    setError(err instanceof Error ? err.message : 'Une erreur est survenue.')
    window.setTimeout(() => setError(null), 4000)
  }

  return (
    <div className={cn('relative', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Actions sur la transaction"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-soft transition-colors hover:bg-surface2 hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isTransfer ? (
            <DropdownMenuItem onSelect={() => revert.mutate()}>
              Annuler le virement
            </DropdownMenuItem>
          ) : targets.length > 0 ? (
            <>
              <DropdownMenuLabel>Convertir en virement vers…</DropdownMenuLabel>
              {targets.map((acc) => (
                <DropdownMenuItem key={acc.id} onSelect={() => convert.mutate(acc.id)}>
                  {acc.name}
                </DropdownMenuItem>
              ))}
            </>
          ) : (
            <DropdownMenuLabel>Aucun autre compte</DropdownMenuLabel>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="status"
          className="absolute right-0 top-full z-10 mt-1 max-w-[220px] whitespace-normal rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-[12px] text-danger shadow-card"
        >
          {error}
        </p>
      )}
    </div>
  )
}

function CategoryBadge({ row }: { row: TxRow }) {
  const categorize = useCategorize()

  if (row.tx.transferGroupId) {
    return (
      <Badge variant="neutral">
        <ArrowLeftRight className="h-3 w-3" />
        Transfert
      </Badge>
    )
  }

  // after:-inset-2 : etend la zone tactile sans grossir la pastille
  const hitArea = "relative after:absolute after:-inset-2 after:content-['']"

  const trigger = row.category ? (
    <button
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-opacity hover:opacity-75',
        hitArea,
      )}
      style={{
        backgroundColor: row.group ? `var(--cat-${row.group.color}-bg)` : undefined,
        color: row.group ? `var(--cat-${row.group.color}-fg)` : undefined,
      }}
      aria-label={`Changer la catégorie (${row.category.name})`}
    >
      <span className="truncate">{row.category.name}</span>
    </button>
  ) : (
    <button
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-[12px] font-semibold text-warning transition-opacity hover:opacity-75',
        hitArea,
      )}
      aria-label="Choisir une catégorie"
    >
      À catégoriser
    </button>
  )

  return (
    <CategoryPicker
      includeIncome={row.tx.amount > 0}
      onSelect={(categoryId) => categorize.mutate({ txId: row.tx.id, categoryId })}
    >
      {trigger}
    </CategoryPicker>
  )
}

const columnHelper = createColumnHelper<TxRow>()

const columns = [
  columnHelper.accessor((r) => r.tx.date, {
    id: 'date',
    header: 'Date',
    cell: (info) => <span className="text-soft tnum">{fmtDateShort(info.getValue())}</span>,
  }),
  columnHelper.accessor((r) => r.tx.label, {
    id: 'label',
    header: 'Libellé',
    enableSorting: false,
    cell: (info) => {
      const row = info.row.original
      return (
        <div className="min-w-0">
          <p className="truncate font-medium" title={row.tx.label}>
            {row.parsed.short}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            {/* Les transferts gardent leur badge dedie : pas de double chip */}
            {!row.tx.transferGroupId && <TxKindChip kind={row.parsed.kind} />}
            <p className="truncate text-[12px] text-soft">{row.account.name}</p>
          </div>
        </div>
      )
    },
  }),
  columnHelper.display({
    id: 'category',
    header: 'Catégorie',
    cell: (info) => <CategoryBadge row={info.row.original} />,
  }),
  columnHelper.accessor((r) => r.tx.amount, {
    id: 'amount',
    header: 'Montant',
    cell: (info) => (
      <Amount
        cents={info.getValue()}
        signed={info.getValue() > 0}
        className={cn('font-semibold', info.getValue() > 0 ? 'text-success' : undefined, info.getValue() < 0 && 'text-ink')}
      />
    ),
  }),
  columnHelper.display({
    id: 'actions',
    cell: (info) => <RowMenu row={info.row.original} />,
  }),
]

function DesktopTable({ rows }: { rows: TxRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <Card className="hidden overflow-hidden lg:block">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-line">
            {table.getFlatHeaders().map((header) => {
              const sorted = header.column.getIsSorted()
              return (
                <th
                  key={header.id}
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={cn(
                    'px-5 py-3 text-left label-caps font-medium',
                    header.id === 'amount' && 'text-right',
                    header.id === 'date' && 'w-28',
                    header.id === 'category' && 'w-48',
                    header.id === 'amount' && 'w-36',
                    header.id === 'actions' && 'w-12',
                  )}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 rounded transition-colors hover:text-ink label-caps font-medium"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowDownUp className={cn('h-3 w-3', sorted ? 'opacity-90' : 'opacity-50')} />
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="group border-t border-line/60 transition-colors hover:bg-surface2/40">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn('px-5 py-3', cell.column.id === 'amount' && 'text-right')}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function MobileList({ rows }: { rows: TxRow[] }) {
  const byDay = useMemo(() => {
    const map = new Map<string, TxRow[]>()
    for (const row of rows) {
      const list = map.get(row.tx.date) ?? []
      list.push(row)
      map.set(row.tx.date, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [rows])

  return (
    <div className="space-y-5 lg:hidden">
      {byDay.map(([date, dayRows]) => (
        <div key={date}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <p className="text-[13px] font-semibold text-soft">{fmtDayLong(date)}</p>
            <Amount
              cents={dayRows.reduce((s, r) => s + r.tx.amount, 0)}
              className="text-[12px] font-medium text-soft"
            />
          </div>
          <Card className="divide-y divide-line/60 overflow-hidden">
            {dayRows.map((row) => (
              <div key={row.tx.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3">
                <GroupPill group={row.group ?? undefined} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={row.tx.label}>
                    {row.parsed.short}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <CategoryBadge row={row} />
                    {/* Les transferts gardent leur badge dedie : pas de double chip */}
                    {!row.tx.transferGroupId && <TxKindChip kind={row.parsed.kind} />}
                  </div>
                </div>
                <Amount
                  cents={row.tx.amount}
                  signed={row.tx.amount > 0}
                  className={cn('font-semibold', row.tx.amount > 0 && 'text-success')}
                />
                <RowMenu row={row} className="-mr-1" />
              </div>
            ))}
          </Card>
        </div>
      ))}
    </div>
  )
}

function TransactionsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Card className="space-y-4 p-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </Card>
    </div>
  )
}

export function TransactionsPage() {
  const month = useUiStore((s) => s.month)
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  const { data: txs } = useTransactions()
  const boot = useBootstrap()
  const accounts = useAccountsList()
  const accountById = useAccountsMap()
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()

  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('all')
  const [onlyUncat, setOnlyUncat] = useState(false)

  const rows = useMemo(() => {
    if (!txs || !boot.data) return []
    const maps: Maps = { accountById, categoryById, groupById }
    const q = search.trim().toLowerCase()
    return txs
      .filter((t) => monthOf(t.date) === month)
      .filter((t) => accountFilter === 'all' || t.accountId === accountFilter)
      .filter((t) => !onlyUncat || (!t.categoryId && !t.transferGroupId))
      .map((t) => toRow(t, maps))
      .filter((r): r is TxRow => r !== null)
      .filter(
        (r) =>
          !q ||
          r.tx.label.toLowerCase().includes(q) ||
          r.parsed.short.toLowerCase().includes(q) ||
          (r.category?.name.toLowerCase().includes(q) ?? false),
      )
  }, [txs, boot.data, month, search, accountFilter, onlyUncat])

  const uncatCount = useMemo(
    () => (txs ?? []).filter((t) => monthOf(t.date) === month && !t.categoryId && !t.transferGroupId).length,
    [txs, month],
  )

  if (!txs) return <TransactionsSkeleton />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un libellé, une catégorie…"
            className="pl-10"
          />
        </div>
        <Select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="w-44"
        >
          <option value="all">Tous les comptes</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
        </Select>
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
        <Button onClick={() => setAddTxOpen(true)} className="hidden lg:inline-flex">
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Inbox}
            title="Aucune transaction"
            description={
              onlyUncat
                ? 'Tout est catégorisé pour ce mois. Bravo, rien ne traîne.'
                : 'Aucune transaction ne correspond à ces filtres pour ce mois.'
            }
            actionLabel="Ajouter une transaction"
            onAction={() => setAddTxOpen(true)}
          />
        </Card>
      ) : (
        <>
          <DesktopTable rows={rows} />
          <MobileList rows={rows} />
        </>
      )}
    </div>
  )
}
