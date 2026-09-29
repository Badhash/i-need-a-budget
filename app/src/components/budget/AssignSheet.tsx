import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { TargetBar } from '@/components/budget/TargetBar'
import { useAssignSuggestions } from '@/components/budget/useAssignSuggestions'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { evalAmountCents, fmtEUR } from '@/lib/format'
import type { BudgetRow } from '@/lib/budget'
import type { Target } from '@/lib/targets'
import type { CategoryGroup } from '@/types/domain'
import { cn } from '@/lib/utils'

interface AssignSheetProps {
  row: BudgetRow | null
  target: Target | null
  /** Mois affiche : sert a calculer la part d'un objectif a echeance. */
  month: string
  /** Groupe de l'enveloppe (pastille du titre). */
  group?: CategoryGroup
  /** Pret a assigner du mois (apercu apres assignation). */
  rta?: number
  onCommit: (categoryId: string, cents: number) => void
  // Clic sur l'activite : ferme la feuille et ouvre les transactions filtrees.
  onViewActivity?: (categoryId: string) => void
  onClose: () => void
}

// Champ vide ou signe seul -> 0 (etat transitoire de saisie). Une expression
// arithmetique est acceptee ("200,00+152" -> 352 €), tout comme un montant
// negatif (retrait de l'enveloppe vers le Pret a assigner, parite YNAB).
function parseEuros(raw: string): number | null {
  return evalAmountCents(raw)
}

