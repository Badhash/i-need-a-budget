import { useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDownUp } from 'lucide-react'
import { fmtDateShort } from '@/lib/format'
import { TxKindChip } from '@/components/transactions/TxKindChip'
import { Amount } from '@/components/shared/Amount'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { type TxRow, PAGE_SIZE } from '@/components/transactions/txRow'
import { RowMenu } from '@/components/transactions/RowMenu'
import { CategoryBadge } from '@/components/transactions/CategoryBadge'
import { AccountChip } from '@/components/transactions/AccountChip'

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
            <AccountChip account={row.account} />
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

// Recoit TOUTES les lignes filtrees : le tri par colonne s'applique a
// l'ensemble, la page n'est decoupee qu'apres (sinon « trier par montant »
// ne triait que les 50 lignes de la page courante).
export function DesktopTable({ rows, page }: { rows: TxRow[]; page: number }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    // Id stable : sans lui, l'etat d'une ligne (menu, erreur) suivait l'index et
    // se retrouvait sur la ligne suivante apres une suppression optimiste.
    getRowId: (row) => row.tx.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const pageRows = table.getRowModel().rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

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
          {pageRows.map((row) => (
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
