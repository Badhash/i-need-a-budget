import { RefreshCw, Sparkles } from 'lucide-react'
import { useUiStore } from '@/stores/ui'

/**
 * Nouvelle version deployee alors que cette page tourne encore sur l'ancien
 * bundle (service worker mis a jour, cf. main.tsx). On propose de recharger
 * plutot que de le faire d'autorite : aucune saisie en cours n'est perdue.
 */
export function UpdateBanner() {
  const available = useUiStore((s) => s.updateAvailable)
  if (!available) return null
  return (
    <div className="mb-5 flex animate-fade-up items-center gap-3 rounded-2xl border border-accent/25 bg-accent/10 py-2.5 pl-3 pr-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
        <Sparkles className="h-[18px] w-[18px]" />
      </span>
      <p className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-ink">
        Une nouvelle version de l'app est disponible.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-accentfg shadow-button transition-transform duration-150 ease-spring active:scale-95"
      >
        <RefreshCw className="h-4 w-4" />
        Recharger
      </button>
    </div>
  )
}
