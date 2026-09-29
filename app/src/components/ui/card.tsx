import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Aura, type AuraIntensity, type AuraTone } from '@/components/shared/Aura'
import { cn } from '@/lib/utils'

// Retour de survol/appui partage par les cartes cliquables : legere elevation
// au survol (pointeurs fins uniquement), enfoncement a l'appui.
const INTERACTIVE =
  'cursor-pointer transition-[transform,box-shadow,border-color,background-color] duration-200 ease-spring active:scale-[0.99] [@media(hover:hover)]:hover:-translate-y-0.5 [@media(hover:hover)]:hover:border-line [@media(hover:hover)]:hover:shadow-raised'

const cardVariants = cva('rounded-2xl', {
  variants: {
    variant: {
      // Carte standard : surface pleine, ombre ambiante douce (light), filet
      // fin + reflet haut (dark).
      default: 'border border-edge bg-surface shadow-card',
      // Carte surelevee (mise en avant, panneau flottant).
      raised: 'border border-edge bg-surface3 shadow-raised',
      // Verre : a reserver au chrome (barres, menus), jamais a du contenu dense.
      glass: 'glass border border-line/60 shadow-card',
      // Hero : le chiffre cle d'un ecran, sur un halo « aurore ».
      hero: 'relative isolate overflow-hidden rounded-3xl border border-edge bg-surface shadow-raised',
      // Carte cliquable (equivalent de default + interactive).
      interactive: cn('border border-edge bg-surface shadow-card', INTERACTIVE),
    },
    interactive: {
      true: INTERACTIVE,
      false: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    interactive: false,
  },
})

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /** Couleur du halo de la variante hero (defaut : aurore du theme). */
  tone?: AuraTone
  /** Intensite du halo de la variante hero. */
  auraIntensity?: AuraIntensity
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, tone = 'accent', auraIntensity, children, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant, interactive }), className)} {...props}>
      {variant === 'hero' && <Aura tone={tone} intensity={auraIntensity} />}
      {children}
    </div>
  ),
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 p-5 pb-0', className)} {...props} />
  ),
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-[15px] font-semibold leading-snug tracking-tight', className)} {...props} />
  ),
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-[13px] leading-relaxed text-soft', className)} {...props} />
  ),
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('p-5', className)} {...props} />,
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 border-t border-line/70 px-5 py-4', className)} {...props} />
  ),
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants }
