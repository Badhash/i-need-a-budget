// Analyses des regles sur le cache TanStack (aucune lecture reseau) : apercu
// d'une regle en cours de saisie, correspondances de chaque regle, testeur de
// libelle et couverture de la categorisation automatique. La correspondance
// est celle du serveur (lib/rules : normalizeLabel + matchNormalized, ordre
// priorite puis id, regles d'abord puis memoire de tiers).
//
// Les libelles normalises et les cles de tiers sont memorises PAR objet
// transaction (WeakMap) : une categorisation optimiste ne recree que l'objet
// modifie, le reste du cache n'est pas renormalise a chaque frappe ou clic.

import { useMemo } from 'react'
import type { Category, Transaction } from '@/types/domain'
import { useAccountsList, useBootstrap, type PayeeDefault } from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { today } from '@/lib/format'
import {
  compareRules,
  compileRules,
  firstMatch,
  isRuleCandidate,
  matchNormalized,
  normalizeLabel,
  useRules,
  type Rule,
  type RuleOp,
} from '@/lib/rules'
import { payeeKey } from '../../../packages/crypto/src/payee'

const labelCache = new WeakMap<Transaction, string>()
const payeeCache = new WeakMap<Transaction, string>()

/** Libelle normalise (normalizeLabel) d'une transaction, memorise. */
export function normalizedLabelOf(t: Transaction): string {
  let value = labelCache.get(t)
  if (value === undefined) {
    value = normalizeLabel(t.label)
    labelCache.set(t, value)
  }
  return value
}

/** Cle de tiers (payeeKey) d'une transaction, memorisee. */
export function payeeKeyOf(t: Transaction): string {
  let value = payeeCache.get(t)
  if (value === undefined) {
    value = payeeKey(t.label)
    payeeCache.set(t, value)
  }
  return value
}

function byRecency(a: Transaction, b: Transaction): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0
}

/** Ids des comptes budget (les seuls que les regles touchent). */
function useOnBudgetIds(): ReadonlySet<string> {
  const accounts = useAccountsList()
  return useMemo(() => new Set(accounts.filter((a) => a.onBudget).map((a) => a.id)), [accounts])
}

// ---------------------------------------------------------------------------
// Apercu d'une regle en cours de saisie
// ---------------------------------------------------------------------------

export interface RulePreviewGroup {
  /** Cle de regroupement : cle de tiers (ou libelle normalise sans mot stable). */
  key: string
  /** Transaction representative : non categorisee d'abord, puis la plus recente. */
  sample: Transaction
  /** Transactions du groupe captees par la regle. */
  count: number
  /** ... dont non categorisees. */
  uncategorized: number
  /** Categorie la plus frequente parmi les categorisees du groupe. */
  categoryId: string | null
}

export interface RulePreview {
  /** Aiguille vide une fois normalisee : la regle ne capterait jamais rien. */
  empty: boolean
  /** Transactions que la regle categoriserait (elle est la premiere a les capter). */
  matched: number
  /** ... dont non categorisees : celles qu'« Appliquer » categoriserait. */
  uncategorized: number
  /** Correspondances deja captees par une regle prioritaire. */
  shadowed: number
  /** Regle prioritaire qui en capte le plus. */
  shadowedBy: Rule | null
  /** Transactions candidates au total (regle trop large). */
  candidates: number
  /** Jusqu'a 5 exemples regroupes par tiers (non categorises d'abord). */
  examples: RulePreviewGroup[]
  /** Tiers captes au-dela des exemples affiches. */
  moreGroups: number
}

const EMPTY_PREVIEW: RulePreview = {
  empty: true,
  matched: 0,
  uncategorized: 0,
  shadowed: 0,
  shadowedBy: null,
  candidates: 0,
  examples: [],
  moreGroups: 0,
}

const MAX_EXAMPLES = 5

