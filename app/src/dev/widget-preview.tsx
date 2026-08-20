// Harnais DEV uniquement : rend IncomeExpenseWidget avec des donnees factices
// pour la verification visuelle (light/dark via ?mode=dark, mobile/desktop via
// la taille de fenetre). Jamais reference par l'app ; exclu du build de prod.
import { createRoot } from 'react-dom/client'
import { IncomeExpenseWidget } from '@/components/reports/IncomeExpenseWidget'
import { useUiStore } from '@/stores/ui'
import type { MonthPoint } from '@/lib/analytics'
import '@/styles/globals.css'

const params = new URLSearchParams(location.search)
const dark = params.get('mode') === 'dark'
const months = Number(params.get('months') ?? '12')

useUiStore.setState({ theme: 'nuit', mode: dark ? 'dark' : 'light' })
document.documentElement.dataset.theme = 'nuit'
document.documentElement.classList.toggle('dark', dark)

const mk = (month: string, income: number, spending: number): MonthPoint => ({
  month,
  income,
  spending,
  net: income - spending,
})

const monthly: MonthPoint[] = [
  mk('2025-08', 312000, 268050),
  mk('2025-09', 312000, 301120),
  mk('2025-10', 318500, 244890),
  mk('2025-11', 312000, 329400),
  mk('2025-12', 402000, 371230),
  mk('2026-01', 312000, 254610),
  mk('2026-02', 312000, 288740),
  mk('2026-03', 315200, 262380),
  mk('2026-04', 312000, 296520),
  mk('2026-05', 312000, 241060),
  mk('2026-06', 328000, 305910),
  mk('2026-07', 312000, 226480),
]

createRoot(document.getElementById('root')!).render(
  <div className="min-h-dvh bg-bg p-4">
    <div className="mx-auto max-w-3xl">
      <IncomeExpenseWidget monthly={monthly} months={months} />
    </div>
  </div>,
)
