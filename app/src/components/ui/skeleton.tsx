import { cn } from '@/lib/utils'

/** Bloc de chargement : fond attenue + reflet qui glisse (jamais de spinner). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton-shimmer rounded-xl bg-ink/[0.06]', className)} {...props} />
}

export { Skeleton }
