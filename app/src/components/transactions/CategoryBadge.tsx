import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { useCategorize } from '@/lib/categorize'
import { haptic } from '@/lib/haptics'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TxRow } from '@/components/transactions/txRow'

// Notifie la page qu'une categorie vient d'etre choisie a la main sur une
// ligne (toast « Appliquer aux N autres »). Contexte plutot que prop : la
// colonne du tableau desktop est definie au niveau module.
type OnCategorized = (row: TxRow, categoryId: string | null) => void
export const CategorizedContext = createContext<OnCategorized>(() => {})

export function CategoryBadge({ row }: { row: TxRow }) {
  const categorize = useCategorize()
  const onCategorized = useContext(CategorizedContext)
  // Micro-interaction (mobile) : la pastille s'anime quand la ligne passe de
  // « A categoriser » a une categorie. Jamais au montage initial.
  const prevCategoryId = useRef(row.tx.categoryId)
  const [justCategorized, setJustCategorized] = useState(false)
  useEffect(() => {
    if (prevCategoryId.current === null && row.tx.categoryId) setJustCategorized(true)
    prevCategoryId.current = row.tx.categoryId
  }, [row.tx.categoryId])

  if (row.tx.transferGroupId) {
    return (
      <Badge variant="neutral">
        <ArrowLeftRight className="h-3 w-3" />
        Transfert
      </Badge>
    )
  }

  // Compte de suivi (hors budget) : ses mouvements ne se categorisent pas, ils
  // n'entrent ni dans les enveloppes ni dans le Pret a assigner.
  if (row.account && !row.account.onBudget) {
    return <Badge variant="neutral">Hors budget</Badge>
  }

  // after:-inset-2 : etend la zone tactile sans grossir la pastille
  const hitArea = "relative after:absolute after:-inset-2 after:content-['']"

  const trigger = row.category ? (
    <button
      key={row.tx.categoryId}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium transition-opacity hover:opacity-75',
        hitArea,
        justCategorized &&
          'max-lg:motion-safe:animate-in max-lg:motion-safe:fade-in max-lg:motion-safe:zoom-in-95 max-lg:motion-safe:duration-200',
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
      label={row.tx.label}
      onSelect={(categoryId) => {
        haptic(10)
        categorize.mutate({ txId: row.tx.id, categoryId })
        onCategorized(row, categoryId)
      }}
    >
      {trigger}
    </CategoryPicker>
  )
}
