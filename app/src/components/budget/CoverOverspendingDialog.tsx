import { LifeBuoy, Undo2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { Aura } from '@/components/shared/Aura'
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
  /** Annule la couverture (une seule etape d'historique). */
  onUndo?: () => void
  onClose: () => void
}

/**
 * Recapitulatif affiche APRES « Couvrir les dépassements » : la liste des
 * enveloppes couvertes avec le montant assigne a chacune, le total pris sur
 * le Pret a assigner et le Pret a assigner restant. L'action est deja faite
 * (optimiste) : ce dialogue informe et permet de revenir en arriere.
 */
export function CoverOverspendingDialog({ items, rtaAfter, onUndo, onClose }: CoverOverspendingDialogProps) {
  const open = items !== null && items.length > 0
  const list = items ?? []
  const total = list.reduce((sum, item) => sum + item.added, 0)
  const negative = rtaAfter < 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="pr-14 pt-6">
          <DialogTitle className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 animate-scale-in items-center justify-center rounded-full bg-success/15 text-success ring-1 ring-inset ring-success/20">
              <LifeBuoy className="h-5 w-5" />
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
          <ul className="stagger divide-y divide-line/60">
            {list.map((item) => (
              <li key={item.categoryId} className="flex min-h-[60px] items-center gap-3 py-2.5">
                <GroupPill group={item.group} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{item.categoryName}</p>
                  <p className="text-[12.5px] text-soft tnum">
                    Assigné {fmtEUR(item.previousAssigned)} → {fmtEUR(item.previousAssigned + item.added)}
                  </p>
                </div>
                <Amount cents={item.added} signed className="shrink-0 text-[15px] font-semibold text-success" />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-line/70 p-5">
          <div className="relative isolate overflow-hidden rounded-2xl border border-edge bg-surface2/40 px-4 py-3.5">
            <Aura tone={negative ? 'danger' : 'success'} intensity="soft" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium text-soft">Total assigné</span>
              <Amount cents={total} className="text-[19px] font-semibold tracking-tight text-ink" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-soft">Prêt à assigner restant</span>
              <Amount
                cents={rtaAfter}
                className={cn('text-[15px] font-semibold', negative ? 'text-danger' : 'text-ink')}
              />
            </div>
          </div>
          {negative && (
            <p className="rounded-xl bg-danger/10 p-3 text-[13px] font-medium leading-snug text-danger">
              Le Prêt à assigner est passé en négatif : réduisez une autre enveloppe ou attendez un revenu.
            </p>
          )}
          <div className="flex gap-2">
            {onUndo && (
              <Button
                variant="secondary"
                className="h-12 gap-1.5 px-4 text-[15px] sm:h-10 sm:text-[14px]"
                onClick={() => {
                  onUndo()
                  onClose()
                }}
              >
                <Undo2 className="h-4 w-4" />
                Annuler
              </Button>
            )}
            <Button className="h-12 flex-1 text-[15px] sm:h-10 sm:text-[14px]" onClick={onClose}>
              Compris
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
