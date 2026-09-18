import { LifeBuoy } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { fmtEUR } from '@/lib/format'
import type { CategoryGroup } from '@/types/domain'
import { cn } from '@/lib/utils'

/** Une enveloppe couverte : ce qui lui a ete AJOUTE pour ramener son disponible a 0. */
export interface CoverItem {
  categoryId: string
  categoryName: string
  group: CategoryGroup
  /** Assignation AVANT l'operation (centimes). */
  previousAssigned: number
  /** Manque couvert = montant ajoute (centimes, > 0). */
  added: number
}

interface CoverOverspendingDialogProps {
  items: CoverItem[] | null
  /** Pret a assigner APRES l'operation (valeur optimiste du cache). */
  rtaAfter: number
  onClose: () => void
}

/**
 * Recapitulatif affiche APRES « Couvrir les dépassements » : la liste des
 * enveloppes couvertes avec le montant assigne a chacune, le total pris sur
 * le Pret a assigner et le Pret a assigner restant. L'action est deja faite
 * (optimiste) : ce dialogue informe, il ne demande rien.
 */
export function CoverOverspendingDialog({ items, rtaAfter, onClose }: CoverOverspendingDialogProps) {
  const open = items !== null && items.length > 0
  const list = items ?? []
  const total = list.reduce((sum, item) => sum + item.added, 0)
  const negative = rtaAfter < 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
              <LifeBuoy className="h-4 w-4" />
            </span>
            Dépassements couverts
          </DialogTitle>
          <DialogDescription>
            {list.length === 1
              ? 'Une enveloppe a été ramenée à 0 avec de l’argent du Prêt à assigner.'
              : `${list.length} enveloppes ont été ramenées à 0 avec de l’argent du Prêt à assigner.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <ul className="divide-y divide-line/60">
            {list.map((item) => (
              <li key={item.categoryId} className="flex items-center gap-3 py-2.5">
                <GroupPill group={item.group} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{item.categoryName}</p>
                  <p className="text-[12.5px] text-soft tnum">
                    Assigné : {fmtEUR(item.previousAssigned)} → {fmtEUR(item.previousAssigned + item.added)}
                  </p>
                </div>
                <Amount cents={item.added} signed className="shrink-0 text-[15px] font-semibold text-success" />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-line p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-soft">Total assigné</span>
            <Amount cents={total} className="text-[17px] font-semibold" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-soft">Prêt à assigner restant</span>
            <Amount
              cents={rtaAfter}
              className={cn('text-[17px] font-semibold', negative ? 'text-danger' : 'text-ink')}
            />
          </div>
          {negative && (
            <p className="rounded-xl bg-danger/10 p-3 text-[13px] font-medium text-danger">
              Le Prêt à assigner est passé en négatif : réduisez une autre enveloppe ou attendez un revenu.
            </p>
          )}
          <Button className="h-12 w-full text-[15px]" onClick={onClose}>
            Compris
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
