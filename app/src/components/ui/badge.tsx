import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium tnum [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        neutral: 'bg-surface2 text-soft ring-1 ring-inset ring-line/60',
        success: 'bg-success/10 text-success ring-1 ring-inset ring-success/15',
        warning: 'bg-warning/10 text-warning ring-1 ring-inset ring-warning/20',
        danger: 'bg-danger/10 text-danger ring-1 ring-inset ring-danger/15',
        accent: 'bg-accent/10 text-accent-ink ring-1 ring-inset ring-accent/20',
        // Pastille pleine (compteurs, statut fort).
        solid: 'bg-accent text-accentfg shadow-button',
        // Contour seul, pour une information secondaire.
        outline: 'text-soft ring-1 ring-inset ring-line',
      },
      size: {
        sm: 'px-2 py-px text-[11px]',
        md: 'px-2.5 py-0.5 text-[12px]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'md',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Petit point de statut colore avant le libelle. */
  dot?: boolean
}

function Badge({ className, variant, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
