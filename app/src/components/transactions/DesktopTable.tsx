import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Minus } from 'lucide-react'
import { fmtDateShort } from '@/lib/format'
import { isFreshlyAdded } from '@/lib/transactions'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { canSelect, detailLine, PAGE_SIZE, type TxRow } from '@/components/transactions/txRow'
import { RowMenu } from '@/components/transactions/RowMenu'
import { CategoryBadge } from '@/components/transactions/CategoryBadge'
import { AccountLabel } from '@/components/transactions/AccountChip'
import { DayTitle, TxAmount, TxBubble } from '@/components/transactions/rowParts'
import { useTxList } from '@/components/transactions/listContext'

/** Case a cocher du tableau (etat mixte pour l'en-tete). */
function Checkbox({
  checked,
  onToggle,
  label,
  disabled = false,
}: {
  checked: boolean | 'mixed'
  onToggle: (e: MouseEvent<HTMLButtonElement>) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(e)
      }}
      // Shift+clic : pas de selection de texte parasite.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault()
      }}
      className={cn(
        "relative flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition-[background-color,border-color,box-shadow] duration-150 after:absolute after:-inset-2.5 after:content-[''] disabled:cursor-not-allowed disabled:opacity-30",
        checked
          ? 'border-accent bg-accent text-accentfg shadow-button'
          : 'border-soft/45 bg-surface hover:border-accent/70',
      )}
    >
      {checked === 'mixed' ? (
        <Minus className="h-3 w-3" strokeWidth={3.2} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3.2} />
      ) : null}
    </button>
  )
}

/** Premiere cellule : libelle court, ligne discrete (contrepartie, note). */
function LabelCell({ row }: { row: TxRow }) {
  const { openDetail } = useTxList()
  const detail = detailLine(row)
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TxBubble row={row} size="sm" />
      <div className="min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openDetail(row)
          }}
          className="block max-w-full truncate text-left text-[14px] font-semibold tracking-tight text-ink hover:underline hover:decoration-soft/50 hover:underline-offset-4"
          title={row.tx.label}
        >
          {row.name}
        </button>
        {detail && <p className="truncate text-[12.5px] leading-snug text-soft">{detail}</p>}
      </div>
    </div>
  )
}

const columnHelper = createColumnHelper<TxRow>()

const columns = [
  columnHelper.display({ id: 'select', header: '' }),
  columnHelper.accessor((r) => r.tx.date, {
    id: 'date',
    header: 'Date',
    sortDescFirst: true,
    cell: (info) => <span className="whitespace-nowrap text-soft tnum">{fmtDateShort(info.getValue())}</span>,
  }),
  columnHelper.accessor((r) => r.tx.label, {
    id: 'label',
    header: 'Libellé',
    enableSorting: false,
    cell: (info) => <LabelCell row={info.row.original} />,
  }),
  columnHelper.accessor((r) => r.account.name, {
    id: 'account',
    header: 'Compte',
    enableSorting: false,
    cell: (info) => {
      const row = info.row.original
      return (
        <AccountLabel
          account={row.account}
          peer={row.cross ? row.peerAccount : null}
          outgoing={row.tx.amount < 0}
          className="max-w-full text-[13px]"
        />
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
    sortDescFirst: false,
    cell: (info) => <TxAmount row={info.row.original} className="text-[14px]" />,
  }),
  columnHelper.display({
    id: 'actions',
    cell: (info) => <RowMenu row={info.row.original} />,
  }),
]

const WIDTHS: Record<string, string> = {
  select: 'w-12 pl-5 pr-0',
  date: 'w-28',
  account: 'w-44',
  category: 'w-52',
  amount: 'w-36 text-right',
  actions: 'w-12 pl-0 pr-4',
}

interface RowViewProps {
  row: TxRow
  cells: { id: string; node: React.ReactNode }[]
  selected: boolean
  onToggle: (row: TxRow, e: MouseEvent<HTMLButtonElement>) => void
}

function RowView({ row, cells, selected, onToggle }: RowViewProps) {
  const { openDetail } = useTxList()
  const [flash, setFlash] = useState(() => isFreshlyAdded(row.tx.id))
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), 900)
    return () => window.clearTimeout(timer)
  }, [flash])
  const selectable = canSelect(row)
  return (
    <tr
      aria-selected={selected || undefined}
      onClick={(e) => {
        // Clic sur la ligne (hors controles) : detail. Shift+clic : plage.
        const target = e.target as HTMLElement
        if (target.closest('button, a, input, [role="menuitem"]')) return
        if (e.shiftKey && selectable) {
          onToggle(row, e as unknown as MouseEvent<HTMLButtonElement>)
          return
        }
        openDetail(row)
      }}
      className={cn(
        'group cursor-pointer border-t border-edge transition-colors duration-500',
        selected ? 'bg-accent/[0.06] hover:bg-accent/[0.08]' : 'hover:bg-ink/[0.025]',
        flash && 'bg-accent/10',
      )}
    >
      {cells.map(({ id, node }) => (
        <td key={id} className={cn('px-4 py-2.5 align-middle', WIDTHS[id], id === 'select' && 'py-0')}>
          {id === 'select' ? (
            <Checkbox
              checked={selected}
              disabled={!selectable}
              label={`Sélectionner ${row.name}`}
              onToggle={(e) => onToggle(row, e)}
            />
          ) : (
            node
          )}
        </td>
      ))}
    </tr>
  )
}

