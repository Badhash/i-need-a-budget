import { createPortal } from 'react-dom'
import { Tag } from 'lucide-react'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { cn } from '@/lib/utils'

interface SelectionBarProps {
  count: number
  /** Libelle de la premiere transaction selectionnee (suggestions du picker). */
  label?: string
  onCategorize: (categoryId: string | null) => void
  onCancel: () => void
}

/**
 * Barre d'actions collante du mode selection (mobile uniquement) : posee
 * au-dessus de la bottom nav, meme decalage que le toast. Portail pour ne pas
 * etre clippee par les cartes (overflow-hidden).
 */
export function SelectionBar({ count, label, onCategorize, onCancel }: SelectionBarProps) {
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[45] flex justify-center px-4 lg:hidden">
      <div
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 shadow-card',
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
        )}
      >
        <p className="min-w-0 flex-1 truncate pl-1 text-[13.5px] font-medium text-ink tnum">
          {count} sélectionnée{count > 1 ? 's' : ''}
        </p>
        <CategoryPicker label={label} onSelect={onCategorize}>
          <button
            type="button"
            disabled={count === 0}
            className="flex h-11 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13.5px] font-semibold text-accentfg transition-opacity disabled:opacity-50"
          >
            <Tag className="h-4 w-4" />
            Catégoriser
          </button>
        </CategoryPicker>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-11 items-center rounded-xl px-3 text-[13.5px] font-medium text-soft transition-colors hover:text-ink"
        >
          Annuler
        </button>
      </div>
    </div>,
    document.body,
  )
}
