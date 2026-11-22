import { Link2 } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { fmtDateShort } from '@/lib/format'
import { accountIcon } from './AccountChip'
import type { TxRow } from './txRow'
import type { TransferTarget, TxRowActions } from './useTxRowActions'

/**
 * Entrees « Convertir en virement » d'une ligne (menu desktop, feuille de
 * detail). Rendues a l'ouverture du menu seulement (contenu Radix) : la
 * recherche d'une operation de montant oppose sur chaque compte cible parcourt
 * la liste en cache. Trouvee, l'entree la relie (« Relier à l'opération du … »)
 * au lieu de creer un miroir qui doublerait le solde du compte cible. Les
 * actions viennent du parent, qui reste monte apres la fermeture du menu.
 */
export function TransferTargetItems({
  row,
  targets,
  actions,
  disabled,
}: {
  row: TxRow
  targets: TransferTarget[]
  actions: TxRowActions
  disabled?: boolean
}) {
  return (
    <>
      {targets.map(({ account, hint }) => {
        const Icon = accountIcon(account)
        const counterpart = actions.counterpartFor(row, account)
        return (
          <DropdownMenuItem
            key={account.id}
            disabled={disabled}
            className="items-start"
            onSelect={() => (counterpart ? actions.link(row, account, counterpart) : actions.convert(row, account))}
          >
            <Icon className="mt-0.5 h-4 w-4 text-soft" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{account.name}</span>
              {counterpart && (
                <span className="mt-0.5 flex items-center gap-1 text-[12px] font-medium leading-snug text-accent-ink dark:text-accent">
                  <Link2 aria-hidden className="h-3.5 w-3.5" />
                  Relier à l’opération du {fmtDateShort(counterpart.date)}
                </span>
              )}
              {hint && <span className="block text-[12px] leading-snug text-soft">{hint}</span>}
            </span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}
