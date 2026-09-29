import { useCallback } from 'react'
import { useApplyRules } from '@/lib/rules'
import { toast } from '@/lib/toast'

/**
 * « Appliquer les regles maintenant » avec confirmation par toast : les
 * transactions sont categorisees aussitot (optimiste, cf. useApplyRules), le
 * toast confirme le nombre renvoye par le serveur ou signale l'echec avec
 * « Réessayer » (la mutation declare errorToast: false, pas de doublon).
 */
export function useApplyRulesAction(): { apply: () => void; pending: boolean } {
  const applyRules = useApplyRules()
  const { mutateAsync } = applyRules

  const apply = useCallback(() => {
    mutateAsync()
      .then((categorized) => {
        toast({
          id: 'rules-applied',
          tone: categorized > 0 ? 'success' : 'default',
          message:
            categorized > 0
              ? `${categorized} transaction${categorized > 1 ? 's' : ''} catégorisée${categorized > 1 ? 's' : ''}`
              : 'Aucune transaction à catégoriser',
          description: categorized > 0 ? 'Le budget du mois se met à jour.' : undefined,
        })
      })
      .catch(() => {
        toast({
          id: 'rules-applied',
          tone: 'danger',
          message: "Les règles n'ont pas pu être appliquées",
          description: "Rien n'a été modifié.",
          action: { label: 'Réessayer', onClick: () => apply() },
        })
      })
  }, [mutateAsync])

  return { apply, pending: applyRules.isPending }
}
