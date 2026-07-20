import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CreditCard, Landmark, Pencil, Plus, Sprout, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import type { AccountKind } from '@/types/domain'
import {
  apiAddTransaction,
  apiCreateAccount,
  apiDeleteAccount,
  apiUpdateAccount,
  useAccounts,
  type AccountWithBalance,
} from '@/lib/data'
import { TODAY, fmtEUR } from '@/lib/format'
import { useBankConnections } from '@/lib/bank'
import { SyncHealth } from '@/components/settings/SyncHealth'
import { Amount } from '@/components/shared/Amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

const KIND_META: Record<AccountKind, { icon: LucideIcon; label: string }> = {
  checking: { icon: Wallet, label: 'Compte courant' },
  savings: { icon: Sprout, label: 'Épargne' },
  investment: { icon: TrendingUp, label: 'Investissement' },
  card_deferred: { icon: CreditCard, label: 'Carte à débit différé' },
}

function AccountCard({
  account,
  onEdit,
}: {
  account: AccountWithBalance
  onEdit: (account: AccountWithBalance) => void
}) {
  const meta = KIND_META[account.kind]
  const Icon = meta.icon
  return (
    // Bouton Modifier integre dans la carte (pas d'imbrication de zones
    // cliquables) : le Link couvre la zone icone + libelle + montant, le crayon
    // reste un bouton distinct a droite.
    <Card className="flex items-center gap-2 p-5">
      <Link
        to="/transactions"
        search={{ compte: account.id }}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-xl transition-opacity hover:opacity-80"
        aria-label={`Voir les transactions de ${account.name}`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{account.name}</p>
            {!account.onBudget && <Badge variant="neutral">Hors budget</Badge>}
          </div>
          <p className="text-[12.5px] text-soft">
            {account.institution} · {meta.label}
          </p>
        </div>
        <Amount cents={account.balance} className="shrink-0 text-[18px] font-semibold" colored={account.balance < 0} />
      </Link>
      <button
        type="button"
        onClick={() => onEdit(account)}
        aria-label={`Modifier ${account.name}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-soft transition-colors hover:bg-surface2 hover:text-ink"
      >
        <Pencil className="h-4 w-4" />
      </button>
    </Card>
  )
}

/** Dialog d'edition d'un compte : nom, etablissement, type (le flag budget et le
 * solde d'ouverture ne se modifient pas ici, ils impacteraient le RTA). */
function EditAccountDialog({
  account,
  onOpenChange,
}: {
  account: AccountWithBalance | null
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [error, setError] = useState<string | null>(null)
  const [targetBalance, setTargetBalance] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (account) {
      setName(account.name)
      setInstitution(account.institution)
      setKind(account.kind)
      setError(null)
      setTargetBalance('')
      setConfirmDelete(false)
    }
  }, [account])

  const invalidateAll = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['reports'] }),
      queryClient.invalidateQueries({ queryKey: ['budget'] }),
    ])

  const adjust = useMutation({
    mutationFn: async () => {
      if (!account) return
      const cents = parseEuros(targetBalance)
      if (cents === null) throw new Error('invalid')
      const delta = cents - account.balance
      if (delta === 0) return
      await apiAddTransaction({
        accountId: account.id,
        date: TODAY,
        label: 'Ajustement de solde',
        categoryId: null,
        amount: delta,
      })
    },
    onSuccess: async () => {
      await invalidateAll()
      onOpenChange(false)
    },
    onError: () => setError('Saisissez un solde valide, par exemple -1234,56.'),
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!account) return
      await apiDeleteAccount(account.id)
    },
    onSuccess: async () => {
      await invalidateAll()
      onOpenChange(false)
    },
    onError: () => setError('Suppression impossible pour le moment. Réessayez.'),
  })

  const update = useMutation({
    mutationFn: apiUpdateAccount,
    onSuccess: async () => {
      // Les metadonnees du compte vivent dans le bootstrap (taxonomie + soldes).
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      onOpenChange(false)
    },
    onError: () => setError('Modification impossible pour le moment. Réessayez.'),
  })

  const submit = () => {
    if (!account) return
    if (!name.trim() || !institution.trim()) {
      setError('Renseignez le nom du compte et la banque.')
      return
    }
    setError(null)
    update.mutate({ accountId: account.id, name: name.trim(), institution: institution.trim(), kind })
  }

  return (
    <Dialog open={account !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier le compte</DialogTitle>
          <DialogDescription>
            Modifiez le nom, la banque ou le type du compte. Le solde d'ouverture et l'inclusion
            dans le budget ne se changent pas ici.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto p-5 pt-2">
          <div>
            <label className="label-caps mb-1.5 block">Nom du compte</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carte World Elite" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Banque</label>
              <Input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Ma banque"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">Type</label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                <option value="checking">Compte courant</option>
                <option value="savings">Épargne</option>
                <option value="investment">Investissement</option>
                <option value="card_deferred">Carte à débit différé</option>
              </Select>
            </div>
          </div>
          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
          <Button className="w-full" onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>

          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <p className="label-caps">Ajuster le solde</p>
              <p className="mt-1 text-[13px] text-soft">
                Solde actuel : {account ? fmtEUR(account.balance) : ''}. Saisissez le solde réel :
                une transaction « Ajustement de solde » de la différence est créée (à catégoriser).
              </p>
            </div>
            <div className="flex gap-3">
              <Input
                value={targetBalance}
                onChange={(e) => setTargetBalance(e.target.value)}
                placeholder="-350,00"
                inputMode="decimal"
                className="flex-1 text-right tnum"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  if (!targetBalance.trim() || parseEuros(targetBalance) === null) {
                    setError('Saisissez un solde valide, par exemple -1234,56.')
                    return
                  }
                  setError(null)
                  adjust.mutate()
                }}
                disabled={adjust.isPending}
              >
                {adjust.isPending ? 'Ajustement…' : 'Ajuster'}
              </Button>
            </div>
          </div>

          <div className="space-y-3 border-t border-line pt-4">
            <div>
              <p className="label-caps text-danger">Supprimer le compte</p>
              <p className="mt-1 text-[13px] text-soft">
                Supprime définitivement le compte et TOUTES ses transactions. Les virements liés
                sur les autres comptes sont conservés (déliés, à recatégoriser).
              </p>
            </div>
            {!confirmDelete ? (
              <Button variant="secondary" className="w-full text-danger" onClick={() => setConfirmDelete(true)}>
                Supprimer ce compte…
              </Button>
            ) : (
              <div className="flex gap-3">
                <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
                  Annuler
                </Button>
                <Button
                  className="flex-1 bg-danger text-white hover:bg-danger/90"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? 'Suppression…' : 'Confirmer la suppression'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const MIN_DATE = '2026-01-01'

function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed)) return null
  return Math.round(parsed * 100)
}

/** Dialog de creation de compte (hors onboarding) : type carte a debit differe inclus. */
function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [institution, setInstitution] = useState('')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [onBudget, setOnBudget] = useState(true)
  const [balance, setBalance] = useState('')
  const [openingDate, setOpeningDate] = useState(TODAY)
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: apiCreateAccount,
    onSuccess: async () => {
      // Creer un compte (avec son solde d'ouverture) touche la taxonomie et les
      // soldes (bootstrap), la liste des transactions, les agregats (reports) et
      // le budget (RTA si compte on-budget).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
      ])
      setName('')
      setBalance('')
      setError(null)
      onOpenChange(false)
    },
    onError: () => setError('Création impossible pour le moment. Réessayez.'),
  })

  const submit = () => {
    if (!name.trim() || !institution.trim()) {
      setError('Renseignez le nom du compte et la banque.')
      return
    }
    const cents = parseEuros(balance)
    if (cents === null) {
      setError('Saisissez un solde valide, par exemple 1234,56 (négatif autorisé pour une carte).')
      return
    }
    if (openingDate < MIN_DATE || openingDate > TODAY) {
      setError("La date d'ouverture doit être antérieure ou égale à aujourd'hui.")
      return
    }
    setError(null)
    create.mutate({
      name: name.trim(),
      institution: institution.trim(),
      kind,
      onBudget,
      openingBalance: cents,
      openingDate,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un compte</DialogTitle>
          <DialogDescription>
            Saisissez le solde actuel comme solde d'ouverture. Pour une carte à débit différé,
            l'encours non prélevé (souvent négatif).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto p-5 pt-2">
          <div>
            <label className="label-caps mb-1.5 block">Nom du compte</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Carte World Elite" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Banque</label>
              <Input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Ma banque"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">Type</label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                <option value="checking">Compte courant</option>
                <option value="savings">Épargne</option>
                <option value="investment">Investissement</option>
                <option value="card_deferred">Carte à débit différé</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Solde d'ouverture (€)</label>
              <Input
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="text-right tnum"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">Date d'ouverture</label>
              <Input
                type="date"
                value={openingDate}
                min={MIN_DATE}
                max={TODAY}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </div>
          </div>
          <label className="flex min-h-[44px] items-center gap-2.5 text-[14px]">
            <input
              type="checkbox"
              checked={onBudget}
              onChange={(e) => setOnBudget(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Compte inclus dans le budget
          </label>
          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
          <Button className="w-full" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Création…' : 'Créer le compte'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AccountsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-32 rounded-2xl" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[88px] rounded-2xl" />
      ))}
    </div>
  )
}

export function AccountsPage() {
  const { data: accounts } = useAccounts()
  const { data: connections } = useBankConnections()
  const [addOpen, setAddOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<AccountWithBalance | null>(null)

  if (!accounts) return <AccountsSkeleton />

  const hasConnections = (connections?.length ?? 0) > 0

  const total = accounts.reduce((s, a) => s + a.balance, 0)
  const onBudget = accounts.filter((a) => a.onBudget)
  const tracking = accounts.filter((a) => !a.onBudget)
  const onBudgetTotal = onBudget.reduce((s, a) => s + a.balance, 0)
  const trackingTotal = tracking.reduce((s, a) => s + a.balance, 0)

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <p className="label-caps">Valeur nette</p>
        <Amount cents={total} className="mt-1 block text-[30px] font-semibold lg:text-[32px]" />
        <div className="mt-4 flex gap-8 border-t border-line pt-4">
          <div>
            <p className="label-caps flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" />
              Comptes budget
            </p>
            <Amount cents={onBudgetTotal} className="mt-0.5 block text-[16px] font-semibold" />
          </div>
          <div>
            <p className="label-caps flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />
              Hors budget
            </p>
            <Amount cents={trackingTotal} className="mt-0.5 block text-[16px] font-semibold" />
          </div>
        </div>
      </Card>

      {hasConnections && (
        <Card className="p-5">
          <SyncHealth />
        </Card>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Ajouter un compte
        </Button>
      </div>
      <AddAccountDialog open={addOpen} onOpenChange={setAddOpen} />
      <EditAccountDialog account={editAccount} onOpenChange={(o) => !o && setEditAccount(null)} />

      <section className="space-y-3">
        <h2 className="label-caps px-1">Comptes budget</h2>
        <div className="space-y-3">
          {onBudget.map((acc) => (
            <AccountCard key={acc.id} account={acc} onEdit={setEditAccount} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Suivi (hors budget)</h2>
        <div className="space-y-3">
          {tracking.map((acc) => (
            <AccountCard key={acc.id} account={acc} onEdit={setEditAccount} />
          ))}
        </div>
      </section>
    </div>
  )
}
