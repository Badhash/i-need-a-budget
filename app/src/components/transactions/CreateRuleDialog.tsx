import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCreateRule, useRules, RULES_KEY, type RuleMatcher } from '@/lib/rules'
import { RuleForm } from '@/components/rules/RuleForm'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface CreateRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-remplissage : texte recherche (libelle court) et categorie cible. */
  initialValue: string
  initialCategoryId?: string
}

/**
 * Creation d'une regle depuis la page Transactions (lien « Creer une regle »
 * du toast) : reutilise le formulaire de la page Regles, pre-rempli avec le
 * libelle court et la categorie qui vient d'etre choisie.
 */
export function CreateRuleDialog({ open, onOpenChange, initialValue, initialCategoryId }: CreateRuleDialogProps) {
  const queryClient = useQueryClient()
  const { data: rules } = useRules()
  const nextPriority = rules && rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 1 : 1

  const createMut = useMutation({
    mutationFn: (input: { matcher: RuleMatcher; categoryId: string }) =>
      apiCreateRule({ matcher: input.matcher, categoryId: input.categoryId, priority: nextPriority }),
    onSuccess: () => {
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer une règle</DialogTitle>
          <DialogDescription>
            Les prochaines transactions correspondantes seront catégorisées automatiquement.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <div className="p-5 pt-2">
            <RuleForm
              key={`${initialValue}|${initialCategoryId ?? ''}`}
              stacked
              initialOp="contains"
              initialValue={initialValue}
              initialCategoryId={initialCategoryId}
              submitLabel="Créer la règle"
              pending={createMut.isPending}
              onSubmit={(matcher, categoryId) => createMut.mutate({ matcher, categoryId })}
            />
            {createMut.isError && (
              <p role="alert" className="mt-3 text-[13px] text-danger">
                {createMut.error.message || 'La création de la règle a échoué.'}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
