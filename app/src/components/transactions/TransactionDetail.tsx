import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  ChevronRight,
  CircleDashed,
  Info,
  Pencil,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import {
  countsAsUncategorized,
  useAccountsMap,
  useBootstrap,
  useCategoriesMap,
  useGroupsMap,
  useIsCrossBudgetTransfer,
  useTransactions,
} from '@/lib/data'
import { payeeKey } from '@/lib/categorize'
import { followTxId } from '@/lib/transactions'
import { fmtDayLong } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { Aura } from '@/components/shared/Aura'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { CategoryPicker } from './CategoryPicker'
import { AccountChip, accountIcon } from './AccountChip'
import { TxBubble } from './rowParts'
import { canCategorize, toRow, transferLabel, type TxRow } from './txRow'
import { useTxList } from './listContext'
import { useTxRowActions } from './useTxRowActions'

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-[52px] items-center gap-3 px-4 py-2.5', className)}>
      <dt className="w-28 shrink-0 text-[13px] text-soft">{label}</dt>
      <dd className="flex min-w-0 flex-1 justify-end text-right text-[14px] font-medium text-ink">{children}</dd>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
  hint,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={cn(
        'flex min-h-12 items-center gap-2.5 rounded-2xl px-3.5 text-left text-[14px] font-medium transition-[background-color,transform] duration-150 ease-spring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        danger ? 'bg-danger/10 text-danger hover:bg-danger/15' : 'bg-surface2 text-ink hover:bg-ink/[0.07]',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', !danger && 'text-soft')} />
      <span className="min-w-0 flex-1 leading-tight">{label}</span>
    </button>
  )
}

