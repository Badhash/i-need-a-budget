import { useCallback, useMemo, useState } from 'react'
import { Archive, ChevronDown, Landmark, Plus } from 'lucide-react'
import { latestAccountId, useSetAccountFlags } from '@/lib/accounts'
import type { AccountStats } from '@/lib/accounts'
import { useAccounts, useServerFeatures, type AccountWithBalance } from '@/lib/data'
import { useBankConnections } from '@/lib/bank'
import { toast } from '@/lib/toast'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { EmptyState } from '@/components/shared/EmptyState'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AccountRow,
  AccountTile,
  ClosedAccountRow,
  type AccountActions,
  type LinkStatus,
} from '@/components/accounts/AccountCard'
import { AccountSheet, type SheetTarget } from '@/components/accounts/AccountSheet'
import { quoted } from '@/components/accounts/accountKinds'
import { AddAccountDialog } from '@/components/accounts/AddAccountDialog'
import { NetWorthHero } from '@/components/accounts/NetWorthHero'
import { SyncStrip } from '@/components/accounts/SyncStrip'
import { useAccountStats } from '@/components/accounts/useAccountStats'
import { cn } from '@/lib/utils'

function AccountsSkeleton() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-[188px] rounded-3xl lg:h-[164px]" />
      <div className="space-y-3.5">
        <Skeleton className="h-6 w-44" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-2xl lg:h-[164px]" />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Tuile d'ajout en pointilles, en fin de liste de chaque section. */
function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-2xl border border-dashed border-line px-4 text-[14px] font-medium text-soft transition-[border-color,background-color,color,transform] duration-150 ease-spring hover:border-accent/50 hover:bg-accent/[0.04] hover:text-accent-ink active:scale-[0.99] lg:min-h-[72px]"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface2 transition-colors group-hover:bg-accent/10">
        <Plus className="h-4 w-4" />
      </span>
      {label}
    </button>
  )
}

interface SectionProps {
  title: string
  description: string
  accounts: AccountWithBalance[]
  addLabel: string
  onAdd: () => void
  desktop: boolean
  stats: Map<string, AccountStats> | null
  linkOf: (id: string) => LinkStatus | undefined
  flags: boolean
  actions: AccountActions
}

function AccountSection({
  title,
  description,
  accounts,
  addLabel,
  onAdd,
  desktop,
  stats,
  linkOf,
  flags,
  actions,
}: SectionProps) {
  return (
    <section className="space-y-3.5">
      <SectionHeader title={title} description={description} />
      <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
        {accounts.map((account) =>
          desktop ? (
            <AccountTile
              key={account.id}
              account={account}
              stats={stats?.get(account.id)}
              link={linkOf(account.id)}
              flags={flags}
              actions={actions}
            />
          ) : (
            <AccountRow
              key={account.id}
              account={account}
              stats={stats?.get(account.id)}
              link={linkOf(account.id)}
              flags={flags}
              actions={actions}
            />
          ),
        )}
        <AddTile label={addLabel} onClick={onAdd} />
      </div>
    </section>
  )
}

function ClosedSection({
  accounts,
  desktop,
  flags,
  actions,
}: {
  accounts: AccountWithBalance[]
  desktop: boolean
  flags: boolean
  actions: AccountActions
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-1 text-left text-soft transition-colors hover:text-ink"
      >
        <Archive className="h-4 w-4 shrink-0" />
        <span className="text-[15px] font-semibold tracking-tight">Comptes clôturés</span>
        <span className="rounded-full bg-surface2 px-2 py-px text-[12px] font-semibold tnum ring-1 ring-inset ring-line/60">
          {accounts.length}
        </span>
        <ChevronDown
          className={cn('ml-auto h-4 w-4 transition-transform duration-200 ease-spring', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="animate-fade-up divide-y divide-line/60 overflow-hidden rounded-2xl border border-edge bg-surface shadow-card">
          {accounts.map((account) => (
            <ClosedAccountRow key={account.id} account={account} desktop={desktop} flags={flags} actions={actions} />
          ))}
        </div>
      )}
    </section>
  )
}

const sum = (accounts: AccountWithBalance[]) => accounts.reduce((s, a) => s + a.balance, 0)

