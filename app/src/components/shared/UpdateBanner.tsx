import { RefreshCw } from 'lucide-react'
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
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3">
      <p className="text-[13.5px] font-medium text-ink">Une nouvelle version de l'app est disponible.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[13px] font-semibold text-accentfg transition-transform active:scale-95"
      >
        <RefreshCw className="h-4 w-4" />
        Recharger
      </button>
    </div>
  )
}
