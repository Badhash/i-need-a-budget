import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Classes partagees des champs (Input, Select, Combobox, MonthPicker) : survol
 * discret, focus = bordure accent + halo doux (sans decalage), 16px sur
 * mobile (en dessous, iOS Safari zoome la page au focus).
 */
export const fieldClasses =
  'h-11 w-full rounded-xl border border-line bg-surface text-[16px] text-ink shadow-[inset_0_1px_2px_rgb(var(--ink)/0.03)] outline-none transition-[border-color,box-shadow,background-color] duration-150 ease-spring placeholder:text-soft/70 hover:border-soft/40 focus:border-accent/70 focus:ring-4 focus:ring-accent/15 focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10 lg:text-[14px]'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn('flex px-3.5', fieldClasses, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export { Input }
