import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { fmtEUR } from '@/lib/format'
import type { BudgetRow } from '@/lib/budget'
import type { Target } from '@/lib/targets'
import { cn } from '@/lib/utils'

interface AssignSheetProps {
  row: BudgetRow | null
  target: Target | null
  onCommit: (categoryId: string, cents: number) => void
  onClose: () => void
}

function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed < 0) return null
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
export function AssignSheet({ row, target, onCommit, onClose }: AssignSheetProps) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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
    setDraft(toDraft(Math.max(value, 0)))
    inputRef.current?.focus()
  }
  const addCents = (delta: number) => setCents((parseEuros(draft) ?? row.assigned) + delta)

  const commit = () => {
    if (!valid) return
    if (cents !== row.assigned) onCommit(row.category.id, cents)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{row.category.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-5 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-surface2/60 px-3.5 py-2.5">
              <p className="label-caps">Activité</p>
              <p className="mt-0.5 text-[15px] font-semibold tnum">{fmtEUR(row.activity)}</p>
            </div>
            <div className="rounded-xl bg-surface2/60 px-3.5 py-2.5">
              <p className="label-caps">Disponible</p>
              <p
                className={cn(
                  'mt-0.5 text-[15px] font-semibold tnum',
                  row.available < 0 ? 'text-danger' : row.available > 0 ? 'text-success' : 'text-soft',
                )}
              >
                {fmtEUR(row.available)}
              </p>
            </div>
          </div>
          <div>
            <label className="label-caps mb-1.5 block">Montant assigné ce mois</label>
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
              className={cn(
                'h-16 w-full rounded-2xl border-2 bg-surface2/40 px-4 text-center text-[30px] font-semibold tnum outline-none transition-colors placeholder:text-soft/50 focus:bg-surface',
                valid ? 'border-accent/50 focus:border-accent' : 'border-danger/60',
              )}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {target && target.amount !== row.assigned && (
              <button
                type="button"
                onClick={() => setCents(target.amount)}
                className="h-9 rounded-full border border-accent/40 bg-accent/10 px-3.5 text-[13px] font-medium text-accent active:bg-accent/20"
              >
                Objectif : {fmtEUR(target.amount)}
              </button>
            )}
            <button
              type="button"
              onClick={() => addCents(5000)}
              className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink active:bg-surface2"
            >
              +50 €
            </button>
            <button
              type="button"
              onClick={() => addCents(10000)}
              className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-ink active:bg-surface2"
            >
              +100 €
            </button>
            <button
              type="button"
              onClick={() => setCents(0)}
              className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-soft active:bg-surface2"
            >
              Remettre à 0
            </button>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-surface2/60 px-4 py-3 text-[13.5px]">
            <span className="text-soft">Disponible après</span>
            <span
              className={cn(
                'font-semibold tnum',
                availableAfter < 0 ? 'text-danger' : availableAfter > 0 ? 'text-success' : 'text-soft',
              )}
            >
              {fmtEUR(availableAfter)}
            </span>
          </div>

          <Button className="h-12 w-full text-[15px]" onClick={commit} disabled={!valid}>
            Assigner
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