interface DesktopTableProps {
  rows: TxRow[]
  page: number
  selected: ReadonlySet<string>
  onSetMany: (ids: string[], value: boolean) => void
  /** Filtre compte actif : colonne Compte masquee. */
  hideAccount: boolean
}

// Recoit TOUTES les lignes filtrees : le tri par colonne s'applique a
// l'ensemble, la page n'est decoupee qu'apres (sinon « trier par montant »
// ne triait que les 50 lignes de la page courante). Trie par date (defaut),
// les lignes sont groupees par jour sous des en-tetes collants ; trie par
// montant, la liste est plate avec une colonne Date.
export function DesktopTable({ rows, page, selected, onSetMany, hideAccount }: DesktopTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])
  const grouped = sorting.length === 0 || sorting[0]?.id === 'date'
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility: { date: !grouped, account: !hideAccount } },
    onSortingChange: setSorting,
    // Id stable : l'etat d'une ligne (menu, selection) ne suit pas son index,
    // et une ligne tout juste confirmee garde son element.
    getRowId: (row) => row.key,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })
  const pageRows = table.getRowModel().rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Totaux par jour sur l'ensemble des lignes filtrees (pas seulement la page).
  const dayTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of rows) totals.set(r.tx.date, (totals.get(r.tx.date) ?? 0) + r.tx.amount)
    return totals
  }, [rows])

  // Case d'en-tete : lignes selectionnables de la page courante.
  const pageSelectable = pageRows.map((r) => r.original).filter(canSelect)
  const selectedOnPage = pageSelectable.filter((r) => selected.has(r.tx.id)).length
  const headerChecked: boolean | 'mixed' =
    selectedOnPage === 0 ? false : selectedOnPage === pageSelectable.length ? true : 'mixed'

  // Ancre du Shift+clic : derniere case basculee. La plage suit l'ordre de la
  // page affichee et prend l'etat de l'ancre (cochee : on coche la plage).
  const anchor = useRef<string | null>(null)
  const onToggle = (row: TxRow, e: MouseEvent<HTMLButtonElement>) => {
    const order = pageRows.map((r) => r.original)
    const from = anchor.current ? order.findIndex((r) => r.tx.id === anchor.current) : -1
    const to = order.findIndex((r) => r.tx.id === row.tx.id)
    if (e.shiftKey && from >= 0 && to >= 0 && from !== to) {
      const [a, b] = from < to ? [from, to] : [to, from]
      onSetMany(
        order
          .slice(a, b + 1)
          .filter(canSelect)
          .map((r) => r.tx.id),
        selected.has(anchor.current!),
      )
    } else {
      onSetMany([row.tx.id], !selected.has(row.tx.id))
    }
    anchor.current = row.tx.id
  }

  const headers = table.getFlatHeaders()
  const colSpan = headers.length

  let lastDate: string | null = null

  return (
    <Card className="hidden overflow-clip lg:block">
      <table className="w-full table-fixed text-[14px]">
        <thead>
          <tr>
            {headers.map((header) => {
              const sorted = header.column.getIsSorted()
              const id = header.column.id
              return (
                <th
                  key={header.id}
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={cn('h-11 px-4 text-left align-middle label-caps font-medium', WIDTHS[id])}
                >
                  {id === 'select' ? (
                    <Checkbox
                      checked={headerChecked}
                      disabled={pageSelectable.length === 0}
                      label={headerChecked === true ? 'Tout désélectionner sur la page' : 'Tout sélectionner sur la page'}
                      onToggle={() =>
                        onSetMany(
                          pageSelectable.map((r) => r.tx.id),
                          headerChecked !== true,
                        )
                      }
                    />
                  ) : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1 rounded label-caps font-medium transition-colors hover:text-ink',
                        sorted && 'text-ink',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((tableRow) => {
            const row = tableRow.original
            const showDay = grouped && row.tx.date !== lastDate
            lastDate = row.tx.date
            const cells = tableRow.getVisibleCells().map((cell) => ({
              id: cell.column.id,
              node: flexRender(cell.column.columnDef.cell, cell.getContext()),
            }))
            return (
              <Fragment key={tableRow.id}>
                {showDay && (
                  <tr>
                    <td colSpan={colSpan} className="sticky top-[4.5rem] z-10 p-0">
                      <DayTitle
                        date={row.tx.date}
                        total={dayTotals.get(row.tx.date) ?? 0}
                        className="border-y border-edge bg-surface2 px-5 py-2"
                      />
                    </td>
                  </tr>
                )}
                <RowView row={row} cells={cells} selected={selected.has(row.tx.id)} onToggle={onToggle} />
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}
