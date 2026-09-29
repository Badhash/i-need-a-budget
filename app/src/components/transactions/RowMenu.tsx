import { ArrowLeftRight, MoreHorizontal, Pencil, Trash2, Undo2, Wand2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { canCategorize, type TxRow } from '@/components/transactions/txRow'
import { accountIcon } from '@/components/transactions/AccountChip'
import { useTxRowActions } from '@/components/transactions/useTxRowActions'

/**
 * Menu discret par ligne (desktop, au survol) : modifier, convertir en
 * virement / annuler le virement, creer une regle, supprimer. La suppression
 * est immediate, avec « Annuler » dans le toast (plus de double confirmation).
 */
export function RowMenu({ row, className }: { row: TxRow; className?: string }) {
  const actions = useTxRowActions()
  const isTransfer = Boolean(row.tx.transferGroupId)
  const targets = isTransfer ? [] : actions.transferTargets(row)

  return (
    <div className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Actions sur la transaction"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-soft transition-[background-color,color,opacity] hover:bg-ink/[0.06] hover:text-ink focus-visible:opacity-100 data-[state=open]:bg-ink/[0.06] data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {actions.canEdit(row) && (
            <DropdownMenuItem onSelect={() => actions.edit(row)}>
              <Pencil className="h-4 w-4 text-soft" />
              Modifier
            </DropdownMenuItem>
          )}
          {canCategorize(row) && !isTransfer && (
            <DropdownMenuItem onSelect={() => actions.createRule(row)}>
              <Wand2 className="h-4 w-4 text-soft" />
              Créer une règle
            </DropdownMenuItem>
          )}
          {isTransfer ? (
            <DropdownMenuItem disabled={row.pending} onSelect={() => actions.revert(row)}>
              <Undo2 className="h-4 w-4 text-soft" />
              Annuler le virement
            </DropdownMenuItem>
          ) : targets.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <ArrowLeftRight className="h-3 w-3" />
                Convertir en virement {row.tx.amount < 0 ? 'vers' : 'depuis'}
              </DropdownMenuLabel>
              {targets.map(({ account, hint }) => {
                const Icon = accountIcon(account)
                return (
                  <DropdownMenuItem
                    key={account.id}
                    disabled={row.pending}
                    onSelect={() => actions.convert(row, account)}
                    className="items-start"
                  >
                    <Icon className="mt-0.5 h-4 w-4 text-soft" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{account.name}</span>
                      {hint && <span className="block text-[12px] leading-snug text-soft">{hint}</span>}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={row.pending}
            className="text-danger data-[highlighted]:bg-danger/10"
            onSelect={() => actions.remove(row)}
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
