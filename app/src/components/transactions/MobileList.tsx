import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { useLongPress } from '@/hooks/useLongPress'
import { fmtDayLong } from '@/lib/format'
import { TxKindChip } from '@/components/transactions/TxKindChip'
import { SelectionBar } from '@/components/transactions/SelectionBar'
import { useCategorizeMany } from '@/components/transactions/useCategorizeMany'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { type TxRow, MOBILE_CHUNK } from '@/components/transactions/txRow'
import { RowMenu } from '@/components/transactions/RowMenu'
import { CategoryBadge } from '@/components/transactions/CategoryBadge'
import { AccountChip } from '@/components/transactions/AccountChip'

interface MobileRowProps {
  row: TxRow
  selectMode: boolean
  selected: boolean
  onLongPress: () => void
  onToggle: () => void
}

// Ligne mobile : appui long = entree en mode selection, tap en mode selection
// = bascule. Les controles internes (pastille, menu) sont neutralises en mode
// selection pour que le tap n'ouvre rien d'autre.
function MobileRow({ row, selectMode, selected, onLongPress, onToggle }: MobileRowProps) {
  const { handlers, firedRecently } = useLongPress(onLongPress)
  return (
    <div
      {...handlers}
      onClickCapture={(e) => {
        // Le clic qui suit un appui long ne doit rien declencher (ni le picker,
        // ni le menu) ; en mode selection, tout tap bascule la ligne.
        if (firedRecently() || selectMode) {
          e.stopPropagation()
          e.preventDefault()
          if (selectMode && !firedRecently()) onToggle()
        }
      }}
      aria-selected={selectMode ? selected : undefined}
      className={cn(
        'flex min-h-[60px] select-none items-center gap-3 px-4 py-3 transition-colors',
        selectMode && 'cursor-pointer',
        selected && 'bg-accent/[0.06] ring-2 ring-inset ring-accent/60',
      )}
    >
      {selectMode ? (
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            selected ? 'border-accent bg-accent text-accentfg' : 'border-line bg-surface text-transparent',
          )}
          aria-hidden
        >
          <Check className="h-4 w-4" />
        </span>
      ) : (
        <GroupPill group={row.group ?? undefined} size="md" />
      )}
      <div className={cn('min-w-0 flex-1', selectMode && 'pointer-events-none')}>
        <p className="truncate font-medium" title={row.tx.label}>
          {row.parsed.short}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <CategoryBadge row={row} />
          {/* Les transferts gardent leur badge dedie : pas de double chip */}
          {!row.tx.transferGroupId && <TxKindChip kind={row.parsed.kind} />}
          <AccountChip account={row.account} />
        </div>
      </div>
      <Amount
        cents={row.tx.amount}
        signed={row.tx.amount > 0}
        className={cn('font-semibold', row.tx.amount > 0 && 'text-success')}
      />
      <RowMenu row={row} className={cn('-mr-1', selectMode && 'pointer-events-none opacity-0')} />
    </div>
  )
}

/**
 * Liste mobile : rendu progressif (scroll infini par tranches de 50, sentinelle
 * IntersectionObserver) et selection multiple par appui long.
 */
export function MobileList({ rows, resetKey }: { rows: TxRow[]; resetKey: string }) {
  const [visibleCount, setVisibleCount] = useState(MOBILE_CHUNK)
  useEffect(() => {
    setVisibleCount(MOBILE_CHUNK)
  }, [resetKey])
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasMore = visibleCount < rows.length
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((n) => Math.min(rows.length, n + MOBILE_CHUNK))
        }
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, rows.length])

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount])

  const byDay = useMemo(() => {
    const map = new Map<string, TxRow[]>()
    for (const row of visibleRows) {
      const list = map.get(row.tx.date) ?? []
      list.push(row)
      map.set(row.tx.date, list)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [visibleRows])

  // Mode selection : seules les lignes categorisables sont selectionnables
  // (comptes budget, hors transfert).
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const selectMode = selected !== null
  const categorizeMany = useCategorizeMany()
  const canSelect = (row: TxRow) => !row.tx.transferGroupId && row.account.onBudget

  const exitSelect = useCallback(() => setSelected(null), [])
  useEffect(() => {
    if (!selectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitSelect()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode, exitSelect])
  // Les filtres changent : on sort du mode selection (les ids pourraient
  // ne plus etre visibles).
  useEffect(() => {
    setSelected(null)
  }, [resetKey])

  const enterSelect = (row: TxRow) => {
    if (!canSelect(row)) return
    haptic(15)
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      next.add(row.tx.id)
      return next
    })
  }
  const toggle = (row: TxRow) => {
    if (!canSelect(row)) return
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(row.tx.id)) next.delete(row.tx.id)
      else next.add(row.tx.id)
      return next
    })
  }
  const firstSelectedLabel = useMemo(() => {
    if (!selected || selected.size === 0) return undefined
    const first = rows.find((r) => selected.has(r.tx.id))
    return first?.tx.label ?? ''
  }, [selected, rows])

  const applyToSelection = (categoryId: string | null) => {
    if (!selected || selected.size === 0) return
    haptic([10, 30, 10])
    categorizeMany.mutate({ txIds: [...selected], categoryId })
    exitSelect()
  }

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
              <MobileRow
                key={row.tx.id}
                row={row}
                selectMode={selectMode}
                selected={selected?.has(row.tx.id) ?? false}
                onLongPress={() => enterSelect(row)}
                onToggle={() => toggle(row)}
              />
            ))}
          </Card>
        </div>
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="space-y-3 px-1 py-2" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {selectMode && (
        <SelectionBar
          count={selected.size}
          label={firstSelectedLabel}
          includeIncome={rows.some((r) => selected.has(r.tx.id) && r.tx.amount > 0)}
          onCategorize={applyToSelection}
          onCancel={exitSelect}
        />
      )}
    </div>
  )
}
