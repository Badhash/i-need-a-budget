import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

function RowSkeleton({ wide }: { wide: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 lg:px-5">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full lg:h-8 lg:w-8" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className={wide ? 'h-3.5 w-2/3' : 'h-3.5 w-1/2'} />
        <Skeleton className="h-3 w-24 rounded-full" />
      </div>
      <Skeleton className="h-3.5 w-16" />
    </div>
  )
}

/** Chargement de la liste : meme silhouette que la page (filtres, jours, lignes). */
export function TransactionsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement des transactions">
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="flex gap-2 overflow-hidden">
          {[64, 128, 88, 96].map((w) => (
            <Skeleton key={w} className="h-10 shrink-0 rounded-full" style={{ width: w }} />
          ))}
        </div>
      </div>
      {[4, 3].map((n, day) => (
        <div key={day} className="space-y-2">
          <div className="flex items-center justify-between px-1 pt-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-14" />
          </div>
          <Card className="divide-y divide-edge overflow-hidden">
            {Array.from({ length: n }).map((_, i) => (
              <RowSkeleton key={i} wide={(i + day) % 2 === 0} />
            ))}
          </Card>
        </div>
      ))}
    </div>
  )
}
