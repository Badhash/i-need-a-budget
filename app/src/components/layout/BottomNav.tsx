import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { NAV_ITEMS } from '@/components/layout/nav'
import { useTransactions } from '@/lib/queries'
import { uncategorizedCount } from '@/lib/data'
import { useUiStore } from '@/stores/ui'

// Barre de navigation flottante facon iOS : pilule arrondie, verre depoli, posee
// au-dessus de l'indicateur home (safe-area). Les gouttieres laterales laissent
// passer les taps (pointer-events-none sur le conteneur, auto sur la barre).
export function BottomNav() {
  const { data: txs } = useTransactions()
  const badge = txs ? uncategorizedCount(txs) : 0

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
      <nav className="pointer-events-auto flex w-full max-w-md items-stretch gap-1 rounded-[26px] border border-line/70 bg-surface/85 p-1.5 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 rounded-[20px] text-soft transition-colors duration-200 data-[status=active]:bg-accent/12 data-[status=active]:text-accent"
          >
            <span className="relative">
              <Icon className="h-[22px] w-[22px]" strokeWidth={2.1} />
              {to === '/transactions' && badge > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-white dark:text-bg tnum">
                  {badge}
                </span>
              )}
            </span>
            <span className="text-[10.5px] font-semibold leading-none">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

export function Fab() {
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  return (
    <button
      onClick={() => setAddTxOpen(true)}
      aria-label="Ajouter une transaction"
      className="fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accentfg shadow-fab transition-transform active:scale-95 lg:hidden"
    >
      <Plus className="h-6 w-6" />
    </button>
  )
}
