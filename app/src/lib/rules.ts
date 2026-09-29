// Regles de categorisation : consomme l'Edge Function /api (action listRules /
// createRule / updateRule / deleteRule / applyRulesToUncategorized). Aucune
// lecture directe des tables : tout passe par apiCall.
//
// Le front rejoue EXACTEMENT la correspondance du serveur : normalizeLabel du
// module crypto partage (meme fonction que /api et sync-bank), operateurs
// contains / equals / startsWith, aiguille vide = jamais, ordre d'evaluation
// priorite croissante puis id. L'apercu d'une regle, le testeur de libelle et
// la categorisation optimiste d'« Appliquer » en decoulent sans aucune lecture
// reseau supplementaire : tout vient du cache TanStack.
//
// Toutes les ecritures sont OPTIMISTES (cache patche dans onMutate, rollback
// discret dans onError) et serialisees par la file de mutations : aucune
// invalidation de ['rules'] en cas de succes, le cache est deja exact.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import { apiCall } from '@/lib/api'
import {
  BOOTSTRAP_KEY,
  TRANSACTIONS_KEY,
  countsAsUncategorized,
  patchUncategorizedCount,
  type Bootstrap,
} from '@/lib/data'
import { scheduleBudgetRefetch } from '@/lib/categorize'
import { enqueue, isTempId, newTempId, registerRealId, resolveId } from '@/lib/mutationQueue'
import { payeeKey } from '../../../packages/crypto/src/payee'

/**
 * Copie CONFORME de normalizeLabel (packages/crypto/src/index.ts), utilisee par
 * matchLabel dans /api et sync-bank : NFD, accents retires, caracteres de
 * controle -> espace, blancs reduits, trim, minuscules. Le module crypto
 * complet ne se compile pas avec les types DOM de l'app (Web Crypto) : la
 * fonction pure est dupliquee ici, a garder identique.
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface RuleMatcher {
  field: 'label'
  op: 'contains' | 'equals' | 'startsWith'
  value: string
}

export type RuleOp = RuleMatcher['op']

export interface Rule {
  id: string
  matcher: RuleMatcher
  categoryId: string
  priority: number
}

/** Longueur maximale d'une valeur de regle (requireText du serveur). */
export const RULE_VALUE_MAX = 200

/** Verbes affiches pour chaque operateur (reutilises par le formulaire et la
 * phrase de chaque regle). */
export const RULE_OPS: { value: RuleOp; label: string }[] = [
  { value: 'contains', label: 'contient' },
  { value: 'startsWith', label: 'commence par' },
  { value: 'equals', label: 'est' },
]

export function opLabel(op: RuleOp): string {
  return RULE_OPS.find((o) => o.value === op)?.label ?? op
}

// ---------------------------------------------------------------------------
// Correspondance (miroir exact de matchLabel dans supabase/functions/api)
// ---------------------------------------------------------------------------

/** Libelle et aiguille DEJA normalises : meme switch que le serveur. */
export function matchNormalized(haystack: string, op: RuleOp, needle: string): boolean {
  if (!needle) return false
  switch (op) {
    case 'contains':
      return haystack.includes(needle)
    case 'equals':
      return haystack === needle
    case 'startsWith':
      return haystack.startsWith(needle)
    default:
      return false
  }
}

/** Le libelle brut est-il capte par ce matcher ? (insensible casse/accents). */
export function matchLabel(label: string, matcher: Pick<RuleMatcher, 'op' | 'value'>): boolean {
  return matchNormalized(normalizeLabel(label), matcher.op, normalizeLabel(matcher.value))
}

/** Ordre d'evaluation du serveur (listRules, applyRules, sync-bank) : priorite
 * croissante, puis id. */
