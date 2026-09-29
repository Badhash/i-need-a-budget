import { useEffect, useRef, useState } from 'react'
import { useMutationState } from '@tanstack/react-query'
import { CloudOff, RefreshCw } from 'lucide-react'
import { checkConnectivity, useCheckingConnectivity, useOnline } from '@/lib/connectivity'
import { mutationSettledCounts } from '@/lib/mutationFeedback'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

// Duree de l'animation de sortie (animate-scale-out).
const EXIT_MS = 160

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

/**
 * Pastille d'etat reseau, flottante sous le header (mobile et desktop) :
 *   - hors ligne avec des modifications en attente : « Hors ligne · 2
 *     modifications en attente ». Les mutations sont en pause (TanStack) ou
 *     retenues par la file ; leur etat optimiste reste affiche. Un appui
 *     relance tout de suite la verification de connexion ;
 *   - retour du reseau : « Envoi de 2 modifications… » le temps de la reprise,
 *     puis un toast bref « Modifications synchronisées » si tout est passe
 *     (un echec a deja son propre toast avec « Réessayer »).
 * Rien n'est persiste : quitter la page avec des modifications en attente les
 * perdrait, d'ou l'avertissement de fermeture tant que la pastille est la.
 */
export function NetworkStatusPill() {
  const online = useOnline()
  const checking = useCheckingConnectivity()
  // Mutations non terminees : en pause hors ligne, retenues par la file, ou en vol.
  const pending = useMutationState({ filters: { status: 'pending' }, select: (m) => m.mutationId }).length
  const [backlog, setBacklog] = useState(false)
  const baseline = useRef<{ ok: number; failed: number } | null>(null)

  // Coupure avec des modifications en attente : debut d'un arriere a envoyer.
  useEffect(() => {
    if (online || pending === 0 || backlog) return
    baseline.current = mutationSettledCounts()
    setBacklog(true)
  }, [online, pending, backlog])

  // Reseau revenu et plus rien en attente : arriere envoye.
  useEffect(() => {
    if (!backlog || !online || pending > 0) return
    const start = baseline.current
    const now = mutationSettledCounts()
    baseline.current = null
    setBacklog(false)
    if (start && now.failed === start.failed && now.ok > start.ok) {
      toast({ id: 'sync-done', tone: 'success', message: 'Modifications synchronisées', duration: 2600 })
    }
  }, [backlog, online, pending])

  // Hors ligne sans rien en attente : l'indicateur de fraicheur du header le
  // dit deja (nuage barre) ; la pastille n'apparait que s'il y a des
  // modifications a proteger, puis le temps de leur envoi.
  const visible = pending > 0 && (!online || backlog)

  // Fermer ou recharger l'onglet perdrait les modifications retenues.
  useEffect(() => {
    if (!visible || pending === 0) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [visible, pending])

  // Montee / sortie animees : la pastille reste montee le temps de sa sortie.
  const [mounted, setMounted] = useState(visible)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (visible) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [visible, mounted])

  // Dernier libelle affiche, fige pendant la sortie (pas de texte qui change en partant).
  const syncing = online
  const label = syncing ? `Envoi de ${plural(pending, 'modification')}…` : 'Hors ligne'
  const detail = syncing ? null : `${plural(pending, 'modification')} en attente`
  const frozen = useRef({ label, detail, syncing })
  if (visible) frozen.current = { label, detail, syncing }
  const shown = frozen.current

  if (!mounted) return null

  const ariaLabel = shown.syncing
    ? shown.label
    : `${shown.label}${shown.detail ? `, ${shown.detail}` : ''}. Toucher pour vérifier la connexion.`

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-[35] flex justify-center px-4 lg:left-64 lg:top-[5.25rem]"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => {
          if (!online) void checkConnectivity()
        }}
        disabled={shown.syncing}
        aria-label={ariaLabel}
        className={cn(
          'glass pointer-events-auto relative flex h-10 max-w-full items-center gap-2.5 rounded-full border border-edge py-1 pl-1.5 pr-4 text-left shadow-elevated transition-transform duration-150 ease-spring active:scale-[0.97] disabled:active:scale-100',
          "after:absolute after:-inset-1 after:content-['']",
          leaving ? 'animate-scale-out' : 'animate-scale-in',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            shown.syncing ? 'bg-accent/15 text-accent-ink' : 'bg-warning/15 text-warning',
          )}
        >
          {/* Onde lente autour de l'icone pendant une verification. */}
          {checking && !shown.syncing && (
            <span className="absolute inset-0 animate-ping rounded-full bg-warning/25 motion-reduce:hidden" />
          )}
          {shown.syncing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin [animation-duration:1.1s]" strokeWidth={2.4} />
          ) : (
            <CloudOff className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
        </span>
        <span className="min-w-0 truncate text-[13.5px] leading-none">
          <span className="font-semibold text-ink">{shown.label}</span>
          {shown.detail && (
            <>
              <span aria-hidden className="px-1.5 text-soft">
                ·
              </span>
              <span className="font-medium text-soft tnum">{shown.detail}</span>
            </>
          )}
        </span>
      </button>
    </div>
  )
}
