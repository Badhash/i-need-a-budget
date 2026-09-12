import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CategorizeToastData {
  /** Libelle court de la transaction qui vient d'etre categorisee. */
  shortLabel: string
  categoryName: string
  categoryId: string
  /** Autres transactions non categorisees du meme tiers. */
  similarIds: string[]
}

interface CategorizeToastProps {
  data: CategorizeToastData | null
  onApply: () => void
  onCreateRule: () => void
  onDismiss: () => void
}

const AUTO_HIDE_MS = 6000

/**
 * Toast bas discret apres une categorisation manuelle : propose d'appliquer la
 * meme categorie aux autres transactions du meme tiers, ou de creer une regle.
 * Portail : au-dessus de la bottom nav sur mobile, coin bas sur desktop.
 * Auto-masquage 6 s (le minuteur repart a chaque nouvelle donnee).
 */
export function CategorizeToast({ data, onApply, onCreateRule, onDismiss }: CategorizeToastProps) {
  useEffect(() => {
    if (!data) return
    const t = window.setTimeout(onDismiss, AUTO_HIDE_MS)
    return () => window.clearTimeout(t)
  }, [data, onDismiss])

  if (!data) return null
  const n = data.similarIds.length

  return createPortal(
    <div
      role="status"
      // Le toast ne bloque jamais la page : seul le panneau capte les clics.
      className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-[45] flex justify-center px-4 lg:bottom-6 lg:justify-end lg:px-6"
    >
      <div
        className={cn(
          'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card',
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] text-ink">
            <span className="text-soft">« </span>
            <span className="font-medium">{data.shortLabel}</span>
            <span className="text-soft"> » vers </span>
            <span className="font-medium">{data.categoryName}</span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {n > 0 && (
              <button
                type="button"
                onClick={onApply}
                className="rounded-lg text-[13px] font-semibold text-accent transition-opacity hover:opacity-80"
              >
                Appliquer aux {n} autre{n > 1 ? 's' : ''}
              </button>
            )}
            <button
              type="button"
              onClick={onCreateRule}
              className="rounded-lg text-[12.5px] font-medium text-soft underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              Créer une règle
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fermer"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-colors hover:bg-surface2 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  )
}
