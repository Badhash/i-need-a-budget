import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // 16px sur mobile : en dessous, iOS Safari zoome la page au focus.
        'flex h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[16px] text-ink placeholder:text-soft/70 transition-colors focus:border-accent/60 disabled:opacity-50 lg:h-10 lg:text-[14px]',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