export function compareRules(a: { id: string; priority: number }, b: { id: string; priority: number }): number {
  return a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function sortRules<R extends { id: string; priority: number }>(rules: readonly R[]): R[] {
  return rules.slice().sort(compareRules)
}

/** Regle triee avec son aiguille deja normalisee (boucles sur tout le cache). */
export interface CompiledRule<R extends Rule = Rule> {
  rule: R
  needle: string
}

export function compileRules<R extends Rule>(rules: readonly R[]): CompiledRule<R>[] {
  return sortRules(rules).map((rule) => ({ rule, needle: normalizeLabel(rule.matcher.value) }))
}

/** Premiere regle (compilee) qui capte un libelle deja normalise. */
export function firstMatch<R extends Rule>(normalized: string, compiled: readonly CompiledRule<R>[]): R | undefined {
  return compiled.find((c) => matchNormalized(normalized, c.rule.matcher.op, c.needle))?.rule
}

/** Premiere regle qui capte un libelle brut, dans l'ordre du serveur. */
export function firstMatchingRule<R extends Rule>(label: string, rules: readonly R[]): R | undefined {
  return firstMatch(normalizeLabel(label), compileRules(rules))
}

/**
 * Transactions que les regles peuvent toucher : comptes budget (les comptes de
 * suivi ne se categorisent pas), hors virement. Meme filtre que
 * applyRulesToUncategorized et sync-bank.
 */
export function isRuleCandidate(t: Transaction, onBudgetIds: ReadonlySet<string>): boolean {
  return !t.transferGroupId && onBudgetIds.has(t.accountId)
}

/**
 * Plage [debut, fin) du libelle BRUT correspondant a l'aiguille, pour le
 * surlignage. La correspondance elle-meme reste celle de matchNormalized ; si
 * la normalisation caractere par caractere diverge de normalizeLabel (cas
 * exotiques), aucune plage n'est renvoyee plutot qu'une plage fausse.
 */
export function matchRange(label: string, op: RuleOp, value: string): [number, number] | null {
  const needle = normalizeLabel(value)
  if (!needle) return null
  const text: string[] = []
  const from: number[] = []
  const to: number[] = []
  let pendingSpace: number | null = null
  let index = 0
  for (const ch of label) {
    const start = index
    index += ch.length
    const piece = ch
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .toLowerCase()
    for (const c of piece) {
      if (/\s/.test(c)) {
        if (text.length > 0 && pendingSpace === null) pendingSpace = start
        continue
      }
      if (pendingSpace !== null) {
        text.push(' ')
        from.push(pendingSpace)
        to.push(start)
        pendingSpace = null
      }
      for (let k = 0; k < c.length; k += 1) {
        text.push(c[k]!)
        from.push(start)
        to.push(index)
      }
    }
  }
  const haystack = text.join('')
  if (haystack !== normalizeLabel(label)) return null
  let at = -1
  if (op === 'contains') at = haystack.indexOf(needle)
  else if (op === 'startsWith') at = haystack.startsWith(needle) ? 0 : -1
  else if (op === 'equals') at = haystack === needle ? 0 : -1
  if (at < 0) return null
  return [from[at]!, to[at + needle.length - 1]!]
}

// Mots que l'on ne veut pas voir devenir la valeur d'une regle (memes mots de
// bruit que la cle de tiers, cf. packages/crypto/src/payee.ts).
const RULE_NOISE_WORDS = new Set([
  'carte', 'cb', 'paiement', 'achat', 'prelevement', 'prlv', 'sepa', 'virement', 'vir',
  'emis', 'recu', 'de', 'du', 'le', 'la', 'les', 'en', 'votre', 'faveur', 'x',
])

/**
 * Propose la valeur d'une regle « contient » a partir d'un libelle BRUT : la
 * plus longue suite CONTIGUE de mots stables (sans chiffre, hors bruit). Le
 * serveur compare le libelle brut normalise (minuscules sans accents) a cette
 * valeur : un libelle court retravaille (« Edf Client », mots reordonnes,
 * points de suspension) ne matcherait jamais.
 */
export function ruleValueFromLabel(label: string): string {
  const tokens = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const stable = tokens.map((t) => !/\d/.test(t) && t.length > 1 && !RULE_NOISE_WORDS.has(t))
  let best: string[] = []
  let current: string[] = []
  tokens.forEach((t, i) => {
    if (stable[i]) {
      current.push(t)
      if (current.length > best.length) best = current.slice()
    } else {
      current = []
    }
  })
  if (best.length > 0) return best.join(' ')
  return tokens.find((t) => /[a-z]/.test(t)) ?? label.trim()
}

// ---------------------------------------------------------------------------
// Prediction de applyRulesToUncategorized (categorisation optimiste)
// ---------------------------------------------------------------------------

export interface PredictedCategorization {
  txId: string
  categoryId: string
  /** Regle qui decide, ou null = memoire de tiers (repli). */
  ruleId: string | null
}

/**
 * Rejoue applyRulesToUncategorized sur le cache : transactions non
 * categorisees des comptes budget, hors virement ; regles d'abord (ordre du
 * serveur), puis memoire de tiers ; categorie connue et hors revenus.
 */
export function predictApplyRules(input: {
  transactions: readonly Transaction[]
  rules: readonly Rule[]
  boot: Pick<Bootstrap, 'accounts' | 'categories' | 'payees'>
}): PredictedCategorization[] {
  const compiled = compileRules(input.rules)
  const onBudget = new Set(input.boot.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const known = new Set(input.boot.categories.filter((c) => !c.isIncome).map((c) => c.id))
  const payees = new Map(input.boot.payees.map((p) => [p.key, p.categoryId]))
  const out: PredictedCategorization[] = []
  for (const t of input.transactions) {
    if (t.categoryId || !isRuleCandidate(t, onBudget)) continue
    const rule = firstMatch(normalizeLabel(t.label), compiled)
    const categoryId = rule ? rule.categoryId : (payees.get(payeeKey(t.label)) ?? null)
    if (!categoryId || !known.has(categoryId)) continue
    out.push({ txId: t.id, categoryId, ruleId: rule?.id ?? null })
  }
  return out
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export const RULES_KEY = ['rules'] as const

export async function fetchRules(): Promise<Rule[]> {
  const { rules } = await apiCall<{ rules: Rule[] }>('listRules')
  return rules
}

export function useRules(): UseQueryResult<Rule[]> {
  return useQuery({ queryKey: RULES_KEY, queryFn: fetchRules })
}

/** Priorite d'une nouvelle regle : en fin de liste (max + 1), comme le serveur. */
export function nextRulePriority(rules: readonly Rule[] | undefined): number {
  return rules && rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 1 : 0
}

/** Une regle dont la creation n'est pas encore confirmee (id temporaire). */
export function isPendingRule(rule: Rule): boolean {
  return isTempId(rule.id)
}

// Cle de rendu stable : l'id temporaire d'une regle creee reste sa cle React
// apres confirmation (la ligne n'est ni remontee ni reanimee).
const renderKeys = new Map<string, string>()

export function ruleRenderKey(rule: Rule): string {
  return renderKeys.get(rule.id) ?? rule.id
}

// ---------------------------------------------------------------------------
// Appels /api
// ---------------------------------------------------------------------------

interface CreateRuleInput {
  matcher: RuleMatcher
  categoryId: string
  priority?: number
}

export async function apiCreateRule(input: CreateRuleInput): Promise<{ id: string }> {
  return apiCall<{ id: string }>('createRule', {
    matcher: input.matcher,
    categoryId: input.categoryId,
    priority: input.priority,
  })
}

interface UpdateRuleInput {
  id: string
  matcher: RuleMatcher
  categoryId: string
  priority: number
}

export async function apiUpdateRule(input: UpdateRuleInput): Promise<void> {
  await apiCall('updateRule', {
    id: input.id,
    matcher: input.matcher,
    categoryId: input.categoryId,
    priority: input.priority,
  })
}

export async function apiDeleteRule(id: string): Promise<void> {
  await apiCall('deleteRule', { id })
}

/** Applique les regles aux transactions non categorisees. Renvoie le nombre de
 * transactions effectivement categorisees. */
export async function apiApplyRules(): Promise<number> {
  const { categorized } = await apiCall<{ categorized: number }>('applyRulesToUncategorized')
  return categorized
}

// ---------------------------------------------------------------------------
// Mutations optimistes
// ---------------------------------------------------------------------------

function setRules(queryClient: QueryClient, update: (old: Rule[]) => Rule[]): void {
  queryClient.setQueryData<Rule[]>(RULES_KEY, (old) => (old ? sortRules(update(old)) : old))
}

/** Nouvelle regle prete a creer (id temporaire, priorite de fin de liste). */
export function draftRule(rules: readonly Rule[] | undefined, matcher: RuleMatcher, categoryId: string): Rule {
  return { id: newTempId(), matcher, categoryId, priority: nextRulePriority(rules) }
}

/** Creation : la regle apparait aussitot (id temporaire), l'id serveur la
 * remplace a la confirmation. Rollback = retrait de la ligne. */
export function useCreateRule(): UseMutationResult<string, Error, { rule: Rule }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ rule }: { rule: Rule }) =>
      enqueue(
        async () => {
          const { id } = await apiCreateRule({
            matcher: rule.matcher,
            categoryId: resolveId(rule.categoryId),
            priority: rule.priority,
          })
          registerRealId(rule.id, id)
          return id
        },
        { deps: [rule.categoryId] },
      ),
    onMutate: async ({ rule }) => {
      await queryClient.cancelQueries({ queryKey: RULES_KEY })
      setRules(queryClient, (old) => [...old.filter((r) => r.id !== rule.id), rule])
    },
    onSuccess: (id, { rule }) => {
      renderKeys.set(id, ruleRenderKey(rule))
      setRules(queryClient, (old) => old.map((r) => (r.id === rule.id ? { ...r, id } : r)))
    },
    onError: (_err, { rule }) => {
      setRules(queryClient, (old) => old.filter((r) => r.id !== rule.id))
    },
  })
}

