import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { useDialogOpen } from '@/components/ui/dialog'
import { dismissToast, useToastStore, type ToastItem, type ToastTone } from '@/lib/toast'
import { cn } from '@/lib/utils'

const TONE_ICON: Record<ToastTone, LucideIcon | null> = {
  default: null,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
}

const TONE_CLASS: Record<ToastTone, string> = {
  default: '',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
}

function ToastView({ item }: { item: ToastItem }) {
  // Minuterie de fermeture, suspendue au survol / focus (lecture, clic).
  const [paused, setPaused] = useState(false)
  const remaining = useRef(item.duration)
  const startedAt = useRef(0)

  useEffect(() => {
    remaining.current = item.duration
  }, [item.version, item.duration])

  useEffect(() => {
    if (item.closing || item.duration <= 0 || paused) return
    startedAt.current = Date.now()
    const timer = window.setTimeout(() => dismissToast(item.id), Math.max(0, remaining.current))
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - startedAt.current
    }
  }, [item.id, item.version, item.closing, item.duration, paused])

  const Icon = TONE_ICON[item.tone]

  return (
    <div
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // Un clic sur le toast ne prend pas le focus : le champ en cours de saisie
      // (feuille ouverte, clavier iOS) le garde, et le piege de focus du
      // dialog n'est pas sollicite.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'pointer-events-auto flex w-full items-center gap-3 rounded-2xl border border-edge bg-surface3 py-2 pl-4 pr-1.5 shadow-elevated',
        item.closing ? 'animate-toast-out' : 'animate-toast-in',
      )}
    >
      {Icon && (
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONE_CLASS[item.tone])}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </span>
      )}
      <div className="min-w-0 flex-1 py-1.5">
        <p className="text-[14px] font-medium leading-snug text-ink">{item.message}</p>
        {item.description && <p className="mt-0.5 text-[13px] leading-snug text-soft">{item.description}</p>}
      </div>
      {item.action && (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick()
            dismissToast(item.id)
          }}
          className="min-h-11 shrink-0 rounded-xl px-3 text-[13.5px] font-semibold text-accent-ink transition-[background-color,transform] duration-150 ease-spring hover:bg-accent/10 active:scale-95"
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Fermer la notification"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-soft transition-colors hover:bg-surface2 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Pile de toasts globale (monte une fois dans AppShell). Mobile : au-dessus du
 * bouton Ajouter (lui-meme au-dessus de la barre de navigation), jamais
 * dessus ; desktop : coin bas droit. Le plus recent au plus pres du bord.
 *
 * Feuille ou modale ouverte : la pile passe en HAUT de l'ecran (coin haut
 * droit en desktop) pour ne masquer ni le pied d'actions de la feuille ni
 * finir sous le clavier iOS. Elle est declaree couche toleree (data-toaster) :
 * la toucher ne ferme pas le dialog ouvert dessous.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dialogOpen = useDialogOpen()
  return createPortal(
    <div
      data-toaster=""
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full max-w-md gap-2 px-4 lg:inset-x-auto lg:right-6 lg:w-[380px] lg:max-w-none lg:px-0',
        dialogOpen
          ? // En haut : le plus recent contre le bord, entree par le haut.
            'top-[calc(env(safe-area-inset-top)+0.5rem)] flex-col-reverse [--toast-dy:-16px] lg:top-6'
          : // 6,5rem (bas du bouton Ajouter) + 3,5rem (sa hauteur) + 0,75rem d'air.
            'bottom-[calc(10.75rem+env(safe-area-inset-bottom))] flex-col lg:bottom-6',
      )}
    >
      {toasts.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>,
    document.body,
  )
}
