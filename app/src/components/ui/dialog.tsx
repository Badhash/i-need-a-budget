import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Dialogs ouverts (etat logique, hors animation de sortie) : les couches
// globales s'en ecartent. Le Toaster remonte sa pile en haut de l'ecran tant
// qu'une feuille occupe le bas (pied d'actions, clavier iOS).
let openDialogs = 0
const openListeners = new Set<() => void>()

function subscribeOpenDialogs(listener: () => void): () => void {
  openListeners.add(listener)
  return () => {
    openListeners.delete(listener)
  }
}

function shiftOpenDialogs(delta: number): void {
  openDialogs += delta
  openListeners.forEach((listener) => listener())
}

/** Vrai tant qu'au moins un Dialog (feuille ou modale) est ouvert. */
function useDialogOpen(): boolean {
  return React.useSyncExternalStore(subscribeOpenDialogs, () => openDialogs > 0, () => false)
}

/**
 * Racine Radix qui declare en plus son ouverture (useDialogOpen). Controlee en
 * interne ; le mode non controle (defaultOpen) reste supporte.
 */
function Dialog({ open: openProp, defaultOpen, onOpenChange, ...props }: DialogPrimitive.DialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false)
  const open = openProp ?? uncontrolledOpen
  // Effet de mise en page : l'etat est publie avant la peinture, les couches
  // qui en dependent se placent dans la meme image que la feuille.
  React.useLayoutEffect(() => {
    if (!open) return
    shiftOpenDialogs(1)
    return () => shiftOpenDialogs(-1)
  }, [open])
  return (
    <DialogPrimitive.Root
      {...props}
      open={open}
      onOpenChange={(next) => {
        if (openProp === undefined) setUncontrolledOpen(next)
        onOpenChange?.(next)
      }}
    />
  )
}

const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // Voile teinte (token --scrim) + leger flou : le contexte reste lisible.
      'fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

// Glisser la poignee vers le bas ferme la feuille au-dela de ce seuil (px) ou
// d'une vitesse suffisante (px/ms) : geste natif des feuilles iOS.
const DISMISS_DISTANCE = 110
const DISMISS_VELOCITY = 0.6

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, onInteractOutside, onAnimationStart, onAnimationEnd, ...props }, ref) => {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const dragStart = React.useRef<{ y: number; t: number } | null>(null)
  const [drag, setDrag] = React.useState(0)

  // Le decalage de glisse se compose avec la transformation posee par
  // l'appelant (decalage clavier iOS : translateY(-Npx) en style inline).
  const mergedStyle: React.CSSProperties | undefined =
    drag > 0
      ? { ...style, transform: `${style?.transform ?? ''} translateY(${drag}px)`.trim(), transition: 'none' }
      : style

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStart.current = { y: e.clientY, t: performance.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return
    setDrag(Math.max(0, e.clientY - dragStart.current.y))
  }
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    dragStart.current = null
    if (!start) return
    const dy = Math.max(0, e.clientY - start.y)
    const velocity = dy / Math.max(1, performance.now() - start.t)
    // Fermeture : l'animation de sortie repart de la position glissee (la
    // keyframe n'a pas d'etat initial) ; sinon retour elastique a 0.
    if (dy > DISMISS_DISTANCE || (dy > 24 && velocity > DISMISS_VELOCITY)) closeRef.current?.click()
    else setDrag(0)
  }

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // Les popovers maison (CategoryPicker) et la pile de toasts (Toaster)
        // sont portalises dans body, donc "dehors" pour Radix : sans cette
        // garde, un tap dessus fermait le dialog ouvert (saisie perdue).
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.('[data-inab-popover],[data-toaster]')) e.preventDefault()
          onInteractOutside?.(e)
        }}
        // Remise a zero du glisse a chaque ouverture / fin de fermeture : le
        // composant appelant reste monte entre deux ouvertures.
        onAnimationStart={(e) => {
          if (e.currentTarget.dataset.state === 'open' && e.target === e.currentTarget) setDrag(0)
          onAnimationStart?.(e)
        }}
        onAnimationEnd={(e) => {
          if (e.currentTarget.dataset.state === 'closed' && e.target === e.currentTarget) setDrag(0)
          onAnimationEnd?.(e)
        }}
        style={mergedStyle}
        className={cn(
          // Mobile : feuille basse (poignee, glisse du bas, courbe ressort).
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[28px] outline-none focus-visible:ring-0 focus-visible:ring-offset-0 border-t border-edge bg-surface pb-safe shadow-elevated will-change-transform transition-transform duration-150 ease-out',
          'data-[state=closed]:animate-slide-down data-[state=open]:animate-slide-up',
          // Desktop : modale centree, apparition par mise a l'echelle.
          'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border',
          'sm:data-[state=closed]:animate-modal-out sm:data-[state=open]:animate-modal-in',
          className,
        )}
        {...props}
      >
        {/* Poignee (mobile) : zone de glisse pleine largeur en haut de la feuille. */}
        <div
          aria-hidden
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={() => {
            // Geste repris par le systeme : jamais de fermeture, retour a 0.
            dragStart.current = null
            setDrag(0)
          }}
          className="absolute inset-x-0 top-0 z-10 flex h-5 cursor-grab touch-none justify-center pt-2 active:cursor-grabbing sm:hidden"
        >
          <span className="h-1.5 w-10 rounded-full bg-ink/15" />
        </div>
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-surface2 text-soft transition-[background-color,color,transform] duration-150 ease-spring after:absolute after:-inset-1.5 after:content-[''] hover:bg-line/80 hover:text-ink active:scale-90"
        >
          <X className="h-4 w-4" strokeWidth={2.4} />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})
DialogContent.displayName = 'DialogContent'

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-2', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 p-5 pt-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[18px] font-semibold tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[13.5px] leading-relaxed text-soft', className)}
    {...props}
  />
))
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  useDialogOpen,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
