// Perimetre des rapports : ce que les moyennes et les repartitions ignorent.
//
// Une vente d'appartement, le solde d'un credit ou l'achat d'une voiture
// faisaient exploser revenus, depenses et moyennes de toute la page. Trois
// mecanismes, appliques par computeAnalytics (le patrimoine, lui, compte
// toujours tout : c'est de l'argent reel) :
//
//  1. Virements internes non relies : une sortie d'un compte budget et une
//     entree du MEME montant sur un AUTRE compte budget, a 3 jours au plus
//     (un virement entre ses propres comptes importe des deux cotes sans etre
//     relie). Categorise d'un cote en depense et de l'autre en revenu, il
//     gonflait les deux. Les deux moitiees sont ecartees.
//  2. Operations exceptionnelles : une operation qui pese au moins la moitie
//     d'un mois habituel de depenses (un mois et demi pour un revenu : les
//     revenus varient plus, un 13e mois reste compte) ET qui ne revient pas
//     regulierement. Mois habituel = mediane des totaux mensuels sur 13 mois
//     centres sur l'operation, son propre mois compte sans elle. Reguliere =
//     son tiers (ou, pour une depense, sa categorie) a deja ce niveau sur au
//     moins 3 mois de la fenetre (montant sous 3 fois la mediane de leurs
//     totaux mensuels) : un releve de carte, un salaire ou des honoraires
//     variables, un loyer restent comptes. La categorie ne vaut pas pour un
//     revenu : tous les revenus tombent souvent dans une seule categorie, qui
//     ferait passer une vente pour un salaire.
//  3. Choix manuels (user_settings.reports, serveur annoncant reportSettings) :
//     une operation ecartee ou gardee a la main l'emporte sur la detection ; une
//     categorie « hors depenses » (epargne, investissement, argent mis de cote
//     pour un proche) n'est jamais une depense, comme un versement vers un
//     compte de suivi.
//
// Module pur (aucune dependance React), montants en centimes.

import type { Transaction } from '@/types/domain'
import type { ReportSettings } from '@/lib/data'
import { payeeKey } from '../../../packages/crypto/src/payee'
import { TRANSFER_PAIR_MAX_DAYS, dayGap } from '@/lib/transferPairs'

export type ExclusionReason = 'large' | 'internal' | 'manual'
export type FlowKind = 'spending' | 'income'

export interface ScopeItem {
  tx: Transaction
  reason: ExclusionReason
  /** true : ecartee des rapports ; false : detectee mais gardee a la main. */
  excluded: boolean
  /** Virement interne : l'autre moitie. */
  partner: Transaction | null
  kind: FlowKind | null
  /** Operation exceptionnelle : total d'un mois habituel du meme sens (centimes). */
  typical: number | null
}

export interface ReportScope {
  /** Transactions ignorees par les rapports (hors patrimoine). */
  excludedIds: ReadonlySet<string>
  /** Categories dont les sorties ne comptent pas comme des depenses. */
  excludedCategories: ReadonlySet<string>
  /** Tout ce qui a ete detecte ou choisi, garde ou non, du plus recent au plus ancien. */
  items: ScopeItem[]
}

export interface ScopeInput {
  /** Perimetre budget des rapports : compte budget, hors virement entre comptes budget. */
  counted: (t: Transaction) => boolean
  /** Versement vers l'epargne (moitie budget d'un virement croise sortant) : jamais une depense. */
  savingsOut: (t: Transaction) => boolean
  isIncomeCategory: (categoryId: string) => boolean
  /** Solde d'ouverture ou ajustement range en revenus : ni revenu ni operation. */
  isBalanceEntry: (t: Transaction) => boolean
  settings: ReportSettings
}

export const EMPTY_SCOPE: ReportScope = { excludedIds: new Set(), excludedCategories: new Set(), items: [] }

// Virements internes : montant minimal (les petites coincidences n'ont aucun
// effet visible). Ecart de dates maximal : TRANSFER_PAIR_MAX_DAYS (lib/transferPairs).
const INTERNAL_MIN = 1_000
// Operations exceptionnelles.
const LARGE_FLOOR = 50_000 // jamais en dessous de 500 EUR
const SHARE: Record<FlowKind, number> = { spending: 0.5, income: 1.5 }
const WINDOW = 6 // mois de part et d'autre
const REGULAR_MONTHS = 3
const REGULAR_FACTOR = 3

/** Cle de marchand : cle de tiers (payeeKey) ou, a defaut, le libelle brut. */
export function merchantKey(label: string): string {
  const key = payeeKey(label)
  return key ? `payee:${key}` : `label:${label}`
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!
}

/** Totaux mensuels d'une serie (marchand, categorie, sens) : index de mois -> total. */
type Series = Map<number, number>

function add(series: Map<string, Series>, key: string, month: number, amount: number): void {
  let s = series.get(key)
  if (!s) series.set(key, (s = new Map()))
  s.set(month, (s.get(month) ?? 0) + amount)
}

