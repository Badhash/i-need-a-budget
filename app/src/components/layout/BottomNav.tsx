import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { NAV_ITEMS } from '@/components/layout/nav'
import { useTransactions } from '@/lib/queries'
import { uncategorizedCount } from '@/mocks/api'
import { useUiStore } from '@/stores/ui'

export function BottomNav() {
  const { data: txs } = useTransactions()
  const badge = txs ? uncategorizedCount(txs) : 0

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur-md lg:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-4">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="relative flex min-h-[44px] flex-col items-center justify-center gap-1 text-soft transition-colors data-[status=active]:text-accent"
          >
            <span className="relative">
              <Icon className="h-[22px] w-[22px]" />
              {to === '/transactions' && badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-white dark:text-bg tnum">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-[10.5px] font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}

export function Fab() {
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  return (
    <button
      onClick={() => setAddTxOpen(true)}
      aria-label="Ajouter une transaction"
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accentfg shadow-fab transition-transform active:scale-95 lg:hidden"
    >
      <Plus className="h-6 w-6" />
    </button>
  )
}
