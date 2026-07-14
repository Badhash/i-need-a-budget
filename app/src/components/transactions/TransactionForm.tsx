import { useEffect, useState } from 'react'
import { useAccountsList, useCategoriesList, useGroupsList } from '@/lib/data'
import { MIN_MONTH, TODAY } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const MIN_DATE = `${MIN_MONTH}-01`

export type TxKind = 'expense' | 'income'

// Valeurs normalisees remontees a l'appelant : montant signe en centimes,
// note vide -> null.
export interface TxFormResult {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number
  note: string | null
}

export interface TxFormInitial {
  kind: TxKind
  amount: string
  label: string
  date: string
  accountId: string
  categoryId: string
  note: string
}

export function emptyTxForm(accountId: string): TxFormInitial {
  return { kind: 'expense', amount: '', label: '', date: TODAY, accountId, categoryId: '', note: '' }
}

// Prepare l'etat du formulaire a partir d'une transaction existante : le signe
// du montant determine le sens, le montant est affiche en valeur absolue.
export function txFormFrom(tx: {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number
  note?: string
}): TxFormInitial {
  return {
    kind: tx.amount >= 0 ? 'income' : 'expense',
    amount: (Math.abs(tx.amount) / 100).toFixed(2).replace('.', ','),
    label: tx.label,
    date: tx.date,
    accountId: tx.accountId,
    categoryId: tx.categoryId ?? '',
    note: tx.note ?? '',
  }
}

function parseAmount(raw: string): number | null {
  const parsed = Number.parseFloat(raw.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

export function TransactionForm({
  initial,
  submitLabel,
  submittingLabel,
  submitting,
  autoFocusAmount = false,
  keyboardInset = 0,
  onSubmit,
  onCancel,
}: {
  initial: TxFormInitial
  submitLabel: string
  submittingLabel: string
  submitting: boolean
  autoFocusAmount?: boolean
  keyboardInset?: number
  onSubmit: (result: TxFormResult) => void
  onCancel: () => void
}) {
  const accounts = useAccountsList()
  const categories = useCategoriesList()
  const groups = useGroupsList()

  const [kind, setKind] = useState<TxKind>(initial.kind)
  const [amount, setAmount] = useState(initial.amount)
  const [label, setLabel] = useState(initial.label)
  const [date, setDate] = useState(initial.date)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [categoryId, setCategoryId] = useState<string>(initial.categoryId)
  const [note, setNote] = useState(initial.note)
  const [error, setError] = useState<string | null>(null)

  // Filet : selectionne le premier compte si aucun n'est defini (taxonomie
  // pas encore chargee a l'ouverture).
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
  }, [accountId, accounts])

  const submit = () => {
    const cents = parseAmount(amount)
    if (!cents) {
      setError('Saisissez un montant valide, par exemple 12,50.')
      return
    }
    if (!label.trim()) {
      setError('Le libellé est obligatoire.')
      return
    }
    if (!date || date < MIN_DATE || date > TODAY) {
      setError("La date doit être comprise entre février 2026 et aujourd'hui.")
      return
    }
    setError(null)
    onSubmit({
      accountId,
      date,
      label: label.trim(),
      categoryId: categoryId || null,
      amount: kind === 'expense' ? -cents : cents,
      note: note.trim() ? note.trim() : null,
    })
  }

  const wantIncome = kind === 'income'
  const visibleGroups = groups
    .filter((g) => categories.some((c) => c.groupId === g.id && c.isIncome === wantIncome))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-2">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
          {(
            [
              ['expense', 'Dépense'],
              ['income', 'Revenu'],
            ] as const
          ).map(([value, lbl]) => (
            <button
              key={value}
              onClick={() => {
                setKind(value)
                setCategoryId('')
              }}
              className={cn(
                'h-9 rounded-lg text-[14px] font-medium transition-colors',
                kind === value ? 'bg-surface text-ink shadow-sm' : 'text-soft hover:text-ink',
              )}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div>
          <label className="label-caps mb-1.5 block">Montant</label>
          <div className="relative">
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              autoFocus={autoFocusAmount}
              className={cn('pr-8 text-right text-[17px] font-semibold tnum', kind === 'income' && 'text-success')}
            />
            <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-soft">
              €
            </span>
          </div>
        </div>

        <div>
          <label className="label-caps mb-1.5 block">Libellé</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === 'expense' ? 'Boulangerie Maison Landemaine' : 'Virement reçu'}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-caps mb-1.5 block">Date</label>
            <Input
              type="date"
              value={date}
              min={MIN_DATE}
              max={TODAY}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label-caps mb-1.5 block">Compte</label>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <label className="label-caps mb-1.5 block">Catégorie</label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">À catégoriser</option>
            {visibleGroups.map((group) => (
              <optgroup key={group.id} label={group.name}>
                {categories
                  .filter((c) => c.groupId === group.id && c.isIncome === wantIncome)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <div>
          <label className="label-caps mb-1.5 block">Note</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optionnel"
            rows={2}
            maxLength={500}
            className="flex w-full resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[16px] text-ink placeholder:text-soft/70 transition-colors focus:border-accent/60 lg:text-[14px]"
          />
        </div>

        {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
      </div>

      <div
        className="flex gap-3 border-t border-line p-5"
        style={keyboardInset ? { paddingBottom: keyboardInset + 20 } : undefined}
      >
        <Button variant="secondary" className="flex-1" onClick={onCancel}>
          Annuler
        </Button>
        <Button className="flex-1" onClick={submit} disabled={submitting}>
          {submitting ? submittingLabel : submitLabel}
        </Button>
      </div>
    </>
  )
}
