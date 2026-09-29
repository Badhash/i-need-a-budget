import { useEffect, useState } from 'react'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { CloudOff, RefreshCw } from 'lucide-react'
import { useCheckingConnectivity, useOnline } from '@/lib/connectivity'
import {
  formatSyncAge,
  isTrackedQuery,
  refreshData,
  useLastServerSync,
  useRefreshStore,
} from '@/lib/freshness'
import { cn } from '@/lib/utils'

// Delai avant d'afficher « Synchronisation… » pour un rechargement de fond
// (reconciliation Realtime) : les rechargements eclair restent invisibles
// (reconciliation silencieuse) ; affiche, l'etat tient un minimum pour ne pas
// clignoter.
const SYNC_SHOW_DELAY_MS = 450
const SYNC_MIN_VISIBLE_MS = 700
// Pastille verte tant que les donnees ont moins de 5 minutes.
const RECENT_MS = 5 * 60 * 1000

type FreshnessState = 'offline' | 'syncing' | 'fresh' | 'stale' | 'unknown'

/** Horloge pour les libelles relatifs (suspendue quand l'onglet est cache). */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let timer = 0
    const tick = () => setNow(Date.now())
    const stop = () => {
      if (timer) window.clearInterval(timer)
      timer = 0
    }
    const start = () => {
      stop()
      timer = window.setInterval(tick, intervalMs)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        tick()
        start()
      } else stop()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
  return now
}

/** Drapeau apaise : vrai apres `showDelay` de vrai continu, tenu au moins `minVisible`. */
function useCalmFlag(value: boolean, showDelay: number, minVisible: number): boolean {
  const [shownAt, setShownAt] = useState<number | null>(null)
  useEffect(() => {
    if (value && shownAt === null) {
      const timer = window.setTimeout(() => setShownAt(Date.now()), showDelay)
      return () => window.clearTimeout(timer)
    }
    if (!value && shownAt !== null) {
      const timer = window.setTimeout(() => setShownAt(null), Math.max(0, shownAt + minVisible - Date.now()))
      return () => window.clearTimeout(timer)
    }
  }, [value, shownAt, showDelay, minVisible])
  return shownAt !== null
}

/** Heure (ou jour et heure au-dela de 24 h) du dernier chargement, pour l'infobulle. */
function fmtSyncMoment(at: number, now: number): string {
  const date = new Date(at)
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (now - at < 24 * 60 * 60 * 1000) return time
  return `${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`
}

function useFreshness(): { state: FreshnessState; label: string; recent: boolean; moment: string | null } {
  const online = useOnline()
  const checking = useCheckingConnectivity()
  const refreshing = useRefreshStore((s) => s.refreshing)
  const fetching =
    useIsFetching({ predicate: (query) => isTrackedQuery(query) && query.getObserversCount() > 0 }) > 0
  const backgroundSync = useCalmFlag(fetching, SYNC_SHOW_DELAY_MS, SYNC_MIN_VISIBLE_MS)
  const syncAt = useLastServerSync()
  const now = useNow(15000)

  const moment = syncAt === null ? null : fmtSyncMoment(syncAt, Math.max(now, syncAt))
  if (!online) return { state: 'offline', label: checking ? 'Vérification…' : 'Hors ligne', recent: false, moment }
  if (refreshing || backgroundSync) return { state: 'syncing', label: 'Synchronisation…', recent: false, moment }
  if (syncAt === null) return { state: 'unknown', label: 'Actualiser', recent: false, moment }
  // syncAt peut depasser la derniere graduation de l'horloge (chargement tout juste termine).
  const age = Math.max(0, Math.max(now, syncAt) - syncAt)
  return { state: age < 60000 ? 'fresh' : 'stale', label: formatSyncAge(age), recent: age < RECENT_MS, moment }
}

function StatusGlyph({ state, recent, size }: { state: FreshnessState; recent: boolean; size: 'sm' | 'md' }) {
  const icon = size === 'md' ? 'h-[18px] w-[18px]' : 'h-4 w-4'
  if (state === 'offline') return <CloudOff className={cn(icon, 'text-warning')} strokeWidth={2.2} />
  if (state === 'syncing') {
    return (
      <RefreshCw className={cn(icon, 'animate-spin text-accent-ink [animation-duration:1.1s]')} strokeWidth={2.2} />
    )
  }
  // Au repos : icone d'actualisation et pastille d'etat en exposant (verte si
  // recent). Au survol, l'icone pivote d'un quart : invitation a cliquer.
  return (
    <span className="relative inline-flex">
      <RefreshCw
        className={cn(icon, 'transition-transform duration-280 ease-spring group-hover:rotate-90')}
        strokeWidth={2.2}
      />
      {/* Petit rebond de la pastille verte quand une synchronisation aboutit. */}
      <span
        key={state}
        aria-hidden
        className={cn(
          'absolute -right-0.5 -top-0.5 h-[7px] w-[7px] rounded-full ring-2 ring-bg',
          recent ? 'bg-success' : 'bg-soft/50',
          state === 'fresh' && 'animate-pop',
        )}
      />
    </span>
  )
}

/**
 * Indicateur de fraicheur des donnees, dans le header (mobile et desktop) :
 * « À jour », « Mis à jour il y a 3 min », « Synchronisation… », « Hors
 * ligne ». Un appui actualise les donnees a l'ecran (invalidations scopees,
 * cf. lib/freshness) ; hors ligne, il relance la verification de connexion.
 *
 * `compact` : icone seule en desktop (pages avec selecteur de mois, ou la
 * place manque) ; le libelle passe en infobulle et en libelle accessible. Sur
 * mobile, toujours une icone (le geste « tirer pour rafraichir » fait la meme
 * chose).
 */
export function FreshnessIndicator({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient()
  const { state, label, recent, moment } = useFreshness()
  const busy = state === 'syncing'
  const onClick = () => void refreshData(queryClient)
  const title =
    state === 'offline'
      ? `${label} · toucher pour vérifier la connexion`
      : state === 'syncing'
        ? label
        : `${label}${moment ? ` (dernière synchronisation : ${moment})` : ''} · Actualiser`

  return (
    <>
      {/* Mobile : bouton rond 44px du chrome. */}
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        aria-busy={busy || undefined}
        className={cn(
          'group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring hover:bg-ink/[0.06] hover:text-ink active:scale-90 lg:hidden',
          state === 'offline' && 'bg-warning/10 ring-1 ring-inset ring-warning/20',
        )}
      >
        <StatusGlyph state={state} recent={recent} size="md" />
      </button>

      {/* Desktop : pastille avec libelle, ou icone seule si compact. */}
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-busy={busy || undefined}
        className={cn(
          'group hidden h-10 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-soft transition-[background-color,color,transform] duration-150 ease-spring hover:bg-ink/[0.06] hover:text-ink active:scale-95 lg:inline-flex',
          compact ? 'w-10' : 'gap-2 pl-3 pr-3.5',
          // Hors ligne : seul signal permanent de l'etat (la pastille flottante
          // n'apparait qu'avec des modifications en attente), donc teinte.
          state === 'offline' && 'bg-warning/10 text-ink ring-1 ring-inset ring-warning/20 hover:bg-warning/15',
        )}
      >
        <StatusGlyph state={state} recent={recent} size="sm" />
        {!compact && (
          <span key={state} className="animate-fade-in whitespace-nowrap tnum">
            {label}
          </span>
        )}
      </button>
    </>
  )
}
