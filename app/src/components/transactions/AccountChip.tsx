import { CreditCard, Sprout, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import type { Account } from '@/types/domain'
import { cn } from '@/lib/utils'

// Icone par type de compte : la carte a debit differe garde sa teinte violette
// (on distingue d'un coup d'oeil ses depenses de celles du compte courant).
const ACCOUNT_META: Record<Account['kind'], { icon: LucideIcon; card: boolean }> = {
  checking: { icon: Wallet, card: false },
  savings: { icon: Sprout, card: false },
  investment: { icon: TrendingUp, card: false },
  card_deferred: { icon: CreditCard, card: true },
}

export function accountIcon(account: Pick<Account, 'kind'>): LucideIcon {
  return (ACCOUNT_META[account.kind] ?? ACCOUNT_META.checking).icon
}

/**
 * Compte d'une ligne : icone + nom, discret (texte attenue). `peer` : autre
 * compte d'un virement categorisable (« Compte courant → PEA »).
 */
export function AccountLabel({
  account,
  peer,
  outgoing = true,
  className,
}: {
  account: Account
  peer?: Account | null
  outgoing?: boolean
  className?: string
}) {
  const meta = ACCOUNT_META[account.kind] ?? ACCOUNT_META.checking
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1 text-[12px] leading-none text-soft', className)}>
      <Icon
        className="h-3 w-3 shrink-0"
        style={meta.card ? { color: 'var(--cat-purple-fg)' } : undefined}
        strokeWidth={2.2}
      />
      <span className="truncate">
        {account.name}
        {peer && (
          <>
            {outgoing ? ' → ' : ' ← '}
            {peer.name}
          </>
        )}
      </span>
    </span>
  )
}

/** Pastille de compte (feuille de detail, filtres). */
export function AccountChip({ account, className }: { account: Account; className?: string }) {
  const meta = ACCOUNT_META[account.kind] ?? ACCOUNT_META.checking
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
        !meta.card && 'bg-ink/[0.05] text-soft ring-1 ring-inset ring-ink/[0.06]',
        className,
      )}
      style={meta.card ? { backgroundColor: 'var(--cat-purple-bg)', color: 'var(--cat-purple-fg)' } : undefined}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{account.name}</span>
    </span>
  )
}
