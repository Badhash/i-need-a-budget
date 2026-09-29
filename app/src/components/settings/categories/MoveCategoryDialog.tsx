// Feuille « Déplacer vers… » : choix du groupe cible d'une categorie. Le
// serveur la place en fin de groupe ; l'appelant propose « Annuler » (retour
// dans le groupe d'origine, a sa place d'origine).

import { Check, EyeOff } from 'lucide-react'
import type { Category, CategoryGroup } from '@/types/domain'
import { GroupPill } from '@/components/shared/GroupPill'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLatched } from '@/components/settings/shared/useLatched'
import { cn } from '@/lib/utils'

export function MoveCategoryDialog({
  category: openCategory,
  groups,
  countOf,
  onMove,
  onClose,
}: {
  category: Category | null
  /** Groupes cibles possibles, dans l'ordre d'affichage. */
  groups: CategoryGroup[]
  countOf: (groupId: string) => number
  onMove: (category: Category, groupId: string) => void
  onClose: () => void
}) {
  const category = useLatched(openCategory)

  return (
    <Dialog open={openCategory !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {category && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">Déplacer « {category.name} »</DialogTitle>
              <DialogDescription>
                Choisis son nouveau groupe. Ses transactions, montants assignés et objectif la suivent.
              </DialogDescription>
            </DialogHeader>
            <ul className="stagger max-h-[55dvh] space-y-1 overflow-y-auto px-3 pb-1 pt-1 sm:max-h-[420px]">
              {groups.map((g) => {
                const current = g.id === category.groupId
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      disabled={current}
                      aria-current={current || undefined}
                      onClick={() => onMove(category, g.id)}
                      className={cn(
                        'pressable flex min-h-[56px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors',
                        current ? 'bg-accent/10' : 'hover:bg-surface2 active:bg-surface2',
                      )}
                    >
                      <GroupPill group={g} size="md" className={cn(g.hidden && 'opacity-60')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{g.name}</span>
                        <span className="flex items-center gap-1 text-[12.5px] text-soft">
                          {g.hidden && <EyeOff className="h-3 w-3" />}
                          {g.hidden ? 'Groupe masqué · ' : ''}
                          {countOf(g.id)} catégorie{countOf(g.id) > 1 ? 's' : ''}
                        </span>
                      </span>
                      {current && (
                        <span className="flex items-center gap-1 text-[12.5px] font-medium text-accent-ink">
                          <Check className="h-4 w-4" />
                          Actuel
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Annuler
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
