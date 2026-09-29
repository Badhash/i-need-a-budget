import {
  AlertTriangle,
} from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/** Etat d'erreur du budget : evite un skeleton infini si le chargement echoue. */
export function BudgetError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title="Impossible de charger le budget"
        description="Une erreur est survenue lors du chargement de vos données. Vérifiez votre connexion, puis réessayez."
        actionLabel="Réessayer"
        onAction={onRetry}
      />
    </Card>
  )
}

export function BudgetSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[104px] rounded-2xl" />
      <Card className="p-5">
        <div className="space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
