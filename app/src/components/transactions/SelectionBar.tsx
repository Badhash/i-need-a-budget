import { createPortal } from 'react-dom'
import { ListPlus, Tag, X } from 'lucide-react'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { Amount } from '@/components/shared/Amount'
import { cn } from '@/lib/utils'

interface SelectionBarProps {
  variant: 'mobile' | 'desktop'
  count: number
  /** Somme des montants selectionnes (centimes). */
  total: number
  /** Libelle de la premiere transaction selectionnee (suggestions du picker). */
  label?: string
  /** Propose aussi les categories de revenus (selection contenant une entree d'argent). */
  includeIncome?: boolean
  /** Transactions a categoriser du meme tiers, pas encore selectionnees. */
  similarCount: number
  onCategorize: (categoryId: string | null) => void
  onSelectSimilar: () => void
  onClear: () => void
}

/**
 * Barre d'actions de la selection multiple. Mobile : posee au-dessus de la
 * barre de navigation (appui long pour entrer en selection). Desktop : pilule
 * flottante centree sous le contenu (cases a cocher du tableau). Portail pour
 * ne pas etre clippee par les cartes (overflow-hidden).
 */
export function SelectionBar({
  variant,
  count,
  total,
  label,
  includeIncome = false,
  similarCount,
  onCategorize,
  onSelectSimilar,
  onClear,
}: SelectionBarProps) {
  const countLabel = `${count} sélectionnée${count > 1 ? 's' : ''}`

  if (variant === 'mobile') {
    return createPortal(
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[45] flex justify-center px-3 lg:hidden">
        <div className="glass pointer-events-auto w-full max-w-md animate-toast-in rounded-[24px] border border-edge p-2 shadow-elevated">
          <div className="flex items-center gap-2 pb-1.5 pl-2.5">
            <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink tnum">
              {countLabel}
              <span className="font-medium text-soft">
                {' · '}
                <Amount cents={total} signed={total > 0} />
              </span>
            </p>
            <button
              type="button"
              onClick={onClear}
              aria-label="Quitter la sélection"
              className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.06] hover:text-ink"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
          <div className="flex gap-2">
            {similarCount > 0 && (
              <button
                type="button"
                onClick={onSelectSimilar}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent/10 px-3.5 text-[13.5px] font-semibold text-accent-ink tnum transition-transform active:scale-95 dark:text-accent"
              >
                <ListPlus className="h-4 w-4" />+{similarCount} {similarCount > 1 ? 'similaires' : 'similaire'}
              </button>
            )}
            <CategoryPicker label={label} includeIncome={includeIncome} onSelect={onCategorize} className="flex-1">
              <button
                type="button"
                disabled={count === 0}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3.5 text-[14px] font-semibold text-accentfg shadow-button transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                <Tag className="h-4 w-4" />
                Catégoriser
              </button>
            </CategoryPicker>
          </div>
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 hidden justify-center px-8 lg:flex lg:pl-72">
      <div
        role="toolbar"
        aria-label="Actions sur la sélection"
        className="glass pointer-events-auto flex animate-toast-in items-center gap-2 rounded-2xl border border-edge p-1.5 pl-4 shadow-elevated"
      >
        <p className="whitespace-nowrap text-[14px] font-semibold text-ink tnum">
          {countLabel}
          <span className="font-medium text-soft">
            {' · '}
            <Amount cents={total} signed={total > 0} />
          </span>
        </p>
        <span aria-hidden className="mx-1 h-6 w-px bg-line" />
        <CategoryPicker label={label} includeIncome={includeIncome} onSelect={onCategorize}>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13.5px] font-semibold text-accentfg shadow-button transition-[filter,transform] hover:brightness-105 active:scale-95"
          >
            <Tag className="h-4 w-4" />
            Catégoriser
          </button>
        </CategoryPicker>
        {similarCount > 0 && (
          <button
            type="button"
            onClick={onSelectSimilar}
            className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl bg-accent/10 px-3 text-[13.5px] font-semibold text-accent-ink transition-[background-color,transform] hover:bg-accent/15 active:scale-95 dark:text-accent"
          >
            <ListPlus className="h-4 w-4" />
            Sélectionner les similaires
            <span className="rounded-full bg-accent/15 px-1.5 text-[11.5px] tnum">{similarCount}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          className={cn(
            'flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13.5px] font-medium text-soft transition-colors hover:bg-ink/[0.06] hover:text-ink',
          )}
        >
          <X className="h-4 w-4" />
          Désélectionner
        </button>
      </div>
    </div>,
    document.body,
  )
}
