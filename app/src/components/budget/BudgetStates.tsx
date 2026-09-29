import { CloudOff } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** Etat d'erreur du budget : evite un skeleton infini si le chargement echoue. */
export function BudgetError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="animate-fade-in">
      <EmptyState
        icon={CloudOff}
        tone="danger"
        title="Impossible de charger le budget"
        description="Une erreur est survenue lors du chargement de vos données. Vérifiez votre connexion, puis réessayez."
        actionLabel="Réessayer"
        onAction={onRetry}
      />
    </Card>
  )
}

/** Squelette de chargement : memes volumes que la page (heros, outils, groupes). */
export function BudgetSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement du budget">
      {/* Heros du Pret a assigner (mobile). */}
      <div className="rounded-3xl border border-edge bg-surface p-5 shadow-raised lg:hidden">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="mt-3.5 h-10 w-48 rounded-xl" />
        <Skeleton className="mt-3 h-3.5 w-56 rounded-full" />
        <Skeleton className="mt-6 h-2 w-full rounded-full" />
        <div className="mt-2.5 flex justify-between">
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="h-3 w-28 rounded-full" />
        </div>
      </div>

      {/* Barre d'outils. */}
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-11 w-[92px] rounded-full lg:h-10 lg:w-56 lg:rounded-xl" />
        <Skeleton className="h-11 w-52 rounded-full lg:h-10 lg:w-80 lg:rounded-xl" />
      </div>

      {/* Groupes en cartes (mobile). */}
      {[4, 3, 4].map((rows, g) => (
        <div key={g} className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-card lg:hidden">
          <div className="flex items-center gap-3 border-b border-line/70 px-4 py-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-28 rounded-full" />
              <Skeleton className="h-3 w-40 rounded-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="divide-y divide-line/60">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-[18px]">
                <Skeleton className="h-4 rounded-full" style={{ width: `${34 + ((i * 17 + g * 11) % 26)}%` }} />
                <Skeleton className="h-7 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Grille dense (desktop). */}
      <div className="hidden overflow-hidden rounded-2xl border border-edge bg-surface shadow-card lg:block">
        <div className="flex items-center gap-6 border-b border-line px-5 py-3.5">
          <Skeleton className="h-3 w-24 rounded-full" />
          <span className="flex-1" />
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-3 w-16 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className={i % 5 === 0 ? 'flex items-center gap-6 bg-surface2/50 px-5 py-3' : 'flex items-center gap-6 border-t border-line/60 px-5 py-3.5'}
          >
            {i % 5 === 0 && <Skeleton className="h-7 w-7 rounded-full" />}
            <Skeleton className="h-4 rounded-full" style={{ width: `${14 + ((i * 7) % 12)}%` }} />
            <span className="flex-1" />
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-4 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
