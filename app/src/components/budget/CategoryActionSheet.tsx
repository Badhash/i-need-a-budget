import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Target as TargetIcon, Trash2 } from 'lucide-react'
import type { Category } from '@/mocks/data'
import {
  useDeleteCategoryMutation,
  useUpdateCategoryMutation,
} from '@/lib/taxonomy'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface CategoryActionSheetProps {
  category: Category | null
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onOpenTarget: (category: Category) => void
  onClose: () => void
}

/** Ligne d'action tactile de la feuille contextuelle (44px mini). */
function ActionRow({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: typeof Pencil
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 text-left text-[15px] font-medium transition-colors active:bg-surface2',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full',
          danger ? 'bg-danger/10 text-danger' : 'bg-surface2 text-soft',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      {label}
    </button>
  )
}

/**
 * Feuille contextuelle d'une enveloppe (appui long sur mobile) : renommer,
 * objectif, deplacer dans le groupe, supprimer. Trois ecrans internes :
 * menu -> renommage inline ou confirmation de suppression.
 */
export function CategoryActionSheet({
  category,
  canMoveUp,
  canMoveDown,
  onMove,
  onOpenTarget,
  onClose,
}: CategoryActionSheetProps) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu')
  const [draft, setDraft] = useState('')
  const rename = useUpdateCategoryMutation()
  const remove = useDeleteCategoryMutation()
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (category) {
      setMode('menu')
      setDraft(category.name)
    }
  }, [category])

  if (!category) return null

  const commitRename = () => {
    const name = draft.trim()
    if (name && name !== category.name) {
      rename.mutate({ categoryId: category.id, name })
    }
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        style={keyboardInset > 0 ? { bottom: keyboardInset, transition: 'bottom 120ms ease-out' } : undefined}
      >
        <DialogHeader>
          <DialogTitle>{category.name}</DialogTitle>
          {mode === 'delete' && (
            <DialogDescription>
              Ses transactions repasseront « À catégoriser » et les montants assignés seront
              supprimés. Cette action est définitive.
            </DialogDescription>
          )}
        </DialogHeader>

        {mode === 'menu' && (
          <div className="space-y-0.5 p-3 pt-0">
            <ActionRow icon={Pencil} label="Renommer" onClick={() => setMode('rename')} />
            <ActionRow
              icon={TargetIcon}
              label="Objectif…"
              onClick={() => {
                onClose()
                onOpenTarget(category)
              }}
            />
            {canMoveUp && (
              <ActionRow
                icon={ArrowUp}
                label="Monter dans la liste"
                onClick={() => {
                  onMove(-1)
                  onClose()
                }}
              />
            )}
            {canMoveDown && (
              <ActionRow
                icon={ArrowDown}
                label="Descendre dans la liste"
                onClick={() => {
                  onMove(1)
                  onClose()
                }}
              />
            )}
            <ActionRow icon={Trash2} label="Supprimer" danger onClick={() => setMode('delete')} />
          </div>
        )}

        {mode === 'rename' && (
          <div className="space-y-3 p-5 pt-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
              }}
              autoFocus
              enterKeyHint="done"
              maxLength={60}
              aria-label="Nouveau nom de la catégorie"
            />
            <div className="flex gap-2.5">
              <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
                Annuler
              </Button>
              <Button className="h-11 flex-1" onClick={commitRename} disabled={!draft.trim()}>
                Renommer
              </Button>
            </div>
          </div>
        )}

        {mode === 'delete' && (
          <div className="flex gap-2.5 p-5 pt-2">
            <Button variant="outline" className="h-11 flex-1" onClick={onClose}>
              Annuler
            </Button>
            <Button
              className="h-11 flex-1 bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                remove.mutate({ categoryId: category.id })
                onClose()
              }}
            >
              Supprimer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
