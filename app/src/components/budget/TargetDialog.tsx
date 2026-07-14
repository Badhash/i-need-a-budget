import { useEffect, useState } from 'react'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Category } from '@/mocks/data'
import { apiDeleteTarget, apiSetTarget, type SetTargetInput, type Target } from '@/lib/targets'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { CURRENT_MONTH, MAX_MONTH } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type TargetType = 'monthly' | 'byDate'

/** Parse un montant en euros saisi (fr-FR) vers des centimes entiers. */
function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

/** Centimes -> chaine editable "400,00" (sans separateur de milliers). */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

interface TargetDialogProps {
  /** Categorie ciblee : non nul => dialog ouvert. */
  category: Category | null
  /** Objectif existant pour cette categorie, sinon null (creation). */
  target: Target | null
  onClose: () => void
}

/** Creation / edition / suppression de l'objectif d'une categorie. */
export function TargetDialog({ category, target, onClose }: TargetDialogProps) {
  const queryClient = useQueryClient()

  const [type, setType] = useState<TargetType>('monthly')
  const [amount, setAmount] = useState('')
  const [dueMonth, setDueMonth] = useState(CURRENT_MONTH)
  const [error, setError] = useState<string | null>(null)

  // Reinitialise le formulaire a chaque ouverture (categorie / objectif).
  useEffect(() => {
    if (!category) return
    if (target) {
      setType(target.type)
      setAmount(centsToInput(target.amount))
      setDueMonth(target.dueMonth ?? CURRENT_MONTH)
    } else {
      setType('monthly')
      setAmount('')
      setDueMonth(CURRENT_MONTH)
    }
    setError(null)
  }, [category, target])

  // Serialise derriere une eventuelle creation de categorie en vol : le
  // categoryId est resolu temp -> real avant l'envoi de l'objectif.
  const setMutation = useMutation({
    mutationFn: (input: SetTargetInput) =>
      enqueue(() => apiSetTarget({ ...input, categoryId: resolveId(input.categoryId) }), {
        deps: [input.categoryId],
      }),
    onSuccess: () => {
      // Un objectif ne touche que la query des objectifs (et le plan de
      // financement du budget qui la consomme).
      void queryClient.invalidateQueries({ queryKey: ['targets'] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (categoryId: string) =>
      enqueue(() => apiDeleteTarget(resolveId(categoryId)), { deps: [categoryId] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['targets'] })
      onClose()
    },
  })

  const submit = () => {
    if (!category) return
    const cents = parseEuros(amount)
    if (cents === null || cents <= 0) {
      setError('Saisissez un montant valide, par exemple 400,00.')
      return
    }
    if (type === 'byDate' && !dueMonth) {
      setError('Choisissez un mois cible.')
      return
    }
    setError(null)
    setMutation.mutate({
      categoryId: category.id,
      type,
      amount: cents,
      dueMonth: type === 'byDate' ? dueMonth : null,
    })
  }

  const remove = () => {
    if (category) deleteMutation.mutate(category.id)
  }

  const pending = setMutation.isPending || deleteMutation.isPending
  const keyboardInset = useKeyboardInset()

  return (
    <Dialog open={category !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
      >
        <DialogHeader>
          <DialogTitle>{target ? "Modifier l'objectif" : 'Nouvel objectif'}</DialogTitle>
          <DialogDescription>
            {category?.name ?? ''} — définissez un montant à financer.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-2">
          <div>
            <label htmlFor="target-type" className="label-caps mb-1.5 block">
              Type d'objectif
            </label>
            <Select
              id="target-type"
              value={type}
              onChange={(e) => setType(e.target.value as TargetType)}
            >
              <option value="monthly">Chaque mois</option>
              <option value="byDate">Pour une date</option>
            </Select>
          </div>

          <div className={cn('gap-3', type === 'byDate' && 'grid grid-cols-2')}>
            <div>
              <label htmlFor="target-amount" className="label-caps mb-1.5 block">
                Montant
              </label>
              <div className="relative">
                <Input
                  id="target-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0,00"
                  inputMode="decimal"
                  autoFocus
                  className="pr-8 text-right text-[17px] font-semibold tnum"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-soft">
                  €
                </span>
              </div>
            </div>
            {type === 'byDate' && (
              <div>
                <label htmlFor="target-due" className="label-caps mb-1.5 block">
                  Mois cible
                </label>
                <Input
                  id="target-due"
                  type="month"
                  value={dueMonth}
                  min={CURRENT_MONTH}
                  max={MAX_MONTH}
                  onChange={(e) => setDueMonth(e.target.value)}
                />
              </div>
            )}
          </div>

          <p className="text-[12.5px] text-soft">
            {type === 'monthly'
              ? "Vous prévoyez d'allouer ce montant à cette catégorie chaque mois."
              : "Épargnez ce montant total d'ici le mois choisi."}
          </p>

          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-line p-5">
          {target && (
            <Button
              variant="ghost"
              className="text-danger hover:bg-danger/10 hover:text-danger"
              onClick={remove}
              disabled={pending}
            >
              Supprimer
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={submit} disabled={pending}>
              {setMutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
