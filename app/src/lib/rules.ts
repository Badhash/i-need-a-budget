// Regles de categorisation : consomme l'Edge Function /api (action listRules /
// createRule / updateRule / deleteRule / applyRulesToUncategorized). Aucune
// lecture directe des tables : tout passe par apiCall.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { apiCall } from '@/lib/api'

export interface RuleMatcher {
  field: 'label'
  op: 'contains' | 'equals' | 'startsWith'
  value: string
}

export interface Rule {
  id: string
  matcher: RuleMatcher
  categoryId: string
  priority: number
}

/** Verbes affiches pour chaque operateur (reutilises par le formulaire et la
 * phrase de chaque regle). */
export const RULE_OPS: { value: RuleMatcher['op']; label: string }[] = [
  { value: 'contains', label: 'contient' },
  { value: 'equals', label: 'est' },
  { value: 'startsWith', label: 'commence par' },
]

export function opLabel(op: RuleMatcher['op']): string {
  return RULE_OPS.find((o) => o.value === op)?.label ?? op
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
    .replace(/[\u0300-\u036f]/g, '')
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

export const RULES_KEY = ['rules'] as const

export async function fetchRules(): Promise<Rule[]> {
  const { rules } = await apiCall<{ rules: Rule[] }>('listRules')
  return rules
}

export function useRules(): UseQueryResult<Rule[]> {
  return useQuery({ queryKey: RULES_KEY, queryFn: fetchRules })
}

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

/**
 * Mutation partagee par la page Regles et la page Transactions : une seule
 * definition, donc un seul comportement.
 *
 * Categoriser en lot change des transactions dont on ne connait pas la liste
 * cote client : impossible de patcher le cache en optimiste comme pour une
 * categorisation ligne a ligne. On invalide donc les 4 clefs reellement
 * touchees (liste, activite des enveloppes, rapports, compteur « A
 * categoriser »). Refetch assume : l'action est rare et explicitement
 * declenchee, contrairement aux micro-actions qui restent optimistes.
 */
export function useApplyRules(): UseMutationResult<number, Error, void> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiApplyRules(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['budget'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
    },
  })
}