/** Edition : la ligne change aussitot ; rollback = version precedente. */
export function useUpdateRule(): UseMutationResult<void, Error, { rule: Rule; previous: Rule }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ rule }: { rule: Rule; previous: Rule }) =>
      enqueue(
        () =>
          apiUpdateRule({
            id: resolveId(rule.id),
            matcher: rule.matcher,
            categoryId: resolveId(rule.categoryId),
            priority: rule.priority,
          }),
        { deps: [rule.id, rule.categoryId] },
      ),
    onMutate: async ({ rule }) => {
      await queryClient.cancelQueries({ queryKey: RULES_KEY })
      setRules(queryClient, (old) => old.map((r) => (r.id === rule.id ? rule : r)))
    },
    onError: (_err, { rule, previous }) => {
      setRules(queryClient, (old) => old.map((r) => (r.id === rule.id ? previous : r)))
    },
  })
}

/** Suppression : la ligne disparait aussitot ; rollback = reinsertion. */
export function useDeleteRule(): UseMutationResult<void, Error, { rule: Rule }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ rule }: { rule: Rule }) =>
      enqueue(() => apiDeleteRule(resolveId(rule.id)), { deps: [rule.id] }),
    onMutate: async ({ rule }) => {
      await queryClient.cancelQueries({ queryKey: RULES_KEY })
      setRules(queryClient, (old) => old.filter((r) => r.id !== rule.id))
    },
    onError: (_err, { rule }) => {
      setRules(queryClient, (old) => [...old.filter((r) => r.id !== rule.id), rule])
    },
  })
}

