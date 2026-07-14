import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { fmtEUR } from '@/lib/format'
import type { BudgetRow } from '@/lib/budget'
import type { Target } from '@/lib/targets'
import { cn } from '@/lib/utils'

interface AssignSheetProps {
  row: BudgetRow | null
  target: Target | null
  onCommit: (categoryId: string, cents: number) => void
  // Clic sur l'activite : ferme la feuille et ouvre les transactions filtrees.
  onViewActivity?: (categoryId: string) => void
  onClose: () => void
}

function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  // Champ vide ou signe seul -> 0 (etat transitoire de saisie).
  if (!trimmed || trimmed === '-') return 0
  // Un montant negatif est accepte : il retire de l'argent de l'enveloppe
  // vers le Pret a assigner (parite YNAB).
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed)) return null
  return Math.round(parsed * 100)
}

function toDraft(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Feuille d'assignation mobile : tape sur un montant assigne -> panneau en bas
 * d'ecran avec grand champ, raccourcis (objectif, remise a zero, increments)
 * et apercu du Disponible resultant. Validation optimiste via onCommit.
 */
export function AssignSheet({ row, target, onCommit, onViewActivity, onClose }: AssignSheetProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // iOS : le clavier recouvre les feuilles fixed bottom-0. On remonte la
  // feuille de la hauteur du clavier mesuree via visualViewport.
  const keyboardInset = useKeyboardInset()

  // (Re)initialise le brouillon a l'ouverture pour la categorie visee.
  useEffect(() => {
    if (row) {
      setDraft(toDraft(row.assigned))
      // Focus differe : le dialog doit etre monte avant que le clavier s'ouvre.
      requestAnimationFrame(() => {
        const input = inputRef.current
        input?.focus()
        try {
          input?.setSelectionRange(0, input.value.length)
        } catch {
          input?.select()
        }
      })
    }
  }, [row])

  if (!row) return null

  const cents = parseEuros(draft)
  const valid = cents !== null
  const availableAfter = valid ? row.available + (cents - row.assigned) : row.available

  const setCents = (value: number) => {
    // Pas de clamp a 0 : un assigne negatif est un retrait vers le RTA.
    setDraft(toDraft(value))
    inputRef.current?.focus()
  }
  const addCents = (delta: number) => setCents((parseEuros(draft) ?? row.assigned) + delta)
  // Vider l'enveloppe : ramener le disponible a 0 en rendant tout le disponible
  // au Pret a assigner. available = rollover + assigned + activity, donc pour
  // available = 0 il faut assigned = assigned - available.
  const emptyToRta = row.assigned - row.available

  const commit = () => {
    if (!valid) return
    if (cents !== row.assigned) onCommit(row.category.id, cents)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        // Cale la feuille au-dessus du clavier iOS ; transition douce pour
        // suivre son apparition sans saut.
        style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
      >
        <DialogHeader className="pb-1">
          <DialogTitle className="flex items-baseline justify-between gap-3 pr-8">
            <span className="truncate">{row.category.name}</span>
            {onViewActivity && row.activity !== 0 ? (
              <button
                type="button"
                onClick={() => onViewActivity(row.category.id)}
                className="shrink-0 rounded-md text-[12.5px] font-normal text-soft underline underline-offset-2 active:text-ink"
              >
                Activité <span className="tnum">{fmtEUR(row.activity)}</span>
              </button>
            ) : (
              <span className="shrink-0 text-[12.5px] font-normal text-soft">
                Activité <span className="tnum">{fmtEUR(row.activity)}</span>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto p-5 pt-0">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0,00"
            aria-label="Montant assigné ce mois"
            className={cn(
              'h-14 w-full rounded-2xl border-2 bg-surface2/40 px-4 text-center text-[28px] font-semibold tnum outline-none transition-colors placeholder:text-soft/50 focus:bg-surface',
              valid ? 'border-accent/50 focus:border-accent' : 'border-danger/60',
            )}
          />

          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {target && target.amount !== row.assigned && (
              <button
                type="button"
                onClick={() => setCents(target.amount)}
                className="h-9 shrink-0 whitespace-nowrap rounded-full border border-accent/40 bg-accent/10 px-3.5 text-[13px] font-medium text-accent active:bg-accent/20"
              >
                Objectif : {fmtEUR(target.amount)}
              </button>
            )}
            <button
              type="button"
              onClick={() => addCents(5000)}
              className="h-9 shrink-0 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink active:bg-surface2"
            >
              +50 €
            </button>
            <button
              type="button"
              onClick={() => addCents(10000)}
              className="h-9 shrink-0 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink active:bg-surface2"
            >
              +100 €
            </button>
            <button
              type="button"
              onClick={() => setCents(0)}
              className="h-9 shrink-0 whitespace-nowrap rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-soft active:bg-surface2"
            >
              Remettre à 0
            </button>
            {row.available > 0 && (
              <button
                type="button"
                onClick={() => setCents(emptyToRta)}
                title="Vider cette enveloppe vers le Prêt à assigner"
                className="h-9 shrink-0 whitespace-nowrap rounded-full border border-success/40 bg-success/10 px-3.5 text-[13px] font-medium text-success active:bg-success/20"
              >
                Vider
              </button>
            )}
          </div>

          {/* Effet de l'assignation, HORS du bouton colore (le rouge d'un
              disponible negatif serait illisible sur le fond accent). */}
          <div className="flex items-center justify-between px-1 text-[13px]">
            <span className="text-soft">Disponible après</span>
            <span className={cn('font-semibold tnum', availableAfter < 0 ? 'text-danger' : 'text-ink')}>
              {fmtEUR(availableAfter)}
            </span>
          </div>

          <Button className="h-12 w-full text-[15px]" onClick={commit} disabled={!valid}>
            {valid && cents !== null && cents < 0 ? 'Retirer' : 'Assigner'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
