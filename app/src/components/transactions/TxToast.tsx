import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CircleCheck, Trash2, Undo2, X, type LucideIcon } from 'lucide-react'
import { useDialogOpen } from '@/components/ui/dialog'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useToastStore } from '@/lib/toast'
import { cn } from '@/lib/utils'
import {
  expireFeedback,
  installFeedbackFlush,
  undoFeedback,
  useFeedbackStore,
  type FeedbackIcon,
  type FeedbackItem,
} from './feedback'

const ICONS: Record<FeedbackIcon, { icon: LucideIcon; tone: string }> = {
  check: { icon: CircleCheck, tone: 'bg-success/15 text-success' },
  trash: { icon: Trash2, tone: 'bg-ink/[0.07] text-soft' },
  transfer: { icon: ArrowLeftRight, tone: 'bg-accent/10 text-accent-ink dark:text-accent' },
  undo: { icon: Undo2, tone: 'bg-ink/[0.07] text-soft' },
}

// Duree de l'animation de sortie (animate-toast-out).
const EXIT_MS = 180
const GAP_PX = 8

/**
 * Hauteur de la pile de toasts globale (erreurs, confirmations d'autres
 * ecrans) : l'emplacement de la page se pose juste au-dessus, jamais dessous.
 */
function useGlobalStackHeight(): number {
  const count = useToastStore((s) => s.toasts.length)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-toaster=""]')
    if (!el || count === 0) {
      setHeight(0)
      return
    }
    const update = () => setHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [count])
  return height
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function ToastCard({ item, closing }: { item: FeedbackItem; closing: boolean }) {
  // Minuterie d'expiration, suspendue au survol / focus (lecture, clic) ; la
  // barre de progression suit la meme pause.
  const [paused, setPaused] = useState(false)
  const remaining = useRef(item.duration)
  const startedAt = useRef(0)
  const barRef = useRef<HTMLSpanElement>(null)
  const animation = useRef<Animation | null>(null)

  useEffect(() => {
    remaining.current = item.duration
    animation.current?.cancel()
    animation.current = null
    const bar = barRef.current
    if (!bar || prefersReducedMotion() || typeof bar.animate !== 'function') return
    animation.current = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: item.duration,
      easing: 'linear',
      fill: 'forwards',
    })
    return () => animation.current?.cancel()
  }, [item.key, item.duration])

  useEffect(() => {
    if (closing || paused) {
      animation.current?.pause()
      return
    }
    animation.current?.play()
    startedAt.current = Date.now()
    const timer = window.setTimeout(() => expireFeedback(item.key), Math.max(0, remaining.current))
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [item.key, closing, paused])

  const { icon: Icon, tone } = ICONS[item.icon]

  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Un clic sur le toast ne prend pas le focus (champ en cours de saisie,
      // piege de focus d'une feuille ouverte).
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'pointer-events-auto relative w-full overflow-hidden rounded-2xl border border-edge bg-surface3 shadow-elevated',
        closing ? 'animate-toast-out' : 'animate-toast-in',
      )}
    >
      <div key={item.key} className="flex items-center gap-3 py-2 pl-3 pr-1.5 motion-safe:animate-fade-in">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', tone)}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1 py-1">
          <p className="line-clamp-2 text-[14px] font-semibold leading-snug tracking-tight text-ink">{item.message}</p>
          {item.description && (
            <p className="truncate text-[12.5px] leading-snug text-soft">{item.description}</p>
          )}
        </div>
        {item.undo && (
          <button
            type="button"
            onClick={() => undoFeedback(item.key)}
            className="min-h-11 shrink-0 rounded-xl px-3 text-[13.5px] font-semibold text-accent-ink transition-[background-color,transform] duration-150 ease-spring hover:bg-accent/10 active:scale-95 dark:text-accent lg:min-h-9"
          >
            Annuler
          </button>
        )}
        <button
          type="button"
          onClick={() => expireFeedback(item.key)}
          aria-label="Fermer la notification"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-soft transition-colors hover:bg-surface2 hover:text-ink lg:h-9 lg:w-9"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {item.links && item.links.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-edge/70 px-3 py-2.5">
          {item.links.map((link) => (
            <button
              key={link.label}
              type="button"
              onClick={link.onClick}
              className="inline-flex min-h-11 items-center rounded-full bg-accent/10 px-3.5 text-[13px] font-semibold text-accent-ink transition-[background-color,transform] duration-150 ease-spring hover:bg-accent/15 active:scale-95 dark:text-accent lg:min-h-8"
            >
              {link.label}
            </button>
          ))}
        </div>
      )}
      {/* Temps restant pour annuler (fige au survol). */}
      <span
        ref={barRef}
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent/45 motion-reduce:hidden"
      />
    </div>
  )
}

/**
 * Emplacement de retour de la page Transactions (cf. feedback.ts). Mobile :
 * au-dessus du bouton Ajouter, lui-meme au-dessus de la barre de navigation ;
 * desktop : coin bas droit. Feuille ouverte : en haut de l'ecran (comme la
 * pile globale). Pose au-dessus de la pile globale si elle est occupee.
 * `bottomInset` : place reservee en bas (barre de selection desktop).
 */
export function TxToast({ bottomInset = 0 }: { bottomInset?: number }) {
  const queryClient = useQueryClient()
  const item = useFeedbackStore((s) => s.item)
  const dialogOpen = useDialogOpen()
  const isDesktop = useIsDesktop()
  const stack = useGlobalStackHeight()

  // Derniere valeur affichee, gardee le temps de l'animation de sortie.
  const [shown, setShown] = useState<FeedbackItem | null>(item)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (item) {
      setShown(item)
      setClosing(false)
      return
    }
    setClosing(true)
    const timer = window.setTimeout(() => {
      setShown(null)
      setClosing(false)
    }, EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [item])

  useEffect(() => {
    installFeedbackFlush(queryClient)
  }, [queryClient])
  // Page quittee : le toast courant expire (ses suppressions partent).
  useEffect(() => () => expireFeedback(), [])

  if (!shown) return null

  const offset = stack > 0 ? stack + GAP_PX : 0
  const style: CSSProperties = dialogOpen
    ? { top: isDesktop ? `calc(1.5rem + ${offset}px)` : `calc(env(safe-area-inset-top) + 0.5rem + ${offset}px)` }
    : {
        bottom: isDesktop
          ? `calc(1.5rem + ${offset + bottomInset}px)`
          : `calc(10.75rem + env(safe-area-inset-bottom) + ${offset}px)`,
      }

  return createPortal(
    <div
      data-toaster="transactions"
      role="status"
      aria-live="polite"
      style={style}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full max-w-md px-4 transition-[top,bottom] duration-200 ease-spring lg:inset-x-auto lg:right-6 lg:w-[400px] lg:max-w-none lg:px-0',
        dialogOpen && '[--toast-dy:-16px]',
      )}
    >
      <ToastCard item={shown} closing={closing} />
    </div>,
    document.body,
  )
}