export interface PriorityChange {
  rule: Rule
  priority: number
}

/**
 * Changements de priorite pour echanger les regles aux positions i et j de la
 * liste TRIEE. Priorites distinctes : on echange les deux valeurs (2 ecritures).
 * Doublons (regles creees en parallele) : renumerotation 0..n-1 dans le nouvel
 * ordre, en n'ecrivant que les regles qui changent.
 */
export function swapPriorityChanges(sorted: readonly Rule[], i: number, j: number): PriorityChange[] {
  const a = sorted[i]
  const b = sorted[j]
  if (!a || !b || i === j) return []
  const distinct = new Set(sorted.map((r) => r.priority)).size === sorted.length
  if (distinct) {
    return [
      { rule: a, priority: b.priority },
      { rule: b, priority: a.priority },
    ]
  }
  const order = sorted.slice()
  order[i] = b
  order[j] = a
  return order
    .map((rule, index) => ({ rule, priority: index }))
    .filter((c) => c.rule.priority !== c.priority)
}

/**
 * Reordonnancement optimiste : l'ordre change dans le cache avant l'appel. Les
 * ecritures ne sont pas atomiques : en cas d'echec, rollback PUIS relecture
 * ciblee de ['rules'] (le serveur a pu en appliquer une partie).
 */
