import { Wallet } from 'lucide-react'

/**
 * Ecran de chargement plein ecran affiche au lancement, le temps que les
 * donnees de fond (comptes, budget du mois, transactions) soient pretes. Mini
 * animation "respiration" du logo + points rebondissants, coupee si l'OS
 * demande la reduction des animations. Themable (clair/sombre).
 */
export function AppLoader({ message = 'Chargement de ton budget…' }: { message?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-7 bg-bg px-6">
      <div className="relative flex items-center justify-center">
        <span className="loader-glow absolute h-20 w-20 rounded-[1.4rem] bg-accent/30 blur-xl" />
        <span className="loader-badge relative flex h-20 w-20 items-center justify-center rounded-[1.4rem] bg-accent text-white shadow-lg">
          <Wallet className="h-9 w-9" />
        </span>
      </div>

      <div className="flex flex-col items-center gap-3.5">
        <p className="text-[15px] font-semibold tracking-tight text-ink">I Need A Budget</p>
        <div className="flex items-center gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="loader-dot h-2 w-2 rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
        <p className="text-[13px] text-soft">{message}</p>
      </div>
    </div>
  )
}
