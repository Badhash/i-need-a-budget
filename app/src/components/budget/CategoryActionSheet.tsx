import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ChevronLeft,
  Coins,
  EyeOff,
  Pencil,
  ReceiptText,
  Target as TargetIcon,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import type { Category, CategoryGroup } from '@/types/domain'
import type { BudgetRow } from '@/lib/budget'
import type { Target } from '@/lib/targets'
import {
  useDeleteCategoryMutation,
  useUpdateCategoryMutation,
} from '@/lib/taxonomy'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GroupPill } from '@/components/shared/GroupPill'
import { AvailableChip } from '@/components/budget/AvailableChip'
import { evalAmountCents, fmtEUR, fmtMonthLong } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Une enveloppe candidate au transfert (source ou destination). */
export interface MoveTarget {
  row: BudgetRow
  group: CategoryGroup
}

/** Paramètres d'un déplacement d'argent entre deux enveloppes. */
export interface MovePayload {
  fromId: string
  toId: string
  fromAssigned: number
  toAssigned: number
  amount: number
}

interface CategoryActionSheetProps {
  category: Category | null
  /** Ligne budget de la catégorie visée (assigné/disponible du mois courant). */
  currentRow: BudgetRow | null
  /** Autres enveloppes du mois (source ou destination possible). */
  moveTargets: MoveTarget[]
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: -1 | 1) => void
  onMoveMoney: (payload: MovePayload) => void
  onOpenTarget: (category: Category) => void
  onClose: () => void
  /** Groupe de l'enveloppe (pastille et sous-titre). */
  group?: CategoryGroup
  /** Objectif de l'enveloppe (resume sous la tuile Objectif). */
  target?: Target | null
  /** Ouvre la feuille d'assignation de l'enveloppe. */
  onAssign?: () => void
  /** Ouvre les transactions de l'enveloppe pour le mois affiche. */
  onViewActivity?: (categoryId: string) => void
  /** Masque l'enveloppe (elle rejoint « Catégories masquées »). */
  onHide?: () => void
}

/** Parse un montant en euros (fr-FR) vers des centimes positifs, ou null. */
function parseEuros(raw: string): number | null {
  if (!raw.trim()) return 0
  // Parser strict partage : « 1.000 » (mille) n'est plus lu comme 1 €.
  const cents = evalAmountCents(raw)
  if (cents === null || cents < 0) return null
  return cents
}

function toDraft(cents: number): string {
  return cents <= 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

function targetSummary(target: Target): string {
  if (target.type === 'monthly') return `${fmtEUR(target.amount)}/mois`
  if (target.type === 'refill') return `Jusqu'à ${fmtEUR(target.amount)}`
  return target.dueMonth ? `${fmtEUR(target.amount)} · ${fmtMonthLong(target.dueMonth)}` : fmtEUR(target.amount)
}

/** Tuile d'action rapide (icone en pastille + libelle), 72px de haut. */
function ActionTile({
  icon: Icon,
  label,
  hint,
  tone = 'default',
  disabled,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  tone?: 'default' | 'accent' | 'danger' | 'success'
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[80px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl bg-surface2/60 px-1.5 py-2.5 text-center ring-1 ring-inset ring-edge transition-[background-color,transform] duration-150 ease-spring active:scale-95 disabled:pointer-events-none disabled:opacity-40 [@media(hover:hover)]:hover:bg-surface2"
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full',
          tone === 'accent' && 'bg-accent/10 text-accent-ink dark:text-accent',
          tone === 'danger' && 'bg-danger/10 text-danger',
          tone === 'success' && 'bg-success/10 text-success',
          tone === 'default' && 'bg-surface text-ink shadow-highlight ring-1 ring-inset ring-edge',
        )}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
      </span>
      <span className="w-full truncate text-[12.5px] font-semibold leading-tight text-ink">{label}</span>
      {hint && <span className="-mt-1 w-full truncate text-[11px] leading-tight text-soft tnum">{hint}</span>}
    </button>
  )
}

