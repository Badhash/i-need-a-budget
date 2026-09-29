import { Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 'h-8 w-8 rounded-[10px] shadow-button [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 w-10 rounded-xl shadow-button [&_svg]:h-5 [&_svg]:w-5',
  lg: 'h-14 w-14 rounded-2xl shadow-glow [&_svg]:h-7 [&_svg]:w-7',
  xl: 'h-16 w-16 rounded-[1.35rem] shadow-glow [&_svg]:h-8 [&_svg]:w-8',
}

/** Pastille de marque : portefeuille sur le degrade accent -> accent-2. */
export function BrandMark({ size = 'md', className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center bg-brand text-accentfg ring-1 ring-inset ring-accentfg/15',
        SIZES[size],
        className,
      )}
    >
      <Wallet strokeWidth={2} />
    </span>
  )
}