function toDraft(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

const CHIP =
  'inline-flex h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 text-[13.5px] font-medium ring-1 ring-inset transition-[background-color,color,transform] duration-150 ease-spring active:scale-95'

/**
 * Feuille d'assignation mobile : tape sur une enveloppe -> panneau en bas
 * d'ecran avec grand champ, valeurs rapides (objectif, mois dernier, moyenne),
 * increments et apercu du Disponible et du Pret a assigner resultants.
 * Validation optimiste via onCommit.
 */
export function AssignSheet({ row, target, month, group, rta, onCommit, onViewActivity, onClose }: AssignSheetProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // iOS : le clavier recouvre les feuilles fixed bottom-0. On remonte la
  // feuille de la hauteur du clavier mesuree via visualViewport.
  const keyboardInset = useSheetKeyboardInset()
  // Valeurs rapides : objectif (part du mois), assigne / depense le mois
  // dernier, moyenne 3 mois. Hook inconditionnel (ligne nulle -> liste vide).
  const suggestions = useAssignSuggestions(row, month)

  // (Re)initialise le brouillon a l'ouverture pour la categorie visee. La
  // ligne est relue du cache a chaque rendu (sa reference change a chaque
  // mise a jour) : seul un changement d'enveloppe reinitialise la saisie.
  const categoryId = row?.category.id
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
  }, [categoryId])

  if (!row) return null

  const cents = parseEuros(draft)
  const valid = cents !== null
  const next = valid ? cents : row.assigned
  const availableAfter = row.available + (next - row.assigned)
  const rtaAfter = rta === undefined ? null : rta - (next - row.assigned)

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
        // Cale la feuille au-dessus du clavier iOS ; transition douce pour
        // suivre son apparition sans saut.
        style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
      >
        <DialogHeader className="pb-3 pr-14 pt-6">
          <DialogTitle className="flex items-center gap-3">
            <GroupPill group={group} size="md" />
            <span className="min-w-0">
              <span className="block truncate">{row.category.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[13px] font-normal tracking-normal text-soft">
                <span className="tnum">Disponible {fmtEUR(row.available)}</span>
                <span aria-hidden>·</span>
                {onViewActivity && row.activity !== 0 ? (
                  <button
                    type="button"
                    onClick={() => onViewActivity(row.category.id)}
                    className="relative inline-flex items-center gap-0.5 rounded-md font-medium text-accent-ink underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline dark:text-accent"
                  >
                    <span className="tnum">Activité {fmtEUR(row.activity)}</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <span className="tnum">Activité {fmtEUR(row.activity)}</span>
                )}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">Montant assigné à cette enveloppe pour le mois.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5 pt-1.5">
          <div className="relative">
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
              aria-invalid={!valid}
              className={cn(
                'h-16 w-full rounded-2xl border-2 bg-surface2/40 px-12 text-center text-[32px] font-semibold tracking-tight tnum outline-none transition-[border-color,background-color,box-shadow] duration-150 ease-spring placeholder:text-soft/40 focus:bg-surface focus:ring-4',
                valid ? 'border-accent/40 focus:border-accent focus:ring-accent/15' : 'border-danger/60 focus:ring-danger/15',
              )}
            />
            <span className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[20px] font-medium text-soft">
              €
            </span>
          </div>

          {suggestions.length > 0 && (
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 scrollbar-none" aria-label="Valeurs rapides">
              {suggestions.map((s) => {
                const active = valid && cents === s.cents
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setCents(s.cents)}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-[52px] shrink-0 flex-col items-start justify-center rounded-2xl px-3.5 py-2 text-left ring-1 ring-inset transition-[background-color,box-shadow,transform] duration-150 ease-spring active:scale-95',
                      active
                        ? 'bg-accent/10 ring-accent/40'
                        : s.key === 'target'
                          ? 'bg-accent/[0.06] ring-accent/20'
                          : 'bg-surface ring-edge',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11.5px] font-medium',
                        s.key === 'target' || active ? 'text-accent-ink dark:text-accent' : 'text-soft',
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="text-[15px] font-semibold tracking-tight text-ink tnum">{fmtEUR(s.cents)}</span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-0.5 scrollbar-none">
            <button type="button" onClick={() => addCents(5000)} className={cn(CHIP, 'bg-surface text-ink ring-edge')}>
              +50 €
            </button>
            <button type="button" onClick={() => addCents(10000)} className={cn(CHIP, 'bg-surface text-ink ring-edge')}>
              +100 €
            </button>
            <button type="button" onClick={() => setCents(0)} className={cn(CHIP, 'bg-surface text-soft ring-edge')}>
              Remettre à 0
            </button>
            {row.available > 0 && (
              <button
                type="button"
                onClick={() => setCents(emptyToRta)}
                title="Vider cette enveloppe vers le Prêt à assigner"
                className={cn(CHIP, 'bg-success/10 text-success ring-success/25')}
              >
                Vider
              </button>
            )}
          </div>

          {/* Effet de l'assignation, HORS du bouton colore (le rouge d'un
              disponible negatif serait illisible sur le fond accent). */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line/70 ring-1 ring-inset ring-edge">
            <div className="bg-surface px-4 py-3">
              <p className="text-[12px] font-medium text-soft">Disponible après</p>
              <p className={cn('mt-0.5 text-[17px] font-semibold tracking-tight tnum', availableAfter < 0 ? 'text-danger' : 'text-ink')}>
                {fmtEUR(availableAfter)}
              </p>
            </div>
            <div className="bg-surface px-4 py-3">
              <p className="text-[12px] font-medium text-soft">Prêt à assigner après</p>
              <p
                className={cn(
                  'mt-0.5 text-[17px] font-semibold tracking-tight tnum',
                  rtaAfter !== null && rtaAfter < 0 ? 'text-danger' : 'text-ink',
                )}
              >
                {rtaAfter === null ? '—' : fmtEUR(rtaAfter)}
              </p>
            </div>
          </div>

          {target && (
            <div className="rounded-2xl px-1">
              <TargetBar target={target} assigned={next} available={availableAfter} color="" month={month} />
            </div>
          )}

          <Button className="h-12 w-full text-[15px]" onClick={commit} disabled={!valid}>
            {valid && cents !== null && cents < 0 ? 'Retirer' : 'Assigner'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
