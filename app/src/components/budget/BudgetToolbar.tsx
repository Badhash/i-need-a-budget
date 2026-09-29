// Barre d'outils de la page Budget : annuler / refaire (historique LOCAL des
// assignations, raccourcis Ctrl/Cmd+Z et Ctrl/Cmd+Maj+Z), masquer les lignes
// vides, tout replier. Le desktop y ajoute ses actions rapides (financer les
// objectifs, couvrir les depassements). Cibles de 44px sur mobile.

import type { ReactNode } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Eye, EyeOff, Redo2, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const HISTORY_BUTTON =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium text-soft transition-[background-color,color,transform] duration-150 ease-spring hover:bg-surface2 hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-35 lg:h-10 lg:min-w-10 lg:rounded-xl xl:px-3'

const TOGGLE_BUTTON =
  'inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 ease-spring active:scale-95 lg:h-10 lg:rounded-xl lg:px-3'

interface BudgetToolbarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  hideEmptyRows: boolean
  onToggleEmptyRows: () => void
  allCollapsed: boolean
  onToggleCollapsed: () => void
  /** Actions rapides DESKTOP (rendues a la suite de l'historique, lg et plus). */
  desktopActions?: ReactNode
}

export function BudgetToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hideEmptyRows,
  onToggleEmptyRows,
  allCollapsed,
  onToggleCollapsed,
  desktopActions,
}: BudgetToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex items-center gap-1">
        <div className="flex items-center rounded-full bg-surface2/70 p-0.5 ring-1 ring-inset ring-edge lg:rounded-xl lg:bg-transparent lg:p-0 lg:ring-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Annuler la dernière action (Ctrl+Z)"
            aria-label="Annuler la dernière action"
            className={HISTORY_BUTTON}
          >
            <Undo2 className="h-[18px] w-[18px]" />
            <span className="hidden xl:inline">Annuler</span>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Refaire (Ctrl+Maj+Z)"
            aria-label="Refaire l'action annulée"
            className={HISTORY_BUTTON}
          >
            <Redo2 className="h-[18px] w-[18px]" />
            <span className="hidden xl:inline">Refaire</span>
          </button>
        </div>
        {desktopActions && (
          <div className="ml-1 hidden items-center gap-1 border-l border-line pl-2 lg:flex">{desktopActions}</div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleEmptyRows}
          aria-pressed={hideEmptyRows}
          aria-label="Masquer les lignes vides"
          title={hideEmptyRows ? 'Afficher toutes les enveloppes' : 'Masquer les enveloppes sans montant'}
          className={cn(
            TOGGLE_BUTTON,
            hideEmptyRows
              ? 'bg-accent/10 text-accent-ink ring-1 ring-inset ring-accent/20 dark:text-accent'
              : 'text-soft hover:bg-surface2 hover:text-ink',
          )}
        >
          {hideEmptyRows ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          Sans les vides
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={allCollapsed ? 'Tout déplier' : 'Tout replier'}
          className={cn(TOGGLE_BUTTON, 'text-soft hover:bg-surface2 hover:text-ink')}
        >
          {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
          <span className="xl:hidden">{allCollapsed ? 'Déplier' : 'Replier'}</span>
          <span className="hidden xl:inline">{allCollapsed ? 'Tout déplier' : 'Tout replier'}</span>
        </button>
      </div>
    </div>
  )
}
