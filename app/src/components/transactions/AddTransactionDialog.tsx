import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiAddTransaction, useAccountsList, useCategoriesList, useGroupsList } from '@/lib/data'
import { MIN_MONTH, TODAY } from '@/lib/format'

const MIN_DATE = `${MIN_MONTH}-01`
import { useUiStore } from '@/stores/ui'
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

function parseAmount(raw: string): number | null {
  const parsed = Number.parseFloat(raw.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100)
}

type TxKind = 'expense' | 'income'

export function AddTransactionDialog() {
  const open = useUiStore((s) => s.addTxOpen)
  const setOpen = useUiStore((s) => s.setAddTxOpen)
  const queryClient = useQueryClient()
  const accounts = useAccountsList()
  const categories = useCategoriesList()
  const groups = useGroupsList()

  const [kind, setKind] = useState<TxKind>('expense')
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(TODAY)
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  // Selectionne le premier compte des que la taxonomie est chargee.
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id)
  }, [accountId, accounts])

  const reset = () => {
    setKind('expense')
    setAmount('')
    setLabel('')
    setDate(TODAY)
    setAccountId(accounts[0]?.id ?? '')
    setCategoryId('')
    setError(null)
  }

  const mutation = useMutation({
    mutationFn: apiAddTransaction,
    onSuccess: () => {
      queryClient.invalidateQueries()
      setOpen(false)
      reset()
    },
  })

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
    mutation.mutate({
      accountId,
      date,
      label: label.trim(),
      categoryId: categoryId || null,
      amount: kind === 'expense' ? -cents : cents,
    })
  }

  const wantIncome = kind === 'income'
  const visibleGroups = groups
    .filter((g) => categories.some((c) => c.groupId === g.id && c.isIncome === wantIncome))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : (setOpen(false), reset()))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une transaction</DialogTitle>
          <DialogDescription>Saisie manuelle, en attendant la synchronisation bancaire.</DialogDescription>
        </DialogHeader>

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
                autoFocus
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

          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-line p-5">
          <Button variant="secondary" className="flex-1" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button className="flex-1" onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Ajout…' : 'Ajouter'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