/** Ligne d'action tactile de la feuille contextuelle (48px). */
function ActionRow({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] font-medium transition-colors active:bg-surface2 [@media(hover:hover)]:hover:bg-surface2/60',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', danger ? 'text-danger' : 'text-soft')} />
      {label}
    </button>
  )
}

type Mode = 'menu' | 'rename' | 'delete' | 'cover' | 'move'

/**
 * Feuille contextuelle d'une enveloppe (appui long sur mobile) : resume du
 * mois, actions rapides (assigner, objectif, couvrir / deplacer de l'argent,
 * activite), puis reorganiser, renommer, masquer, supprimer. Ecrans internes
 * pilotes par `mode` ; les transferts d'argent se font en deux temps : choix
 * de l'enveloppe puis saisie du montant.
 */
export function CategoryActionSheet({
  category,
  currentRow,
  moveTargets,
  canMoveUp,
  canMoveDown,
  onMove,
  onMoveMoney,
  onOpenTarget,
  onClose,
  group,
  target,
  onAssign,
  onViewActivity,
  onHide,
}: CategoryActionSheetProps) {
  const [mode, setMode] = useState<Mode>('menu')
  const [draft, setDraft] = useState('')
  // Transferts : enveloppe partenaire choisie + brouillon de montant.
  const [picked, setPicked] = useState<MoveTarget | null>(null)
  const [amountDraft, setAmountDraft] = useState('')
  const rename = useUpdateCategoryMutation()
  const remove = useDeleteCategoryMutation()
  const keyboardInset = useSheetKeyboardInset()

  // Reinitialise la feuille a l'ouverture pour une enveloppe. La categorie est
  // relue du cache a chaque rendu : seul un changement d'enveloppe compte (une
  // relecture de fond ne doit pas renvoyer au menu en pleine saisie).
  const categoryId = category?.id
  const categoryName = category?.name ?? ''
  useEffect(() => {
    if (categoryId !== undefined) {
      setMode('menu')
      setDraft(categoryName)
      setPicked(null)
      setAmountDraft('')
    }
  }, [categoryId])

  if (!category || !currentRow) return null

  const available = currentRow.available
  const canCover = available < 0 && moveTargets.length > 0
  const canMoveOut = available > 0 && moveTargets.length > 0

  const commitRename = () => {
    const name = draft.trim()
    if (name && name !== category.name) {
      rename.mutate({ categoryId: category.id, name })
    }
    onClose()
  }

  // Ouvre l'écran de transfert : le montant est pré-rempli à la sélection de
  // l'enveloppe partenaire (dépassement à couvrir ou excédent à déplacer).
  const openTransfer = (next: 'cover' | 'move') => {
    setPicked(null)
    setAmountDraft('')
    setMode(next)
  }

  // Montant par défaut à la sélection d'une enveloppe partenaire : tout le
  // dépassement (plafonné au disponible de la source s'il est plus petit), ou
  // tout l'excédent à déplacer.
  const selectPartner = (partner: MoveTarget) => {
    const deficit = -available
    const sourceAvailable = partner.row.available
    const defaultCents =
      mode === 'cover' ? (sourceAvailable > 0 ? Math.min(deficit, sourceAvailable) : deficit) : available
    setPicked(partner)
    setAmountDraft(toDraft(defaultCents))
  }

  // Enveloppes candidates triées par disponible décroissant.
  const sortedTargets = [...moveTargets].sort((a, b) => b.row.available - a.row.available)

  const isTransfer = mode === 'cover' || mode === 'move'
  const cents = isTransfer ? parseEuros(amountDraft) : null
  const amountValid = cents !== null && cents > 0

  const commitMove = () => {
    if (!picked || !amountValid) return
    // cover : l'enveloppe partenaire est la SOURCE, la courante reçoit.
    // move  : l'enveloppe courante est la SOURCE, la partenaire reçoit.
    const from = mode === 'cover' ? picked.row : currentRow
    const to = mode === 'cover' ? currentRow : picked.row
    onMoveMoney({
      fromId: from.category.id,
      toId: to.category.id,
      fromAssigned: from.assigned,
      toAssigned: to.assigned,
      amount: cents!,
    })
    onClose()
  }

  // Aperçu du disponible résultant des deux côtés (réassurance, pas de blocage).
  const source = picked ? (mode === 'cover' ? picked.row : currentRow) : null
  const dest = picked ? (mode === 'cover' ? currentRow : picked.row) : null
  const sourceAfter = source ? source.available - (amountValid ? cents! : 0) : 0
  const destAfter = dest ? dest.available + (amountValid ? cents! : 0) : 0

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
      >
        <DialogHeader className="pb-3 pr-14 pt-6">
          <DialogTitle className="flex items-center gap-3">
            <GroupPill group={group} size="md" />
            <span className="min-w-0">
              <span className="block truncate">{category.name}</span>
              {group && (
                <span className="block truncate text-[13px] font-normal tracking-normal text-soft">{group.name}</span>
              )}
            </span>
          </DialogTitle>
          {mode === 'delete' && (
            <DialogDescription>
              Ses transactions repasseront «&nbsp;À catégoriser&nbsp;» et les montants assignés seront
              supprimés. Cette action est définitive.
            </DialogDescription>
          )}
        </DialogHeader>

        {mode === 'menu' && (
          <div className="min-h-0 overflow-y-auto px-4 pb-4">
            {/* Resume du mois : assigne, activite, disponible. */}
            <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface2/60 px-4 py-3 ring-1 ring-inset ring-edge">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-soft">Assigné</p>
                <p className="text-[15px] font-semibold text-ink tnum">{fmtEUR(currentRow.assigned)}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-soft">Activité</p>
                <p className="text-[15px] font-semibold text-ink tnum">
                  {fmtEUR(currentRow.activity)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[12px] font-medium text-soft">Disponible</p>
                <AvailableChip cents={available} className="mt-0.5" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              {onAssign && (
                <ActionTile
                  icon={Coins}
                  label="Assigner"
                  tone="accent"
                  onClick={() => {
                    onClose()
                    onAssign()
                  }}
                />
              )}
              <ActionTile
                icon={TargetIcon}
                label="Objectif"
                hint={target ? targetSummary(target) : 'Aucun'}
                onClick={() => {
                  onClose()
                  onOpenTarget(category)
                }}
              />
              {canCover ? (
                <ActionTile
                  icon={ArrowDownLeft}
                  label="Couvrir"
                  hint={fmtEUR(-available)}
                  tone="danger"
                  onClick={() => openTransfer('cover')}
                />
              ) : (
                <ActionTile
                  icon={ArrowRightLeft}
                  label="Déplacer"
                  hint={canMoveOut ? fmtEUR(available) : undefined}
                  disabled={!canMoveOut}
                  onClick={() => openTransfer('move')}
                />
              )}
              <ActionTile
                icon={ReceiptText}
                label="Activité"
                disabled={!onViewActivity || currentRow.activity === 0}
                onClick={() => {
                  onClose()
                  onViewActivity?.(category.id)
                }}
              />
            </div>

            <div className="mt-3 space-y-0.5">
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
              <ActionRow icon={Pencil} label="Renommer" onClick={() => setMode('rename')} />
              {onHide && (
                <ActionRow
                  icon={EyeOff}
                  label="Masquer l'enveloppe"
                  onClick={() => {
                    onClose()
                    onHide()
                  }}
                />
              )}
              <ActionRow icon={Trash2} label="Supprimer" danger onClick={() => setMode('delete')} />
            </div>
          </div>
        )}

        {isTransfer && !picked && (
          <div className="min-h-0 overflow-y-auto px-4 pb-4">
            <button
              type="button"
              onClick={() => setMode('menu')}
              className="-ml-1 mb-1 flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[13px] font-medium text-soft active:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
              {mode === 'cover'
                ? `Couvrir ${fmtEUR(-available)} depuis quelle enveloppe ?`
                : 'Déplacer vers quelle enveloppe ?'}
            </button>
            <div className="space-y-0.5">
              {sortedTargets.map(({ row, group: partnerGroup }) => (
                <button
                  key={row.category.id}
                  type="button"
                  onClick={() => selectPartner({ row, group: partnerGroup })}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface2 [@media(hover:hover)]:hover:bg-surface2/60"
                >
                  <GroupPill group={partnerGroup} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">{row.category.name}</span>
                    <span className="block truncate text-[12px] text-soft">{partnerGroup.name}</span>
                  </span>
                  <AvailableChip cents={row.available} size="sm" />
                </button>
              ))}
            </div>
          </div>
        )}

        {isTransfer && picked && (
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5 pt-1">
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="-ml-1 flex min-h-[44px] items-center gap-1 rounded-lg px-1 text-[13px] font-medium text-soft active:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
              {mode === 'cover' ? `Depuis ${picked.row.category.name}` : `Vers ${picked.row.category.name}`}
            </button>
            <div className="relative">
              <input
                value={amountDraft}
                onChange={(e) => setAmountDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitMove()
                }}
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                autoFocus
                placeholder="0,00"
                aria-label="Montant à déplacer"
                aria-invalid={!amountValid}
                className={cn(
                  'h-16 w-full rounded-2xl border-2 bg-surface2/40 px-12 text-center text-[32px] font-semibold tracking-tight tnum outline-none transition-[border-color,background-color,box-shadow] duration-150 ease-spring placeholder:text-soft/40 focus:bg-surface focus:ring-4',
                  amountValid ? 'border-accent/40 focus:border-accent focus:ring-accent/15' : 'border-danger/60 focus:ring-danger/15',
                )}
              />
              <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[20px] font-medium text-soft">
                €
              </span>
            </div>
            {/* Apercu des deux enveloppes apres le transfert. */}
            <div className="flex items-stretch gap-2">
              <div className="min-w-0 flex-1 rounded-2xl bg-surface2/60 px-3.5 py-2.5 ring-1 ring-inset ring-edge">
                <p className="truncate text-[12px] font-medium text-soft">{source!.category.name}</p>
                <p className={cn('text-[15px] font-semibold tnum', sourceAfter < 0 ? 'text-danger' : 'text-ink')}>
                  {fmtEUR(sourceAfter)}
                </p>
              </div>
              <span className="flex items-center text-soft" aria-hidden>
                <ArrowRight className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 rounded-2xl bg-surface2/60 px-3.5 py-2.5 ring-1 ring-inset ring-edge">
                <p className="truncate text-[12px] font-medium text-soft">{dest!.category.name}</p>
                <p className={cn('text-[15px] font-semibold tnum', destAfter < 0 ? 'text-danger' : 'text-ink')}>
                  {fmtEUR(destAfter)}
                </p>
              </div>
            </div>
            <Button className="h-12 w-full text-[15px]" onClick={commitMove} disabled={!amountValid}>
              {mode === 'cover' ? 'Couvrir' : 'Déplacer'} {amountValid ? fmtEUR(cents!) : ''}
            </Button>
          </div>
        )}

        {mode === 'rename' && (
          <div className="space-y-3 px-5 pb-5 pt-1">
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
              className="h-12 text-[16px]"
            />
            <div className="flex gap-2.5">
              <Button variant="secondary" className="h-12 flex-1" onClick={() => setMode('menu')}>
                Retour
              </Button>
              <Button className="h-12 flex-1" onClick={commitRename} disabled={!draft.trim()}>
                Renommer
              </Button>
            </div>
          </div>
        )}

        {mode === 'delete' && (
          <div className="flex gap-2.5 px-5 pb-5 pt-2">
            <Button variant="secondary" className="h-12 flex-1" onClick={() => setMode('menu')}>
              Retour
            </Button>
            <Button
              variant="danger"
              className="h-12 flex-1"
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