export function AccountsPage() {
  const { data: accounts } = useAccounts()
  const { data: connections } = useBankConnections()
  // Serveur recent seulement : bascule budget/suivi, cloture et reouverture.
  const flags = useServerFeatures().has('accountFlags')
  const desktop = useIsDesktop()
  const stats = useAccountStats(accounts)
  const { mutate: mutateFlags } = useSetAccountFlags()
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [adding, setAdding] = useState<boolean | null>(null)
  // Derniere section d'ajout : garde le formulaire stable pendant la fermeture.
  const [addOnBudget, setAddOnBudget] = useState(true)

  // Statut de synchronisation des comptes lies a une banque (Enable Banking).
  const links = useMemo(() => {
    const map = new Map<string, LinkStatus>()
    for (const connection of connections ?? []) {
      for (const eb of connection.accounts) if (eb.linkedAccountId) map.set(eb.linkedAccountId, connection.status)
    }
    return map
  }, [connections])
  const linkOf = useCallback((id: string) => links.get(id), [links])

  const actions = useMemo<AccountActions>(
    () => ({
      open: (account, view) => setSheet({ accountId: account.id, view }),
      close: (account) => {
        // Cloture reservee aux soldes EXACTEMENT nuls : sinon, la feuille
        // explique comment y arriver (ajuster a 0 ou virer le reste).
        if (account.balance !== 0) {
          setSheet({ accountId: account.id, view: 'close' })
          return
        }
        mutateFlags({ accountId: account.id, closed: true })
        toast({
          message: `${quoted(account.name)} clôturé`,
          description: 'Rangé dans les comptes clôturés.',
          tone: 'success',
          action: {
            label: 'Annuler',
            onClick: () => mutateFlags({ accountId: latestAccountId(account.id), closed: false }),
          },
        })
      },
      reopen: (account) => {
        mutateFlags({ accountId: account.id, closed: false })
        toast({ message: `${quoted(account.name)} rouvert`, tone: 'success' })
      },
    }),
    [mutateFlags],
  )

  const closeSheet = useCallback(() => setSheet(null), [])
  const openAdd = (onBudget: boolean) => {
    setAddOnBudget(onBudget)
    setAdding(onBudget)
  }

  if (!accounts) return <AccountsSkeleton />

  const active = accounts.filter((a) => !a.closed)
  const budget = active.filter((a) => a.onBudget)
  const tracking = active.filter((a) => !a.onBudget)
  const closed = accounts.filter((a) => a.closed)
  const monthChange = stats ? accounts.reduce((s, a) => s + (stats.get(a.id)?.monthChange ?? 0), 0) : null
  const sectionProps = { desktop, stats, linkOf, flags, actions }

  return (
    <div className="space-y-8 lg:space-y-10">
      <NetWorthHero
        budgetTotal={sum(accounts.filter((a) => a.onBudget))}
        trackingTotal={sum(accounts.filter((a) => !a.onBudget))}
        budgetCount={budget.length}
        trackingCount={tracking.length}
        monthChange={monthChange}
      />

      {connections && connections.length > 0 && <SyncStrip connections={connections} />}

      {active.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Aucun compte actif"
          description="Ajoutez un compte pour suivre son solde et alimenter le budget."
          actionLabel="Ajouter un compte"
          onAction={() => openAdd(true)}
        />
      ) : (
        <>
          <AccountSection
            title="Comptes budget"
            description="Leur argent se répartit dans les enveloppes."
            accounts={budget}
            addLabel="Ajouter un compte"
            onAdd={() => openAdd(true)}
            {...sectionProps}
          />
          <AccountSection
            title="Suivi"
            description="Placements et épargne longue, hors budget."
            accounts={tracking}
            addLabel="Ajouter un compte de suivi"
            onAdd={() => openAdd(false)}
            {...sectionProps}
          />
        </>
      )}

      {closed.length > 0 && <ClosedSection accounts={closed} desktop={desktop} flags={flags} actions={actions} />}

      <AccountSheet target={sheet} onClose={closeSheet} stats={stats} linkOf={linkOf} flags={flags} actions={actions} />
      <AddAccountDialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        defaultOnBudget={adding ?? addOnBudget}
      />
    </div>
  )
}
