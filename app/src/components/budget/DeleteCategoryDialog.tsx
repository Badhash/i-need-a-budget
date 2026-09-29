import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import type { BudgetRow } from '@/lib/budget'
import type { Transaction } from '@/types/domain'
import { TRANSACTIONS_KEY } from '@/lib/data'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteCategoryDialogProps {
  /** Enveloppe a supprimer (null = ferme). */
  row: BudgetRow | null
  onConfirm: (row: BudgetRow) => void
  onClose: () => void
}

/**
 * Confirmation de suppression d'une enveloppe (grille desktop). Explique les
 * consequences : transactions a recategoriser, argent assigne rendu au Pret a
 * assigner, action definitive. Le nombre de transactions est lu dans le cache
 * sans abonnement (aucune lecture reseau) ; absent si la liste n'est pas en
 * cache. « Annuler » recoit le focus (choix sur par defaut).
 */
export function DeleteCategoryDialog({ row, onConfirm, onClose }: DeleteCategoryDialogProps) {
  const queryClient = useQueryClient()
  const txCount = row
    ? (queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)?.filter((t) => t.categoryId === row.category.id)
        .length ?? null)
    : null

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      {row && (
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader className="gap-3 pr-14">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger ring-1 ring-inset ring-danger/15">
              <Trash2 className="h-5 w-5" />
            </span>
            <DialogTitle>Supprimer « {row.category.name} » ?</DialogTitle>
            <DialogDescription>
              Ses transactions repasseront « À catégoriser » et l'argent qui lui est assigné retournera dans le
              Prêt à assigner. Cette action est définitive.
            </DialogDescription>
          </DialogHeader>
          <dl className="mx-5 mt-1 divide-y divide-line/70 rounded-2xl bg-surface2/60 px-4 text-[13.5px]">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <dt className="text-soft">Disponible ce mois-ci</dt>
              <dd className={cn('font-semibold tnum', row.available < 0 ? 'text-danger' : 'text-ink')}>
                {fmtEUR(row.available)}
              </dd>
            </div>
            {txCount !== null && (
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-soft">Transactions à recatégoriser</dt>
                <dd className="font-semibold tnum text-ink">{txCount}</dd>
              </div>
            )}
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                onConfirm(row)
                onClose()
              }}
            >
              Supprimer l'enveloppe
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
