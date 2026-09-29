import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { cn } from '@/lib/utils'
import { canCategorize, transferLabel, type TxRow } from '@/components/transactions/txRow'
import { useTxList } from '@/components/transactions/listContext'

// Etend la zone tactile a 44px sans grossir la pastille (24px a l'oeil).
const HIT_AREA = "relative after:absolute after:-inset-x-1.5 after:-inset-y-2.5 after:content-['']"

const PILL = 'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium leading-none'

/** Pastille non interactive (virement neutre, compte de suivi). */
function StaticPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(PILL, 'bg-ink/[0.05] text-soft ring-1 ring-inset ring-ink/[0.06] [&_svg]:h-3 [&_svg]:w-3', className)}>
      {children}
    </span>
  )
}

/**
 * Categorie d'une ligne : pastille coloree du groupe (ou « À catégoriser »),
 * qui ouvre le selecteur de categorie. Virement neutre et compte de suivi :
 * pastille informative, non categorisable. La moitie cote budget d'un
 * virement vers un compte de suivi (serveur recent) se categorise normalement.
 */
export function CategoryBadge({ row, className }: { row: TxRow; className?: string }) {
  const { categorizeRow } = useTxList()
  // Micro-interaction : la pastille rebondit quand la ligne passe de « À
  // categoriser » a une categorie. Jamais au montage initial.
  const prevCategoryId = useRef(row.tx.categoryId)
  const [justCategorized, setJustCategorized] = useState(false)
  useEffect(() => {
    if (prevCategoryId.current === null && row.tx.categoryId) setJustCategorized(true)
    prevCategoryId.current = row.tx.categoryId
  }, [row.tx.categoryId])

  if (!canCategorize(row)) {
    if (row.tx.transferGroupId) {
      return (
        <StaticPill className={className}>
          <ArrowLeftRight />
          <span className="truncate">{transferLabel(row)}</span>
        </StaticPill>
      )
    }
    // Compte de suivi (hors budget) : ses mouvements ne se categorisent pas, ils
    // n'entrent ni dans les enveloppes ni dans le Pret a assigner.
    return <StaticPill className={className}>Hors budget</StaticPill>
  }

  const trigger = row.category ? (
    <button
      type="button"
      key={row.tx.categoryId}
      className={cn(
        PILL,
        HIT_AREA,
        'shadow-highlight ring-1 ring-inset ring-ink/[0.05] transition-[filter,transform] duration-150 ease-spring hover:brightness-95 active:scale-95 dark:hover:brightness-110',
        justCategorized && 'motion-safe:animate-pop',
        className,
      )}
      style={{
        backgroundColor: row.group ? `var(--cat-${row.group.color}-bg)` : undefined,
        color: row.group ? `var(--cat-${row.group.color}-fg)` : undefined,
      }}
      aria-label={`Changer la catégorie (${row.category.name})`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80"
      />
      <span className="truncate">{row.category.name}</span>
    </button>
  ) : (
    <button
      type="button"
      className={cn(
        PILL,
        HIT_AREA,
        'bg-warning/10 font-semibold text-warning ring-1 ring-inset ring-warning/25 transition-[background-color,transform] duration-150 ease-spring hover:bg-warning/15 active:scale-95',
        className,
      )}
      aria-label="Choisir une catégorie"
    >
      <Plus className="h-3 w-3 shrink-0" strokeWidth={2.6} />
      À catégoriser
    </button>
  )

  return (
    <CategoryPicker
      includeIncome={row.tx.amount > 0}
      label={row.tx.label}
      value={row.tx.categoryId}
      onSelect={(categoryId) => categorizeRow(row, categoryId)}
    >
      {trigger}
    </CategoryPicker>
  )
}
