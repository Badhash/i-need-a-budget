import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  // Appui : enfoncement 0,97 (courbe ressort) ; focus clavier : anneau accent
  // global (:focus-visible, globals.css). Hauteurs >= 44px sur mobile.
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[14px] font-medium transition-[background-color,border-color,color,opacity,transform,box-shadow,filter] duration-150 ease-spring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accentfg shadow-button hover:brightness-[1.06] active:brightness-95',
        secondary: 'bg-surface2 text-ink hover:bg-line/70',
        outline: 'border border-line bg-surface text-ink shadow-card hover:border-soft/35 hover:bg-surface2/60',
        ghost: 'text-soft hover:bg-surface2 hover:text-ink',
        danger: 'bg-danger text-white hover:brightness-105 dark:text-bg',
        // Action accentuee secondaire : teinte d'accent, texte AA.
        soft: 'bg-accent/10 text-accent-ink hover:bg-accent/15',
        // Lien d'action (texte accent, sans fond).
        link: 'h-auto px-0 text-accent-ink underline-offset-4 hover:underline active:scale-100',
      },
      // Hauteur portee par --btn-h (plus haute sur mobile, cible tactile) : la
      // classe h-[var(--btn-h)] est UNE classe de hauteur, qu'une hauteur
      // passee par l'appelant (h-12, h-9...) remplace a TOUTES les largeurs
      // (tailwind-merge). Un lg:h-* dans la variante survivrait a la fusion et
      // l'emporterait en desktop sur la taille explicite de l'appelant.
      size: {
        default: 'h-[var(--btn-h)] px-4 [--btn-h:2.75rem] lg:[--btn-h:2.5rem]',
        sm: 'h-[var(--btn-h)] rounded-lg px-3 text-[13px] [--btn-h:2.25rem] lg:[--btn-h:2rem]',
        lg: 'h-[var(--btn-h)] px-5 text-[15px] [--btn-h:3rem] lg:[--btn-h:2.75rem]',
        icon: 'h-[var(--btn-h)] w-[var(--btn-h)] [--btn-h:2.75rem] lg:[--btn-h:2.5rem]',
        iconSm: 'h-[var(--btn-h)] w-[var(--btn-h)] rounded-lg [--btn-h:2.25rem] lg:[--btn-h:2rem]',
      },
    },
    compoundVariants: [
      // Un lien garde sa hauteur de ligne quelle que soit la taille demandee.
      { variant: 'link', className: 'h-auto px-0' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
)
Button.displayName = 'Button'

export { Button, buttonVariants }
