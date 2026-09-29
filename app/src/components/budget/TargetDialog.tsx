import { useEffect, useMemo, useRef, useState } from 'react'
import { BatteryCharging, CalendarClock, Check, Repeat, Trash2, type LucideIcon } from 'lucide-react'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import type { Category } from '@/types/domain'
import type { BudgetRow } from '@/lib/budget'
import {
  useDeleteTargetMutation,
  useSetTargetMutation,
  type Target,
  type TargetType,
} from '@/lib/targets'
import { useGroupsMap, useServerFeatures } from '@/lib/data'
import { SERVER_FEATURES } from '@/lib/features'
import { addMonths, currentMonth, evalAmountCents, fmtEUR, fmtMonthLong } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { DueMonthField, relativeMonths } from '@/components/budget/DueMonthField'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Horizon des objectifs a echeance : 10 ans (projets longs, apport, voiture...). */
const DUE_HORIZON_MONTHS = 120

interface TypeOption {
  type: TargetType
  label: string
  description: string
  icon: LucideIcon
}

const TYPE_OPTIONS: TypeOption[] = [
  { type: 'monthly', label: 'Chaque mois', description: 'Assigner ce montant tous les mois.', icon: Repeat },
  { type: 'byDate', label: 'Pour une date', description: "Épargner ce total d'ici une échéance.", icon: CalendarClock },
  {
    type: 'refill',
    label: "Recharger jusqu'à",
    description: "Remplit l'enveloppe jusqu'au montant, report compris.",
    icon: BatteryCharging,
  },
]

const AMOUNT_LABEL: Record<TargetType, string> = {
  monthly: 'Montant par mois',
  byDate: 'Montant à atteindre',
  refill: "Niveau de l'enveloppe",
}

/** Parse un montant en euros saisi (fr-FR) vers des centimes entiers. */
function parseEuros(raw: string): number | null {
  if (!raw.trim()) return null
  // Parser strict partage : « 1.234,56 » est rejete au lieu d'etre tronque.
  const cents = evalAmountCents(raw)
  if (cents === null || cents < 0) return null
  return cents
}

/** Centimes -> chaine editable "400,00" (sans separateur de milliers). */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

/** Nombre de mois de `from` a `to` inclus (1 au minimum). */
function monthsInclusive(from: string, to: string): number {
  const [yf, mf] = from.split('-').map(Number)
  const [yt, mt] = to.split('-').map(Number)
  return Math.max(1, (yt! - yf!) * 12 + (mt! - mf!) + 1)
}

/** Explication en clair de l'objectif saisi (et de son effort mensuel). */
function explain(type: TargetType, cents: number, dueMonth: string, row: BudgetRow | null, month: string): string {
  if (type === 'monthly') {
    return `${fmtEUR(cents)} à assigner chaque mois : «\u00a0Financer les objectifs\u00a0» complète l'enveloppe jusqu'à ce montant.`
  }
  if (type === 'refill') {
    const now = row ? ` Ce mois-ci : ${fmtEUR(Math.max(0, cents - row.available))} à ajouter.` : ''
    return `Chaque mois, l'enveloppe est remise à ${fmtEUR(cents)} : seul le manque est à assigner, le report compte.${now}`
  }
  const saved = row ? Math.max(row.available, 0) : 0
  const remaining = Math.max(0, cents - saved)
  if (remaining === 0) return `Déjà atteint : l'enveloppe contient ${fmtEUR(saved)}.`
  const months = monthsInclusive(month, dueMonth)
  const perMonth = Math.ceil(remaining / months)
  const already = saved > 0 ? `${fmtEUR(saved)} déjà de côté : encore ` : 'Encore '
  return months === 1
    ? `${already}${fmtEUR(remaining)} à mettre de côté ce mois-ci.`
    : `${already}${fmtEUR(remaining)} d'ici ${fmtMonthLong(dueMonth)}, soit environ ${fmtEUR(perMonth)} par mois pendant ${months} mois.`
}

