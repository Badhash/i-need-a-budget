// Feuille « Apparence du groupe » : couleur et icone d'un groupe de categories,
// appliquees a chaque choix (mutation optimiste, l'apercu et la liste derriere
// la feuille suivent instantanement).

import type { CategoryGroup } from '@/types/domain'
import { useUpdateGroupMutation } from '@/lib/taxonomy'
import { useLatched } from '@/components/settings/shared/useLatched'
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
import { ColorSwatches, IconChoices } from '@/components/settings/categories/groupStyle'

export function GroupStyleDialog({
  group: openGroup,
  categoryNames,
  onClose,
}: {
  /** Groupe edite (lu dans le bootstrap : suit les changements optimistes). */
  group: CategoryGroup | null
  /** Quelques categories du groupe, pour l'apercu. */
  categoryNames: string[]
  onClose: () => void
}) {
  const update = useUpdateGroupMutation()
  const group = useLatched(openGroup)

  return (
    <Dialog open={openGroup !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {group && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">Apparence du groupe</DialogTitle>
              <DialogDescription>
                La couleur et l’icône de « {group.name} » s’appliquent partout : budget, transactions, rapports.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5 overflow-y-auto px-5 pb-2 pt-1">
              {/* Apercu vivant : pastille, nom et puces de categories. */}
              <div className="relative isolate overflow-hidden rounded-2xl border border-edge bg-surface2/50 p-4">
                <div
                  aria-hidden
                  className="absolute -right-10 -top-12 -z-10 h-32 w-32 rounded-full opacity-60 blur-2xl"
                  style={{ backgroundColor: `var(--cat-${group.color}-bg)` }}
                />
                <div className="flex items-center gap-3">
                  <GroupPill group={group} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-semibold tracking-tight">{group.name}</p>
                    <p className="text-[12.5px] text-soft">Aperçu</p>
                  </div>
                </div>
                {categoryNames.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {categoryNames.slice(0, 4).map((name) => (
                      <span
                        key={name}
                        className="max-w-[10rem] truncate rounded-full px-2.5 py-1 text-[12.5px] font-medium"
                        style={{
                          backgroundColor: `var(--cat-${group.color}-bg)`,
                          color: `var(--cat-${group.color}-fg)`,
                        }}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="label-caps mb-2.5">Couleur</p>
                <ColorSwatches
                  value={group.color}
                  onChange={(color) => color !== group.color && update.mutate({ groupId: group.id, color })}
                />
              </div>
              <div>
                <p className="label-caps mb-2.5">Icône</p>
                <IconChoices
                  value={group.icon}
                  color={group.color}
                  onChange={(icon) => icon !== group.icon && update.mutate({ groupId: group.id, icon })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onClose} className="sm:min-w-28">
                Terminé
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
