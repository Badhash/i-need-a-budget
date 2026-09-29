import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useLongPress } from '@/hooks/useLongPress'
import { isFreshlyAdded } from '@/lib/transactions'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { canSelect, detailLine, MOBILE_CHUNK, type TxRow } from '@/components/transactions/txRow'
import { CategoryBadge } from '@/components/transactions/CategoryBadge'
import { AccountLabel } from '@/components/transactions/AccountChip'
import { DayTitle, TxAmount, TxBubble } from '@/components/transactions/rowParts'
import { useTxList } from '@/components/transactions/listContext'

/** Mise en lumiere breve d'une ligne tout juste ajoutee (fond accent qui s'efface). */
function useFlash(id: string): boolean {
  const [flash, setFlash] = useState(() => isFreshlyAdded(id))
  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(false), 900)
    return () => window.clearTimeout(timer)
  }, [flash])
  return flash
}

interface MobileRowProps {
  row: TxRow
  selectMode: boolean
  selected: boolean
  onLongPress: (row: TxRow) => void
  onToggle: (row: TxRow) => void
}

// Ligne mobile : tap = detail ; appui long = entree en mode selection ; en mode
// selection, tout tap bascule la ligne (pastille et detail neutralises).
const MobileRow = memo(function MobileRow({ row, selectMode, selected, onLongPress, onToggle }: MobileRowProps) {
  const { openDetail, singleAccount } = useTxList()
  const { handlers, firedRecently } = useLongPress(() => onLongPress(row))
  const flash = useFlash(row.tx.id)
  const detail = detailLine(row)
  const selectable = canSelect(row)

  return (
    <div
      {...handlers}
      role="button"
      tabIndex={0}
      onClickCapture={(e) => {
        // Le clic qui suit un appui long ne doit rien declencher ; en mode
        // selection, tout tap bascule la ligne.
        if (firedRecently() || selectMode) {
          e.stopPropagation()
          e.preventDefault()
          if (selectMode && !firedRecently()) onToggle(row)
        }
      }}
      onClick={() => openDetail(row)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (selectMode) onToggle(row)
        else openDetail(row)
      }}
      aria-selected={selectMode ? selected : undefined}
      aria-label={`${row.name}, voir le détail`}
      className={cn(
        'relative flex min-h-[68px] cursor-pointer select-none items-center gap-3 px-4 py-3 outline-none transition-[background-color,opacity] duration-500 active:bg-ink/[0.04] focus-visible:bg-ink/[0.04]',
        flash && 'bg-accent/10',
        selected && 'bg-accent/[0.07]',
        selectMode && !selectable && 'opacity-45',
      )}
    >
      {selectMode ? (
        <span
          className={cn(
            'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] duration-200 ease-spring',
            selected ? 'scale-100 border-accent bg-accent text-accentfg' : 'border-line bg-surface text-transparent',
          )}
          aria-hidden
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </span>
      ) : (
        <TxBubble row={row} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight text-ink" title={row.tx.label}>
            {row.name}
          </p>
          <TxAmount row={row} className="shrink-0 text-[15px]" />
        </div>
        {detail && <p className="mt-0.5 truncate text-[12.5px] leading-snug text-soft">{detail}</p>}
        <div className={cn('mt-1.5 flex min-w-0 items-center gap-2', selectMode && 'pointer-events-none')}>
          <CategoryBadge row={row} />
          {(!singleAccount || row.cross) && (
            <AccountLabel
              account={row.account}
              peer={row.cross ? row.peerAccount : null}
              outgoing={row.tx.amount < 0}
              className="min-w-0"
            />
          )}
        </div>
      </div>
      {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
    </div>
  )
})

interface MobileListProps {
  rows: TxRow[]
  /** Change quand les filtres changent : retour a la premiere tranche. */
  resetKey: string
  selected: ReadonlySet<string>
  onLongPress: (row: TxRow) => void
  onToggle: (row: TxRow) => void
}

/**
 * Liste mobile : jours en tetes collantes (sous le header) avec leur total,
 * rendu progressif (tranches de 50, sentinelle IntersectionObserver) et
 * selection multiple par appui long.
 */
export function MobileList({ rows, resetKey, selected, onLongPress, onToggle }: MobileListProps) {
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
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, rows.length])

  // Jours dans l'ordre des lignes (deja triees) ; total de chaque jour sur
  // toutes ses lignes, meme celles pas encore rendues.
  const days = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of rows) totals.set(r.tx.date, (totals.get(r.tx.date) ?? 0) + r.tx.amount)
    const out: { date: string; total: number; rows: TxRow[] }[] = []
    for (const row of rows.slice(0, visibleCount)) {
      const last = out[out.length - 1]
      if (last && last.date === row.tx.date) last.rows.push(row)
      else out.push({ date: row.tx.date, total: totals.get(row.tx.date) ?? 0, rows: [row] })
    }
    return out
  }, [rows, visibleCount])

  const selectMode = selected.size > 0

  return (
    <div className="stagger space-y-1 lg:hidden">
      {days.map((day) => (
        <section key={day.date} aria-label={day.date}>
          <DayTitle
            date={day.date}
            total={day.total}
            className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 bg-bg px-5 pb-2 pt-3"
          />
          <Card className="divide-y divide-edge overflow-hidden">
            {day.rows.map((row) => (
              <MobileRow
                key={row.key}
                row={row}
                selectMode={selectMode}
                selected={selected.has(row.tx.id)}
                onLongPress={onLongPress}
                onToggle={onToggle}
              />
            ))}
          </Card>
        </section>
      ))}
      {hasMore && (
        <div ref={sentinelRef} className="space-y-3 px-1 py-3" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
    </div>
  )
}