function DetailBody({ row, onClose }: { row: TxRow; onClose: () => void }) {
  const boot = useBootstrap().data
  const categoryById = useCategoriesMap()
  const { categorizeRow } = useTxList()
  const actions = useTxRowActions()

  const { tx } = row
  const isTransfer = Boolean(tx.transferGroupId)
  const categorizable = canCategorize(row)
  const targets = isTransfer ? [] : actions.transferTargets(row)

  // Memoire de tiers : categorie proposee par defaut pour ce marchand.
  const key = payeeKey(tx.label)
  const memory = key && categorizable && !isTransfer ? boot?.payees.find((p) => p.key === key) : undefined
  const memoryCategory = memory ? categoryById.get(memory.categoryId) : undefined

  const choose = (categoryId: string | null) => categorizeRow(row, categoryId)

  const year = tx.date.slice(0, 4)
  const positive = tx.amount > 0
  const neutralTransfer = isTransfer && !row.cross

  return (
    <>
      <DialogHeader className="items-center px-6 pb-3 pt-7 text-center">
        <TxBubble row={row} size="lg" className="shadow-raised" />
        <DialogTitle className="mt-3 max-w-full text-[19px] leading-snug">{row.name}</DialogTitle>
        {/* Libelle brut (source de verite), sauf s'il repete le titre. */}
        <DialogDescription
          className={cn(
            'max-w-full select-text break-words font-mono text-[11.5px] leading-relaxed',
            tx.label.trim().toLowerCase() === row.name.toLowerCase() && 'sr-only',
          )}
        >
          {tx.label}
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {/* Montant heros sur halo : vert pour une entree, aurore sinon. */}
        <div className="relative isolate overflow-hidden rounded-3xl border border-edge bg-surface px-5 py-5 text-center shadow-card">
          <Aura tone={neutralTransfer ? 'neutral' : positive ? 'success' : 'accent'} intensity="soft" />
          <Amount
            cents={tx.amount}
            signed={positive}
            size="hero"
            className={cn(neutralTransfer ? 'text-soft' : positive ? 'text-success' : 'text-ink')}
          />
          <p className="mt-2 text-[13px] text-soft">
            {fmtDayLong(tx.date)} {year}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {row.uncategorized && (
              <Badge variant="warning" dot>
                À catégoriser
              </Badge>
            )}
            {isTransfer && (
              <Badge variant="neutral">
                <ArrowLeftRight />
                {transferLabel(row)}
              </Badge>
            )}
            {!row.account.onBudget && <Badge variant="neutral">Hors budget</Badge>}
            {row.pending && (
              <Badge variant="outline">
                <CircleDashed />
                Enregistrement…
              </Badge>
            )}
          </div>
        </div>

        <dl className="mt-4 divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface">
          <Field label="Catégorie">
            {categorizable ? (
              <CategoryPicker
                value={tx.categoryId}
                label={tx.label}
                includeIncome={positive}
                onSelect={choose}
              >
                <button
                  type="button"
                  className="-mr-1.5 flex min-h-11 max-w-full items-center gap-2 rounded-xl py-1 pl-2.5 pr-1.5 transition-colors hover:bg-ink/[0.05]"
                >
                  {row.category ? (
                    <span
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold"
                      style={{
                        backgroundColor: row.group ? `var(--cat-${row.group.color}-bg)` : undefined,
                        color: row.group ? `var(--cat-${row.group.color}-fg)` : undefined,
                      }}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" />
                      <span className="max-w-[11rem] truncate">{row.category.name}</span>
                    </span>
                  ) : (
                    <span className="whitespace-nowrap font-semibold text-warning">Choisir une catégorie</span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-soft" />
                </button>
              </CategoryPicker>
            ) : (
              <span className="text-[13px] font-normal leading-snug text-soft">
                {isTransfer ? 'Virement interne : sans catégorie' : 'Compte de suivi : sans catégorie'}
              </span>
            )}
          </Field>
          {memoryCategory && (
            <div className="flex items-center gap-2.5 bg-accent/[0.05] px-4 py-2.5 text-[13px] text-soft">
              <Sparkles className="h-4 w-4 shrink-0 text-accent-ink dark:text-accent" />
              <p className="min-w-0 flex-1 leading-snug">
                Catégorie mémorisée pour ce tiers : <span className="font-semibold text-ink">{memoryCategory.name}</span>
              </p>
              {memory && memory.categoryId !== tx.categoryId && (
                <button
                  type="button"
                  onClick={() => choose(memory.categoryId)}
                  className="min-h-9 shrink-0 rounded-lg px-2.5 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent/10 dark:text-accent"
                >
                  Appliquer
                </button>
              )}
            </div>
          )}
          <Field label="Compte">
            <AccountChip account={row.account} />
          </Field>
          {isTransfer && (
            <Field label="Virement">
              <span className="truncate">{transferLabel(row)}</span>
            </Field>
          )}
          {tx.counterparty && (
            <Field label="Contrepartie">
              <span className="select-text break-words">{tx.counterparty}</span>
            </Field>
          )}
          {tx.note && (
            <Field label="Note">
              <span className="select-text whitespace-pre-wrap break-words font-normal">{tx.note}</span>
            </Field>
          )}
        </dl>

        {row.cross && (
          <p className="mt-3 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-soft">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Virement vers un compte de suivi : l’argent sort du budget, il se catégorise comme une dépense.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ActionButton
            icon={Pencil}
            label="Modifier"
            disabled={!actions.canEdit(row)}
            hint={actions.canEdit(row) ? undefined : 'Annule d’abord le virement pour le modifier.'}
            onClick={() => {
              onClose()
              actions.edit(row)
            }}
          />
          <ActionButton
            icon={Wand2}
            label="Créer une règle"
            disabled={!categorizable || isTransfer}
            onClick={() => {
              onClose()
              actions.createRule(row)
            }}
          />
          {isTransfer ? (
            <ActionButton
              icon={Undo2}
              label="Annuler le virement"
              disabled={row.pending}
              onClick={() => actions.revert(row)}
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={row.pending || targets.length === 0}>
                <button
                  type="button"
                  className="flex min-h-12 items-center gap-2.5 rounded-2xl bg-surface2 px-3.5 text-left text-[14px] font-medium text-ink transition-[background-color,transform] duration-150 ease-spring hover:bg-ink/[0.07] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
                >
                  <ArrowLeftRight className="h-[18px] w-[18px] shrink-0 text-soft" />
                  <span className="min-w-0 flex-1 leading-tight">Convertir en virement</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-soft" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuLabel>Convertir en virement {tx.amount < 0 ? 'vers' : 'depuis'}</DropdownMenuLabel>
                {targets.map(({ account, hint }) => {
                  const Icon = accountIcon(account)
                  return (
                    <DropdownMenuItem key={account.id} className="items-start" onSelect={() => actions.convert(row, account)}>
                      <Icon className="mt-0.5 h-4 w-4 text-soft" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{account.name}</span>
                        {hint && <span className="block text-[12px] leading-snug text-soft">{hint}</span>}
                      </span>
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ActionButton
            icon={Trash2}
            label="Supprimer"
            danger
            disabled={row.pending}
            onClick={() => {
              if (actions.remove(row)) onClose()
            }}
          />
        </div>
        {row.pending && (
          <p className="mt-2 text-center text-[12px] text-soft">
            Suppression et virement possibles dès l’enregistrement terminé.
          </p>
        )}
      </div>
    </>
  )
}

/**
 * Detail d'une transaction : feuille basse (mobile) ou dialogue (desktop).
 * Libelle brut, montant heros, date, compte, categorie (selecteur),
 * contrepartie, note, virement, memoire de tiers, et les actions : modifier,
 * convertir en virement / annuler le virement, creer une regle, supprimer.
 * Suit la ligne dans le cache (y compris le passage id temporaire -> id
 * serveur) ; se ferme si elle disparait.
 */
export function TransactionDetail({ txId, onClose }: { txId: string | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: txs } = useTransactions()
  const accountById = useAccountsMap()
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const isCross = useIsCrossBudgetTransfer()
  const boot = useBootstrap().data

  const currentId = txId ? followTxId(txId) : null
  const tx = currentId ? txs?.find((t) => t.id === currentId) : undefined
  const row = useMemo(() => {
    if (!tx) return null
    const peer = tx.transferGroupId
      ? txs?.find((t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id)
      : undefined
    return toRow(
      tx,
      { accountById, categoryById, groupById },
      {
        isCross,
        peerOf: () => peer,
        isUncat: (t) => countsAsUncategorized(queryClient, t),
      },
    )
    // boot : la taxonomie lue par countsAsUncategorized vit dans le cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx, txs, accountById, categoryById, groupById, isCross, queryClient, boot])

  // Derniere ligne affichee, gardee le temps de l'animation de fermeture.
  const lastRow = useRef<TxRow | null>(null)
  if (row) lastRow.current = row
  const shown = row ?? lastRow.current

  // Ligne disparue (supprimee, relecture) : la feuille se ferme.
  useEffect(() => {
    if (txId && txs && !tx) onClose()
  }, [txId, txs, tx, onClose])

  return (
    <Dialog open={Boolean(txId && row)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">{shown && <DetailBody row={shown} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}