export function computeRulePreview(input: {
  transactions: readonly Transaction[]
  onBudgetIds: ReadonlySet<string>
  /** Regles existantes (la regle editee en est exclue par l'appelant). */
  rules: readonly Rule[]
  /** Position de la regle dans l'ordre d'evaluation (priorite puis id). */
  self: { id: string; priority: number }
  op: RuleOp
  value: string
}): RulePreview {
  const needle = normalizeLabel(input.value)
  if (!needle) return EMPTY_PREVIEW
  const before = compileRules(input.rules.filter((r) => compareRules(r, input.self) < 0))
  let candidates = 0
  let shadowed = 0
  const shadowCounts = new Map<Rule, number>()
  const hits: Transaction[] = []
  for (const t of input.transactions) {
    if (!isRuleCandidate(t, input.onBudgetIds)) continue
    candidates += 1
    const label = normalizedLabelOf(t)
    if (!matchNormalized(label, input.op, needle)) continue
    const earlier = firstMatch(label, before)
    if (earlier) {
      shadowed += 1
      shadowCounts.set(earlier, (shadowCounts.get(earlier) ?? 0) + 1)
      continue
    }
    hits.push(t)
  }
  let shadowedBy: Rule | null = null
  let best = 0
  for (const [rule, count] of shadowCounts) {
    if (count > best) {
      best = count
      shadowedBy = rule
    }
  }
  // Exemples regroupes par tiers : une ligne par marchand avec son nombre,
  // plus parlant que cinq fois le meme libelle a des dates differentes.
  const ordered = hits
    .slice()
    .sort((a, b) => Number(Boolean(a.categoryId)) - Number(Boolean(b.categoryId)) || byRecency(a, b))
  const groups = new Map<string, RulePreviewGroup & { categories: Map<string, number> }>()
  for (const t of ordered) {
    const key = payeeKeyOf(t) || normalizedLabelOf(t)
    let group = groups.get(key)
    if (!group) {
      group = { key, sample: t, count: 0, uncategorized: 0, categoryId: null, categories: new Map() }
      groups.set(key, group)
    }
    group.count += 1
    if (!t.categoryId) group.uncategorized += 1
    else group.categories.set(t.categoryId, (group.categories.get(t.categoryId) ?? 0) + 1)
  }
  const ranked = [...groups.values()].sort(
    (a, b) => Number(b.uncategorized > 0) - Number(a.uncategorized > 0) || b.count - a.count,
  )
  const examples: RulePreviewGroup[] = ranked.slice(0, MAX_EXAMPLES).map(({ categories, ...group }) => {
    let best = 0
    for (const [categoryId, n] of categories) {
      if (n > best) {
        best = n
        group.categoryId = categoryId
      }
    }
    return group
  })
  return {
    empty: false,
    matched: hits.length,
    uncategorized: hits.filter((t) => !t.categoryId).length,
    shadowed,
    shadowedBy,
    candidates,
    examples,
    moreGroups: Math.max(0, groups.size - examples.length),
  }
}

/** Identifiant fictif d'une regle en cours de creation : evaluee en dernier. */
export const NEW_RULE_ID = '~nouvelle'

/**
 * Apercu en direct d'une regle (creation : evaluee apres toutes les autres ;
 * edition : a sa place, la version enregistree exclue).
 */
export function useRulePreview(op: RuleOp, value: string, ruleId?: string): RulePreview {
  const { data: transactions } = useTransactions()
  const { data: rules } = useRules()
  const onBudgetIds = useOnBudgetIds()
  return useMemo(() => {
    if (!transactions) return { ...EMPTY_PREVIEW, empty: !normalizeLabel(value) }
    const all = rules ?? []
    const existing = ruleId ? all.find((r) => r.id === ruleId) : undefined
    const others = existing ? all.filter((r) => r.id !== existing.id) : all
    const self = existing
      ? { id: existing.id, priority: existing.priority }
      : { id: NEW_RULE_ID, priority: all.length > 0 ? Math.max(...all.map((r) => r.priority)) + 1 : 0 }
    return computeRulePreview({ transactions, onBudgetIds, rules: others, self, op, value })
  }, [transactions, rules, onBudgetIds, ruleId, op, value])
}

// ---------------------------------------------------------------------------
// Correspondances de chaque regle (liste)
// ---------------------------------------------------------------------------

export interface RuleCounts {
  /** Transactions dont le libelle correspond a la regle. */
  matched: number
  /** ... dont celles qu'elle capte en premier (les autres : regle prioritaire). */
  effective: number
  /** ... dont non categorisees (captees en premier). */
  uncategorized: number
}

export function useRuleCounts(): Map<string, RuleCounts> {
  const { data: transactions } = useTransactions()
  const { data: rules } = useRules()
  const onBudgetIds = useOnBudgetIds()
  return useMemo(() => {
    const out = new Map<string, RuleCounts>()
    if (!rules) return out
    const compiled = compileRules(rules)
    for (const c of compiled) out.set(c.rule.id, { matched: 0, effective: 0, uncategorized: 0 })
    if (!transactions) return out
    for (const t of transactions) {
      if (!isRuleCandidate(t, onBudgetIds)) continue
      const label = normalizedLabelOf(t)
      let first = true
      for (const c of compiled) {
        if (!matchNormalized(label, c.rule.matcher.op, c.needle)) continue
        const counts = out.get(c.rule.id)!
        counts.matched += 1
        if (first) {
          counts.effective += 1
          if (!t.categoryId) counts.uncategorized += 1
          first = false
        }
      }
    }
    return out
  }, [transactions, rules, onBudgetIds])
}

// ---------------------------------------------------------------------------
// Testeur de libelle
// ---------------------------------------------------------------------------

