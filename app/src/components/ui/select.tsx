import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        // 16px sur mobile : en dessous, iOS Safari zoome la page au focus.
        className="h-11 w-full appearance-none rounded-xl border border-line bg-surface pl-3.5 pr-9 text-[16px] text-ink transition-colors focus:border-accent/60 disabled:opacity-50 lg:h-10 lg:text-[14px]"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
