import { CreditCard, Sprout, TrendingUp, Wallet } from 'lucide-react'
import type { Account } from '@/types/domain'
import { cn } from '@/lib/utils'

// Pastille de compte : distingue d'un coup d'oeil les transactions de la carte
// a debit differe (violet) de celles des autres comptes (neutre).
const ACCOUNT_CHIP_META: Record<Account['kind'], { icon: typeof Wallet; card: boolean }> = {
  checking: { icon: Wallet, card: false },
  savings: { icon: Sprout, card: false },
  investment: { icon: TrendingUp, card: false },
  card_deferred: { icon: CreditCard, card: true },
}

export function AccountChip({ account }: { account: Account }) {
  const meta = ACCOUNT_CHIP_META[account.kind] ?? ACCOUNT_CHIP_META.checking
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        !meta.card && 'bg-surface2 text-soft',
      )}
      style={
        meta.card
          ? { backgroundColor: 'var(--cat-purple-bg)', color: 'var(--cat-purple-fg)' }
          : undefined
      }
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{account.name}</span>
    </span>
  )
}
