import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { NAV_ITEMS, RULES_ITEM, SETTINGS_ITEM } from '@/components/layout/nav'
import { useBudgetMonth, useTransactions } from '@/lib/queries'
import { uncategorizedCount } from '@/lib/data'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function NavLink({ to, label, icon: Icon, badge }: { to: string; label: string; icon: typeof Wallet; badge?: number }) {
  return (
    <Link
      to={to}
      className="group flex h-11 items-center gap-3 rounded-xl px-3.5 text-[14px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink data-[status=active]:bg-accent/10 data-[status=active]:text-accent"
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning tnum">
          {badge}
        </span>
      )}
    </Link>
  )
}

export function Sidebar() {
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  const { data: txs } = useTransactions()
  const badge = txs ? uncategorizedCount(txs) : 0

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accentfg shadow-sm">
          <Wallet className="h-5 w-5" />
        </span>
        <div className="leading-tight">
          <p className="text-[15px] font-semibold">I Need A Budget</p>
          <p className="text-[12px] text-soft">Budget par enveloppes</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            {...item}
            badge={item.to === '/transactions' ? badge : undefined}
          />
        ))}
        <NavLink {...RULES_ITEM} />
        <NavLink {...SETTINGS_ITEM} />
      </nav>

      <div className="mt-auto">
        <div className="rounded-2xl bg-surface2 p-4">
          <p className="label-caps">Prêt à assigner</p>
          {budget ? (
            <Amount
              cents={budget.rta}
              className={cn(
                'mt-1 block text-[22px] font-semibold',
                budget.rta >= 0 ? 'text-success' : 'text-danger',
              )}
            />
          ) : (
            <Skeleton className="mt-2 h-7 w-28" />
          )}
          <p className="mt-1 text-[12px] leading-snug text-soft">
            {budget && budget.rta < 0
              ? 'Vous avez assigné plus que vos revenus.'
              : 'Donnez un rôle à chaque euro.'}
          </p>
        </div>
      </div>
    </aside>
  )
}