/** Valeurs mensuelles positives de la fenetre, le mois `own` compte sans `amount`. */
function windowValues(series: Series | undefined, center: number, own: number, amount: number): number[] {
  const values: number[] = []
  for (const [month, total] of series ?? []) {
    if (month < center - WINDOW || month > center + WINDOW) continue
    const value = month === own ? total - amount : total
    if (value > 0) values.push(value)
  }
  return values
}

function isRegular(series: Series | undefined, month: number, amount: number): boolean {
  const values = windowValues(series, month, month, amount)
  return values.length >= REGULAR_MONTHS && amount < REGULAR_FACTOR * median(values)
}

export function detectReportScope(txs: readonly Transaction[], input: ScopeInput): ReportScope {
  const { overrides } = input.settings
  const excludedCategories = new Set(input.settings.excludedCategories)
  const items: ScopeItem[] = []
  const seen = new Set<string>()
  const flagged = (t: Transaction) => overrides[t.id] !== 'include'

  const kindOf = (t: Transaction): FlowKind | null => {
    const income = t.categoryId !== null && input.isIncomeCategory(t.categoryId)
    if (income) return t.amount > 0 ? 'income' : null
    if (t.amount >= 0 || (t.categoryId !== null && excludedCategories.has(t.categoryId))) return null
    return 'spending'
  }

  const base = txs.filter((t) => input.counted(t) && !input.savingsOut(t) && !input.isBalanceEntry(t))

  // --- 1. Virements internes non relies ---------------------------------------
  const inflows = new Map<number, Transaction[]>()
  for (const t of base) {
    if (t.transferGroupId || t.amount < INTERNAL_MIN) continue
    const list = inflows.get(t.amount)
    if (list) list.push(t)
    else inflows.set(t.amount, [t])
  }
  const outflows = base
    .filter((t) => !t.transferGroupId && t.amount <= -INTERNAL_MIN && inflows.has(-t.amount))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  for (const out of outflows) {
    let best: Transaction | null = null
    let bestGap = Infinity
    for (const candidate of inflows.get(-out.amount) ?? []) {
      if (seen.has(candidate.id) || candidate.accountId === out.accountId) continue
      const gap = dayGap(candidate.date, out.date)
      if (gap <= TRANSFER_PAIR_MAX_DAYS && gap < bestGap) {
        best = candidate
        bestGap = gap
      }
    }
    if (!best) continue
    seen.add(out.id)
    seen.add(best.id)
    items.push({ tx: out, reason: 'internal', excluded: flagged(out), partner: best, kind: kindOf(out), typical: null })
    items.push({ tx: best, reason: 'internal', excluded: flagged(best), partner: out, kind: kindOf(best), typical: null })
  }

  // --- 2. Operations exceptionnelles -------------------------------------------
  const totals = new Map<string, Series>() // sens -> mois -> total
  const byMerchant = new Map<string, Series>()
  const byCategory = new Map<string, Series>()
  const flows: { t: Transaction; kind: FlowKind; amount: number; month: number }[] = []
  for (const t of base) {
    if (seen.has(t.id)) continue
    const kind = kindOf(t)
    if (!kind) continue
    const amount = Math.abs(t.amount)
    const month = monthIndex(t.date)
    flows.push({ t, kind, amount, month })
    add(totals, kind, month, amount)
    add(byMerchant, `${kind}|${merchantKey(t.label)}`, month, amount)
    if (t.categoryId) add(byCategory, `${kind}|${t.categoryId}`, month, amount)
  }
  for (const { t, kind, amount, month } of flows) {
    if (amount < LARGE_FLOOR) continue
    const months = windowValues(totals.get(kind), month, month, amount)
    const typical = months.length > 0 ? median(months) : 0
    if (amount < Math.max(LARGE_FLOOR, SHARE[kind] * typical)) continue
    if (isRegular(byMerchant.get(`${kind}|${merchantKey(t.label)}`), month, amount)) continue
    if (kind === 'spending' && t.categoryId && isRegular(byCategory.get(`${kind}|${t.categoryId}`), month, amount)) {
      continue
    }
    seen.add(t.id)
    items.push({ tx: t, reason: 'large', excluded: flagged(t), partner: null, kind, typical: Math.round(typical) })
  }

  // --- 3. Choix manuels ----------------------------------------------------------
  const byId = new Map(base.map((t) => [t.id, t]))
  for (const [id, flag] of Object.entries(overrides)) {
    const t = byId.get(id)
    if (flag !== 'exclude' || !t || seen.has(id)) continue
    seen.add(id)
    items.push({ tx: t, reason: 'manual', excluded: true, partner: null, kind: kindOf(t), typical: null })
  }

  items.sort((a, b) => (a.tx.date < b.tx.date ? 1 : a.tx.date > b.tx.date ? -1 : Math.abs(b.tx.amount) - Math.abs(a.tx.amount)))
  return {
    excludedIds: new Set(items.filter((i) => i.excluded).map((i) => i.tx.id)),
    excludedCategories,
    items,
  }
}
