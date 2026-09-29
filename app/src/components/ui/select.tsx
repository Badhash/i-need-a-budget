import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { fieldClasses } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('group relative', className)}>
      <select ref={ref} className={cn('cursor-pointer appearance-none pl-3.5 pr-9', fieldClasses)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-colors group-hover:text-ink" />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