export interface LabelTest {
  /** Libelle normalise (ce que compare le serveur). */
  normalized: string
  /** Premiere regle qui capte le libelle, et son rang (1 = la plus prioritaire). */
  rule: Rule | null
  rank: number | null
  /** Cle de tiers du libelle (vide = aucun mot stable). */
  payeeKey: string
  /** Categorie memorisee pour ce tiers (qu'elle decide ou non). */
  payeeCategoryId: string | null
  /** Ce que ferait le serveur : categorie finale et sa source. */
  categoryId: string | null
  source: 'rule' | 'payee' | null
  /** La regle qui capte vise une categorie inconnue ou de revenus : ignoree. */
  ruleCategoryInvalid: boolean
}

export function testLabel(input: {
  label: string
  rules: readonly Rule[]
  payees: readonly PayeeDefault[]
  categories: readonly Category[]
}): LabelTest {
  const normalized = normalizeLabel(input.label)
  const known = new Set(input.categories.filter((c) => !c.isIncome).map((c) => c.id))
  const compiled = compileRules(input.rules)
  const index = compiled.findIndex((c) => matchNormalized(normalized, c.rule.matcher.op, c.needle))
  const rule = index >= 0 ? compiled[index]!.rule : null
  const key = payeeKey(input.label)
  const payeeCategoryId = key ? (input.payees.find((p) => p.key === key)?.categoryId ?? null) : null
  // Meme logique que le serveur : une regle qui capte decide seule (pas de
  // repli sur la memoire si sa categorie n'est plus valide).
  let categoryId: string | null = null
  let source: LabelTest['source'] = null
  if (rule) {
    if (known.has(rule.categoryId)) {
      categoryId = rule.categoryId
      source = 'rule'
    }
  } else if (payeeCategoryId && known.has(payeeCategoryId)) {
    categoryId = payeeCategoryId
    source = 'payee'
  }
  return {
    normalized,
    rule,
    rank: rule ? index + 1 : null,
    payeeKey: key,
    payeeCategoryId,
    categoryId,
    source,
    ruleCategoryInvalid: rule !== null && !known.has(rule.categoryId),
  }
}

export function useLabelTest(label: string): LabelTest | null {
  const { data: rules } = useRules()
  const boot = useBootstrap().data
  return useMemo(() => {
    if (!label.trim()) return null
    return testLabel({ label, rules: rules ?? [], payees: boot?.payees ?? [], categories: boot?.categories ?? [] })
  }, [label, rules, boot?.payees, boot?.categories])
}

/** Libelles recents a tester en un geste : non categorises d'abord, tiers distincts. */
export function useLabelSamples(limit = 3): string[] {
  const { data: transactions } = useTransactions()
  const onBudgetIds = useOnBudgetIds()
  return useMemo(() => {
    if (!transactions) return []
    const pool = transactions
      .filter((t) => isRuleCandidate(t, onBudgetIds) && t.date <= today())
      .sort((a, b) => Number(Boolean(a.categoryId)) - Number(Boolean(b.categoryId)) || byRecency(a, b))
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of pool) {
      const key = payeeKeyOf(t) || normalizedLabelOf(t)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t.label)
      if (out.length >= limit) break
    }
    return out
  }, [transactions, onBudgetIds, limit])
}

// ---------------------------------------------------------------------------
// Couverture de la categorisation automatique (heros de la page Regles)
// ---------------------------------------------------------------------------

export interface AutomationStats {
  /** Depenses des 90 derniers jours sur les comptes budget, hors virement. */
  recent: number
  /** ... que les regles ou la memoire de tiers reconnaissent. */
  covered: number
  /** Non categorisees qu'« Appliquer » categoriserait maintenant. */
  applicable: number
}

const COVERAGE_DAYS = 90

export function useAutomationStats(): AutomationStats | null {
  const { data: transactions } = useTransactions()
  const { data: rules } = useRules()
  const boot = useBootstrap().data
  const onBudgetIds = useOnBudgetIds()
  return useMemo(() => {
    if (!transactions || !rules || !boot) return null
    const compiled = compileRules(rules)
    const known = new Set(boot.categories.filter((c) => !c.isIncome).map((c) => c.id))
    const payees = new Map(boot.payees.map((p) => [p.key, p.categoryId]))
    const cutoff = new Date(Date.now() - COVERAGE_DAYS * 86_400_000).toISOString().slice(0, 10)
    const now = today()
    let recent = 0
    let covered = 0
    let applicable = 0
    for (const t of transactions) {
      if (!isRuleCandidate(t, onBudgetIds)) continue
      const isRecentExpense = t.amount < 0 && t.date >= cutoff && t.date <= now
      if (!isRecentExpense && t.categoryId) continue
      const rule = firstMatch(normalizedLabelOf(t), compiled)
      const categoryId = rule ? rule.categoryId : (payees.get(payeeKeyOf(t)) ?? null)
      const recognized = categoryId !== null && known.has(categoryId)
      if (isRecentExpense) {
        recent += 1
        if (recognized) covered += 1
      }
      if (!t.categoryId && recognized) applicable += 1
    }
    return { recent, covered, applicable }
  }, [transactions, rules, boot, onBudgetIds])
}
