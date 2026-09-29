import { draftRule, useCreateRule, useRules, type RuleMatcher } from '@/lib/rules'
import type { RulePreview } from '@/lib/ruleInsights'
import { toast } from '@/lib/toast'
import { RuleForm } from '@/components/rules/RuleForm'
import { applyNowLabel } from '@/components/rules/RulePreviewPanel'
import { useApplyRulesAction } from '@/components/rules/useApplyRulesAction'
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
 * du toast) : reutilise le formulaire de la page Regles (apercu en direct
 * compris), pre-rempli avec le libelle et la categorie qui vient d'etre
 * choisie. Creation optimiste : la feuille se ferme aussitot et un toast
 * propose d'appliquer la regle aux transactions non categorisees qu'elle capte.
 */
export function CreateRuleDialog({ open, onOpenChange, initialValue, initialCategoryId }: CreateRuleDialogProps) {
  const { data: rules } = useRules()
  const createRule = useCreateRule()
  const { apply } = useApplyRulesAction()

  const submit = (matcher: RuleMatcher, categoryId: string, preview: RulePreview) => {
    createRule.mutate({ rule: draftRule(rules, matcher, categoryId) })
    onOpenChange(false)
    const n = preview.uncategorized
    toast({
      id: 'rule-created',
      tone: 'success',
      message: `Règle « ${matcher.value} » créée`,
      description:
        n > 0
          ? `${applyNowLabel(n)} ?`
          : 'Les prochaines transactions correspondantes seront catégorisées automatiquement.',
      action: n > 0 ? { label: 'Appliquer', onClick: apply } : undefined,
      duration: n > 0 ? 8000 : undefined,
    })
  }

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
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
            <RuleForm
              key={`${initialValue}|${initialCategoryId ?? ''}`}
              stacked
              initialOp="contains"
              initialValue={initialValue}
              initialCategoryId={initialCategoryId}
              submitLabel="Créer la règle"
              onSubmit={submit}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
