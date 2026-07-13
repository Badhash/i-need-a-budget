import { CreditCard, Landmark, PiggyBank, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import type { AccountKind } from '@/mocks/data'
import { useAccounts, type AccountWithBalance } from '@/lib/data'
import { Amount } from '@/components/shared/Amount'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const KIND_META: Record<AccountKind, { icon: LucideIcon; label: string }> = {
  checking: { icon: Wallet, label: 'Compte courant' },
  savings: { icon: PiggyBank, label: 'Épargne' },
  investment: { icon: TrendingUp, label: 'Investissement' },
  card_deferred: { icon: CreditCard, label: 'Carte à débit différé' },
}

function AccountCard({ account }: { account: AccountWithBalance }) {
  const meta = KIND_META[account.kind]
  const Icon = meta.icon
  return (
    <Card className="flex items-center gap-4 p-5 transition-transform hover:-translate-y-0.5 hover:shadow-card">
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
      <div className="text-right">
        <Amount cents={account.balance} className="block text-[18px] font-semibold" colored={account.balance < 0} />
        {account.kind === 'checking' && (
          <p className="mt-0.5 text-[11.5px] text-soft">Synchronisé il y a 2 h</p>
        )}
      </div>
    </Card>
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

  if (!accounts) return <AccountsSkeleton />

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

      <section className="space-y-3">
        <h2 className="label-caps px-1">Comptes budget</h2>
        <div className="space-y-3">
          {onBudget.map((acc) => (
            <AccountCard key={acc.id} account={acc} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="label-caps px-1">Suivi (hors budget)</h2>
        <div className="space-y-3">
          {tracking.map((acc) => (
            <AccountCard key={acc.id} account={acc} />
          ))}
        </div>
      </section>
    </div>
  )
}