export function useReorderRules(): UseMutationResult<void, Error, { changes: PriorityChange[] }, { previous?: Rule[] }> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ changes }: { changes: PriorityChange[] }) =>
      enqueue(
        async () => {
          for (const c of changes) {
            await apiUpdateRule({
              id: resolveId(c.rule.id),
              matcher: c.rule.matcher,
              categoryId: resolveId(c.rule.categoryId),
              priority: c.priority,
            })
          }
        },
        { deps: changes.map((c) => c.rule.id) },
      ),
    onMutate: async ({ changes }) => {
      await queryClient.cancelQueries({ queryKey: RULES_KEY })
      const previous = queryClient.getQueryData<Rule[]>(RULES_KEY)
      const next = new Map(changes.map((c) => [c.rule.id, c.priority]))
      setRules(queryClient, (old) =>
        old.map((r) => {
          const priority = next.get(r.id)
          return priority === undefined ? r : { ...r, priority }
        }),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(RULES_KEY, ctx.previous)
      void queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

export interface ApplyRulesContext {
  /** Categorisations predites et appliquees au cache (null = cache incomplet). */
  predicted: Map<string, string> | null
  countDelta: number
}

/**
 * « Appliquer aux non categorisees », partage par la page Regles, la page
 * Transactions et la creation de regle.
 *
 * Optimiste : le cache sait deja ce que fera le serveur (predictApplyRules,
 * meme correspondance, meme repli sur la memoire de tiers). Les transactions
 * sont categorisees aussitot et le badge « À catégoriser » ajuste ; seul le
 * budget (agregats) est relu, de facon ciblee et coalescee. Si le serveur en
 * categorise un nombre different (cache incomplet ou perime), la liste et le
 * bootstrap sont relus. Serialise derriere les ecritures en vol : une regle
 * tout juste creee est bien connue du serveur quand il applique.
 *
 * meta.errorToast = false : chaque appelant affiche l'echec en ligne.
 */
export function useApplyRules(): UseMutationResult<number, Error, void, ApplyRulesContext> {
  const queryClient = useQueryClient()
  return useMutation({
    meta: { errorToast: false },
    mutationFn: () => enqueue(() => apiApplyRules()),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      const transactions = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)
      const rules = queryClient.getQueryData<Rule[]>(RULES_KEY)
      const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
      if (!transactions || !rules || !boot) return { predicted: null, countDelta: 0 }
      const predicted = new Map(
        predictApplyRules({ transactions, rules, boot }).map((p) => [p.txId, p.categoryId]),
      )
      let countDelta = 0
      for (const t of transactions) {
        const categoryId = predicted.get(t.id)
        if (!categoryId) continue
        const before = countsAsUncategorized(queryClient, t)
        const after = countsAsUncategorized(queryClient, { ...t, categoryId })
        countDelta += (after ? 1 : 0) - (before ? 1 : 0)
      }
      if (predicted.size > 0) {
        queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) =>
          old?.map((t) => {
            const categoryId = predicted.get(t.id)
            return categoryId && !t.categoryId ? { ...t, categoryId } : t
          }),
        )
        patchUncategorizedCount(queryClient, countDelta)
      }
      return { predicted, countDelta }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.predicted || ctx.predicted.size === 0) return
      // Rollback cible : seules les transactions encore dans la categorie
      // predite repassent a « non categorisee ».
      const predicted = ctx.predicted
      queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) =>
        old?.map((t) => (predicted.get(t.id) === t.categoryId ? { ...t, categoryId: null } : t)),
      )
      patchUncategorizedCount(queryClient, -ctx.countDelta)
    },
    onSuccess: (categorized, _vars, ctx) => {
      if (!ctx?.predicted || ctx.predicted.size !== categorized) {
        void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY })
        void queryClient.invalidateQueries({ queryKey: BOOTSTRAP_KEY })
      }
      if (categorized > 0) scheduleBudgetRefetch(queryClient)
    },
  })
}
