import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  Pencil,
  Target as TargetIcon,
  Trash2,
} from 'lucide-react'
import type { Category, CategoryGroup } from '@/mocks/data'
import type { BudgetRow } from '@/lib/budget'
import {
  useDeleteCategoryMutation,
  useUpdateCategoryMutation,
} from '@/lib/taxonomy'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GroupPill } from '@/components/shared/GroupPill'
import { AvailablePill } from '@/components/budget/AvailablePill'
import { fmtEUR } from '@/lib/format'
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
}

/** Parse un montant en euros (fr-FR) vers des centimes positifs, ou null. */
function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

function toDraft(cents: number): string {
  return cents <= 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
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

type Mode = 'menu' | 'rename' | 'delete' | 'cover' | 'move'

/**
 * Feuille contextuelle d'une enveloppe (appui long sur mobile) : renommer,
 * objectif, couvrir un dépassement / déplacer un excédent, déplacer dans le
 * groupe, supprimer. Écrans internes pilotés par `mode` ; les transferts
 * d'argent se font en deux temps : choix de l'enveloppe puis saisie du montant.
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
}: CategoryActionSheetProps) {
  const [mode, setMode] = useState<Mode>('menu')
  const [draft, setDraft] = useState('')
  // Transferts : enveloppe partenaire choisie + brouillon de montant.
  const [picked, setPicked] = useState<MoveTarget | null>(null)
  const [amountDraft, setAmountDraft] = useState('')
  const rename = useUpdateCategoryMutation()
  const remove = useDeleteCategoryMutation()
  const keyboardInset = useKeyboardInset()

  useEffect(() => {
    if (category) {
      setMode('menu')
      setDraft(category.name)
      setPicked(null)
      setAmountDraft('')
    }
  }, [category])

  if (!category || !currentRow) return null

  const available = currentRow.available
  const canCover = available < 0
  const canMoveOut = available > 0

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

  // Montant par défaut à la sélection d'une enveloppe partenaire.
  const selectPartner = (partner: MoveTarget) => {
    const defaultCents = mode === 'cover' ? -available : available
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
        <DialogHeader>
          <DialogTitle className="flex items-baseline justify-between gap-3 pr-8">
            <span className="truncate">{category.name}</span>
            {mode === 'menu' && (
              <span className="shrink-0 text-[12.5px] font-normal text-soft">
                Disponible <span className="tnum">{fmtEUR(available)}</span>
              </span>
            )}
          </DialogTitle>
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
            {canCover && moveTargets.length > 0 && (
              <ActionRow
                icon={ArrowDownLeft}
                label="Couvrir depuis…"
                onClick={() => openTransfer('cover')}
              />
            )}
            {canMoveOut && moveTargets.length > 0 && (
              <ActionRow
                icon={ArrowUpRight}
                label="Déplacer vers…"
                onClick={() => openTransfer('move')}
              />
            )}
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

        {isTransfer && !picked && (
          <div className="p-3 pt-0">
            <p className="px-1 pb-2 text-[13px] text-soft">
              {mode === 'cover'
                ? `Renflouer ${fmtEUR(-available)} depuis une enveloppe :`
                : 'Déplacer vers quelle enveloppe ?'}
            </p>
            <div className="max-h-[46vh] space-y-0.5 overflow-y-auto">
              {sortedTargets.map(({ row, group }) => (
                <button
                  key={row.category.id}
                  type="button"
                  onClick={() => selectPartner({ row, group })}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-surface2"
                >
                  <GroupPill group={group} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                    {row.category.name}
                  </span>
                  <AvailablePill cents={row.available} />
                </button>
              ))}
            </div>
          </div>
        )}

        {isTransfer && picked && (
          <div className="space-y-3 overflow-y-auto p-5 pt-0">
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="-ml-1 flex min-h-[44px] items-center gap-1 text-[13px] font-medium text-soft active:text-ink"
            >
              <ChevronLeft className="h-4 w-4" />
              {mode === 'cover'
                ? `Depuis ${picked.row.category.name}`
                : `Vers ${picked.row.category.name}`}
            </button>
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
              className={cn(
                'h-14 w-full rounded-2xl border-2 bg-surface2/40 px-4 text-center text-[28px] font-semibold tnum outline-none transition-colors placeholder:text-soft/50 focus:bg-surface',
                amountValid ? 'border-accent/50 focus:border-accent' : 'border-danger/60',
              )}
            />
            <div className="flex items-center justify-between gap-3 px-1 text-[12.5px] text-soft">
              <span className="min-w-0 truncate">
                {source!.category.name} : <span className="tnum">{fmtEUR(sourceAfter)}</span>
              </span>
              <span className="min-w-0 truncate text-right">
                {dest!.category.name} : <span className="tnum">{fmtEUR(destAfter)}</span>
              </span>
            </div>
            <Button className="h-12 w-full text-[15px]" onClick={commitMove} disabled={!amountValid}>
              {mode === 'cover' ? 'Couvrir' : 'Déplacer'}
            </Button>
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
