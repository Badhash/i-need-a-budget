import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[14px] font-medium transition-[background-color,border-color,color,opacity,transform,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] select-none',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accentfg hover:brightness-105 shadow-sm',
        secondary: 'bg-surface2 text-ink hover:bg-line/80',
        outline: 'border border-line bg-surface text-ink hover:bg-surface2',
        ghost: 'text-soft hover:bg-surface2 hover:text-ink',
        danger: 'bg-danger text-white dark:text-bg hover:brightness-105',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-3 text-[13px]',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'h-10 w-10',
        iconSm: 'h-8 w-8 rounded-lg',
      },
    },
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
