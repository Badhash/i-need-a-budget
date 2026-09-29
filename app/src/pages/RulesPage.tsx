// Page Regles : categorisation automatique des transactions importees.
// Heros (part des depenses qui se classent seules), creation d'une regle avec
// apercu en direct (exactement la correspondance du serveur), liste ordonnee
// (reordonnancement optimiste, suppression en deux temps, transactions
// captees), testeur de libelle et memoire des tiers. Tout est calcule sur le
// cache ; toutes les ecritures sont optimistes. Desktop : deux colonnes ;
// mobile : trois onglets.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Brain, CheckCircle2, ListOrdered, ScanText, Sparkles, Wand2, X, type LucideIcon } from 'lucide-react'
import {
  draftRule,
  isPendingRule,
  ruleRenderKey,
  useCreateRule,
  useRules,
  useUpdateRule,
  type Rule,
  type RuleMatcher,
} from '@/lib/rules'
import { useBootstrap } from '@/lib/data'
import type { RulePreview } from '@/lib/ruleInsights'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { RuleForm } from '@/components/rules/RuleForm'
import { RulesHero } from '@/components/rules/RulesHero'
import { RulesList } from '@/components/rules/RulesList'
import { RuleTester, type RuleSeed } from '@/components/rules/RuleTester'
import { PayeeMemory, PAYEE_MEMORY_EXPLAINER } from '@/components/rules/PayeeMemory'
import { applyNowLabel, countLabel } from '@/components/rules/RulePreviewPanel'
import { useApplyRulesAction } from '@/components/rules/useApplyRulesAction'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type Tab = 'rules' | 'test' | 'payees'

const TABS: { value: Tab; label: string }[] = [
  { value: 'rules', label: 'Règles' },
  { value: 'test', label: 'Tester' },
  { value: 'payees', label: 'Tiers' },
]

interface FormSeed {
  key: number
  value: string
  categoryId?: string
  focus: boolean
}

interface CreatedRule {
  value: string
  uncategorized: number
}

function PanelHeader({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  badge?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-ink ring-1 ring-inset ring-accent/15 dark:text-accent">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold leading-tight tracking-tight text-ink">
          {title}
          {badge}
        </h2>
        {description && <p className="mt-1 text-[13px] leading-snug text-soft">{description}</p>}
      </div>
    </div>
  )
}