interface TargetDialogProps {
  /** Categorie ciblee : non nul => dialog ouvert. */
  category: Category | null
  /** Objectif existant pour cette categorie, sinon null (creation). */
  target: Target | null
  /** Ligne budget du mois affiche (disponible actuel), pour chiffrer l'effort. */
  row?: BudgetRow | null
  onClose: () => void
}

/**
 * Creation / edition / suppression de l'objectif d'une categorie. Optimiste :
 * la feuille se ferme aussitot et la jauge d'objectif se met a jour sans
 * attendre le serveur (rollback discret en cas d'echec).
 */
export function TargetDialog({ category, target, row = null, onClose }: TargetDialogProps) {
  const groups = useGroupsMap()
  const features = useServerFeatures()
  const month = useUiStore((s) => s.month)
  const setMutation = useSetTargetMutation()
  const deleteMutation = useDeleteTargetMutation()
  const keyboardInset = useSheetKeyboardInset()
  const amountRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<TargetType>('monthly')
  const [amount, setAmount] = useState('')
  const [dueMonth, setDueMonth] = useState(() => addMonths(currentMonth(), 6))
  const [error, setError] = useState<string | null>(null)

  // Reinitialise le formulaire a chaque ouverture (categorie / objectif).
  useEffect(() => {
    if (!category) return
    if (target) {
      setType(target.type)
      setAmount(centsToInput(target.amount))
      setDueMonth(target.dueMonth ?? addMonths(currentMonth(), 6))
    } else {
      setType('monthly')
      setAmount('')
      setDueMonth(addMonths(currentMonth(), 6))
    }
    setError(null)
  }, [category, target])

  // « Recharger jusqu'a » n'existe qu'avec un serveur qui l'annonce ; un
  // objectif recharge deja pose reste editable dans tous les cas.
  const options = TYPE_OPTIONS.filter(
    (o) => o.type !== 'refill' || features.has(SERVER_FEATURES.refillTargets) || target?.type === 'refill',
  )

  // Echeance : jusqu'a 10 ans ; une echeance passee d'un objectif existant
  // reste selectionnable (sinon elle serait perdue a l'enregistrement).
  const thisMonth = currentMonth()
  const horizon = addMonths(thisMonth, DUE_HORIZON_MONTHS)
  const minDue = target?.dueMonth && target.dueMonth < thisMonth ? target.dueMonth : thisMonth
  const maxDue = target?.dueMonth && target.dueMonth > horizon ? target.dueMonth : horizon

  const cents = parseEuros(amount)
  const explanation = useMemo(
    () => (cents && cents > 0 ? explain(type, cents, dueMonth, row, month) : null),
    [cents, type, dueMonth, row, month],
  )

  const submit = () => {
    if (!category) return
    if (cents === null || cents <= 0) {
      setError('Saisissez un montant valide, par exemple 400,00.')
      amountRef.current?.focus()
      return
    }
    if (type === 'byDate' && (!dueMonth || dueMonth < minDue || dueMonth > maxDue)) {
      setError('Choisissez une échéance dans les 10 prochaines années.')
      return
    }
    setMutation.mutate({
      categoryId: category.id,
      type,
      amount: cents,
      dueMonth: type === 'byDate' ? dueMonth : null,
    })
    onClose()
  }

  const remove = () => {
    if (!category || !target) return
    const previous = target
    const categoryId = category.id
    deleteMutation.mutate(categoryId)
    onClose()
    toast({
      id: `target-${categoryId}`,
      message: 'Objectif supprimé',
      description: category.name,
      action: {
        label: 'Annuler',
        onClick: () =>
          setMutation.mutate({
            categoryId,
            type: previous.type,
            amount: previous.amount,
            dueMonth: previous.dueMonth,
          }),
      },
    })
  }

  const group = category ? groups.get(category.groupId) : undefined

  return (
    <Dialog open={category !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}
        onOpenAutoFocus={(e) => {
          // Nouvel objectif : le montant d'abord. Edition : pas de clavier d'office.
          e.preventDefault()
          if (!target) amountRef.current?.focus()
        }}
      >
        <DialogHeader className="pb-3 pr-14 pt-6">
          <DialogTitle className="flex items-center gap-3">
            <GroupPill group={group} size="md" />
            <span className="min-w-0">
              <span className="block truncate">{target ? "Modifier l'objectif" : 'Nouvel objectif'}</span>
              <span className="block truncate text-[13.5px] font-normal tracking-normal text-soft">
                {category?.name ?? ''}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choisissez le type d'objectif et le montant à financer pour cette enveloppe.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-2 pt-1">
          <div role="radiogroup" aria-label="Type d'objectif" className="space-y-2">
            {options.map((option) => {
              const selected = option.type === type
              const Icon = option.icon
              return (
                <button
                  key={option.type}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setType(option.type)
                    setError(null)
                  }}
                  className={cn(
                    'flex min-h-[60px] w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-spring active:scale-[0.99]',
                    selected
                      ? 'border-accent/50 bg-accent/[0.07] ring-1 ring-inset ring-accent/30'
                      : 'border-edge bg-surface hover:border-line hover:bg-surface2/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                      selected ? 'bg-accent text-accentfg shadow-button' : 'bg-surface2 text-soft',
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight text-ink">{option.label}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-soft">{option.description}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      selected ? 'border-accent bg-accent text-accentfg' : 'border-line',
                    )}
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3.2} />}
                  </span>
                </button>
              )
            })}
          </div>

          <div>
            <label htmlFor="target-amount" className="label-caps mb-1.5 block">
              {AMOUNT_LABEL[type]}
            </label>
            <div className="relative">
              <input
                ref={amountRef}
                id="target-amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder="0,00"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                aria-invalid={error !== null && (cents === null || cents <= 0)}
                className="h-14 w-full rounded-2xl border border-line bg-surface pl-4 pr-10 text-right text-[24px] font-semibold tracking-tight text-ink shadow-[inset_0_1px_2px_rgb(var(--ink)/0.03)] outline-none transition-[border-color,box-shadow] duration-150 ease-spring tnum placeholder:text-soft/45 hover:border-soft/40 focus:border-accent/70 focus:ring-4 focus:ring-accent/15"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[18px] font-medium text-soft">
                €
              </span>
            </div>
          </div>

          {type === 'byDate' && (
            <div>
              <label htmlFor="target-due" className="label-caps mb-1.5 block">
                Échéance
              </label>
              <DueMonthField id="target-due" value={dueMonth} onChange={setDueMonth} min={minDue} max={maxDue} />
              {dueMonth < thisMonth && (
                <p className="mt-1.5 text-[12.5px] text-warning">
                  Échéance passée ({relativeMonths(dueMonth)}) : il reste tout à financer maintenant.
                </p>
              )}
            </div>
          )}

          {explanation && (
            <p className="animate-fade-in rounded-2xl bg-surface2/70 px-4 py-3 text-[13px] leading-relaxed text-soft">
              {explanation}
            </p>
          )}

          {error && (
            <p role="alert" className="text-[13px] font-medium text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line/70 px-5 pb-5 pt-4">
          {target && (
            <Button
              variant="ghost"
              className="h-12 gap-1.5 px-3 text-danger hover:bg-danger/10 hover:text-danger lg:h-10"
              onClick={remove}
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </Button>
          )}
          <Button variant="secondary" className="ml-auto hidden h-10 sm:inline-flex" onClick={onClose}>
            Annuler
          </Button>
          <Button className="h-12 flex-1 text-[15px] sm:h-10 sm:flex-none sm:text-[14px] max-sm:ml-auto" onClick={submit}>
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