function RulesSkeleton() {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-16 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-3/4 rounded-full" />
            <Skeleton className="h-3.5 w-1/3 rounded-full" />
          </div>
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

export function RulesPage() {
  const isDesktop = useIsDesktop()
  const { data: rules, isError: rulesError, refetch: refetchRules } = useRules()
  const payeesCount = useBootstrap().data?.payees.length
  const createRule = useCreateRule()
  const updateRule = useUpdateRule()
  const { apply, pending: applying } = useApplyRulesAction()

  const [tab, setTab] = useState<Tab>('rules')
  const [seed, setSeed] = useState<FormSeed>({ key: 0, value: '', focus: false })
  const [created, setCreated] = useState<CreatedRule | null>(null)
  const [editing, setEditing] = useState<Rule | null>(null)
  const [testedRuleId, setTestedRuleId] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  // Creation refusee (rollback de la ligne) : la confirmation disparait aussi.
  useEffect(() => {
    if (createRule.isError) setCreated(null)
  }, [createRule.isError])

  // Sans transaction a classer, la confirmation s'efface d'elle-meme.
  useEffect(() => {
    if (!created || created.uncategorized > 0) return
    const timer = window.setTimeout(() => setCreated(null), 6000)
    return () => window.clearTimeout(timer)
  }, [created])

  const onCreate = (matcher: RuleMatcher, categoryId: string, preview: RulePreview) => {
    const rule = draftRule(rules, matcher, categoryId)
    createRule.mutate({ rule })
    setCreated({ value: matcher.value, uncategorized: preview.uncategorized })
    setSeed((s) => ({ key: s.key + 1, value: '', focus: false }))
  }

  const applyNow = () => {
    setCreated(null)
    apply()
  }

  const seedFromTester = useCallback(
    (s: RuleSeed) => {
      setCreated(null)
      setSeed((prev) => ({ key: prev.key + 1, value: s.value, categoryId: s.categoryId, focus: true }))
      if (!isDesktop) setTab('rules')
      requestAnimationFrame(() => {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      })
    },
    [isDesktop],
  )

  const focusForm = () => seedFromTester({ value: '' })

  const newRuleCard = (
    <Card ref={formRef} className="scroll-mt-24">
      <PanelHeader
        icon={Sparkles}
        title="Nouvelle règle"
        description="Les transactions importées dont le libellé correspond sont classées toutes seules."
      />
      <div className="p-5">
        <RuleForm
          key={seed.key}
          initialValue={seed.value}
          initialCategoryId={seed.categoryId}
          autoFocus={seed.focus}
          submitLabel="Créer la règle"
          onSubmit={onCreate}
        />
        {created && (
          <div className="relative mt-4 animate-fade-up space-y-3 rounded-2xl bg-success/10 p-3.5 pr-12 ring-1 ring-inset ring-success/20">
            <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink">
              <CheckCircle2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-success" />
              <span>
                Règle « {created.value} » ajoutée.{' '}
                <span className="text-soft">
                  {created.uncategorized > 0
                    ? `Elle capte déjà ${countLabel(created.uncategorized, 'transaction non catégorisée', 'transactions non catégorisées')}.`
                    : "Elle s'appliquera aux prochains imports."}
                </span>
              </span>
            </p>
            {created.uncategorized > 0 && (
              <Button
                onClick={applyNow}
                disabled={applying}
                className="h-auto min-h-11 w-full whitespace-normal py-2 sm:ml-[28px] sm:w-auto lg:min-h-10"
              >
                <Wand2 className="h-4 w-4" />
                {applyNowLabel(created.uncategorized)}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setCreated(null)}
              aria-label="Masquer la confirmation"
              className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-xl text-soft transition-colors hover:text-ink lg:h-9 lg:w-9"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </Card>
  )

  const rulesCard = (
    <Card className="overflow-hidden">
      <PanelHeader
        icon={ListOrdered}
        title="Tes règles"
        badge={rules && rules.length > 0 ? <Badge size="sm">{rules.length}</Badge> : undefined}
        description="Évaluées de haut en bas : la première qui capte un libellé décide."
      />
      <div className="pt-3">
        {rulesError && !rules ? (
          <EmptyState
            compact
            tone="danger"
            icon={AlertTriangle}
            title="Impossible de charger les règles"
            description="Vérifie ta connexion, puis réessaie."
            actionLabel="Réessayer"
            onAction={() => void refetchRules()}
          />
        ) : !rules ? (
          <RulesSkeleton />
        ) : rules.length === 0 ? (
          <EmptyState
            compact
            icon={Wand2}
            title="Aucune règle pour l'instant"
            description="Crée ta première règle : tes achats récurrents se classeront tout seuls à l'import."
            actionLabel="Créer une règle"
            onAction={focusForm}
          />
        ) : (
          <div className="pb-1">
            <RulesList
              rules={rules}
              onEdit={(rule) => !isPendingRule(rule) && setEditing(rule)}
              highlightId={testedRuleId}
            />
          </div>
        )}
      </div>
    </Card>
  )

  const testerCard = (
    <Card>
      <PanelHeader
        icon={ScanText}
        title="Tester un libellé"
        description="Vois ce que ferait l'import : quelle règle capte le libellé, sinon la mémoire des tiers."
      />
      <div className="p-5">
        <RuleTester onCreateRule={seedFromTester} onMatch={setTestedRuleId} />
      </div>
    </Card>
  )

  const payeesCard = (
    <Card>
      <PanelHeader
        icon={Brain}
        title="Tiers mémorisés"
        badge={payeesCount ? <Badge size="sm">{payeesCount}</Badge> : undefined}
        description={PAYEE_MEMORY_EXPLAINER}
      />
      <PayeeMemory className="p-5" />
    </Card>
  )

  const editingRank = editing && rules ? rules.findIndex((r) => r.id === editing.id) + 1 : 0

  return (
    <div className="space-y-5 lg:space-y-6">
      <RulesHero rulesCount={rules?.length} onApply={apply} applying={applying} />

      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,8fr)_minmax(0,7fr)] items-start gap-6">
          <div className="space-y-6">
            {newRuleCard}
            {rulesCard}
          </div>
          <div className="space-y-6">
            {testerCard}
            {payeesCard}
          </div>
        </div>
      ) : (
        <>
          <SegmentedControl options={TABS} value={tab} onChange={setTab} block aria-label="Section" />
          <div key={tab} className="animate-fade-in space-y-5">
            {tab === 'rules' && (
              <>
                {newRuleCard}
                {rulesCard}
              </>
            )}
            {tab === 'test' && testerCard}
            {tab === 'payees' && payeesCard}
          </div>
        </>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la règle</DialogTitle>
            <DialogDescription>
              {editingRank > 0 ? `Règle n° ${editingRank} dans l'ordre d'évaluation. ` : ''}L'aperçu tient compte des
              règles placées au-dessus.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2">
              <RuleForm
                key={ruleRenderKey(editing)}
                stacked
                ruleId={editing.id}
                initialOp={editing.matcher.op}
                initialValue={editing.matcher.value}
                initialCategoryId={editing.categoryId}
                submitLabel="Enregistrer"
                onSubmit={(matcher, categoryId) => {
                  updateRule.mutate({ rule: { ...editing, matcher, categoryId }, previous: editing })
                  setEditing(null)
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
