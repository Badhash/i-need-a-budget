// Analyse de depenses cote client, calculee sur l'historique complet en cache
// (useTransactions) : AUCUN appel reseau, meme au changement de mois ou de
// periode. On reprend EXACTEMENT les definitions du serveur (computeReports de
// l'Edge Function /api) pour rester coherent avec lui :
//  - perimetre budget : compte budget, hors virement entre comptes budget. Avec
//    un serveur qui annonce crossBudgetTransfers, la moitie cote budget d'un
//    virement budget <-> suivi compte comme une transaction ordinaire (regle
//    YNAB) ; sans le drapeau (serveur ancien), tout virement reste neutre ;
//  - depense : montant < 0, categorie non-revenu (ou sans categorie) ;
//  - revenu : categorie de revenus (quel que soit le signe) ;
//  - marchand : cle de tiers payeeKey (mots stables du libelle), repli sur le
//    libelle brut quand la cle est vide ; nom affiche = libelle brut le plus
//    frequent, raccourci par parseBankLabel. Un meme marchand porte donc le
//    meme nom partout sur la page (top marchands, prelevements, jours,
//    suggestions), comme dans les rapports du serveur recent.
// Tous les montants sont en centimes ; les depenses sont exprimees en valeur
// ABSOLUE positive (plus lisible pour l'UI).
//
// Module pur (aucune dependance React) : entree = transactions + taxonomie +
// mois de reference + periode, sortie = un objet d'analyse memoise par la page.

import { isCrossBudgetHalf, type Bootstrap } from '@/lib/data'
import type { CategoryGroup, Transaction } from '@/types/domain'
import { addMonths, fmtEUR, fmtMonthLong, monthOf, monthRange } from '@/lib/format'
import { parseBankLabel } from '@/lib/bankLabel'
import { payeeKey } from '../../../packages/crypto/src/payee'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Periode de comparaison : nombre de mois COMPLETS precedant le mois affiche. */
export type ReportPeriod = 3 | 6 | 12
export const REPORT_PERIODS: readonly ReportPeriod[] = [3, 6, 12]
export const DEFAULT_REPORT_PERIOD: ReportPeriod = 6

export interface TaxonomyLite {
  onBudget: ReadonlySet<string> // ids de comptes budget
  incomeCats: ReadonlySet<string> // ids de categories de revenus
  categories: ReadonlyMap<string, { name: string; groupId: string }>
  groups: ReadonlyMap<string, CategoryGroup>
}

export interface AnalyticsOptions {
  period: ReportPeriod
  /** Serveur recent (crossBudgetTransfers) : moitie budget d'un virement budget <-> suivi comptee. */
  crossBudget: boolean
}

export interface MonthPoint {
  month: string
  income: number
  spending: number
  net: number
}

/** Point du cumul journalier des depenses (null = pas de donnee ce jour-la). */
export interface DailyPoint {
  day: number
  current: number | null
  average: number | null
}

export interface GroupSlice {
  key: string // id de groupe, UNCAT_KEY (a categoriser) ou REST_KEY (regroupement)
  label: string
  group: CategoryGroup | null
  total: number
  share: number // 0..1 de la depense du mois
}

export interface CategoryStat {
  id: string // id de categorie ou UNCAT_KEY
  name: string
  group: CategoryGroup | null
  thisMonth: number
  average: number // moyenne des mois de la periode (0 sans historique)
  delta: number // thisMonth - average
}

export interface MerchantStat {
  key: string
  label: string // libelle court (parseBankLabel du libelle brut le plus frequent)
  initial: string // initiale de la pastille
  group: CategoryGroup | null // groupe dominant (couleur de la pastille)
  total: number
  count: number
}

export interface RecurringCharge {
  key: string
  label: string
  initial: string
  group: CategoryGroup | null
  monthly: number // montant actuel (mediane des 3 derniers prelevements)
  months: number // nombre de mois ou il apparait sur 12 mois
}

export interface BigTx {
  tx: Transaction
  label: string
  amount: number // positif
  categoryName: string | null
  group: CategoryGroup | null
}

export type SuggestionKind = 'subscriptions' | 'rise' | 'trim' | 'habit'

export interface Suggestion {
  id: string
  kind: SuggestionKind
  title: string
  detail: string
  annual: number // economie annuelle potentielle estimee (centimes)
}

export interface Averages {
  spending: number
  income: number
  net: number
  savingsRate: number | null // taux agrege sur la periode (null sans revenu)
}

export interface WeekdayStats {
  /** Depense moyenne par jour de semaine (lun..dim), hors prelevements recurrents. */
  average: number[]
  peak: number | null // index du jour le plus depensier
  peakMerchant: string | null // marchand principal de ce jour-la
  days: number // nombre de jours observes
}

export interface Analytics {
  reference: string
  period: ReportPeriod
  isCurrentMonth: boolean
  hasData: boolean // au moins une transaction
  hasActivity: boolean // depense ou revenu sur le mois de reference
  months: string[] // mois des graphes : periode + reference, sans les mois anterieurs aux donnees
  averageMonths: string[] // mois pris en compte dans les moyennes
  monthly: MonthPoint[] // un point par mois de `months`
  spending: number
  income: number
  net: number
  savingsRate: number | null // null sans revenu
  average: Averages | null // null sans historique comparable
  /** Mois courant uniquement : cumul a date et cumul moyen a la meme date. */
  toDate: {
    day: number
    spending: number
    averageSpending: number | null
    net: number
    averageNet: number | null
  } | null
  projectedSpending: number | null // mois courant uniquement
  previousSpending: number | null // mois precedent (a date si mois courant), null sans donnees
  daily: DailyPoint[]
  byGroup: GroupSlice[]
  byCategory: CategoryStat[]
  merchants: MerchantStat[]
  recurring: RecurringCharge[]
  recurringMonthly: number
  biggest: BigTx[]
  weekday: WeekdayStats
  suggestions: Suggestion[]
  netWorth: { month: string; value: number }[] // un point par mois de `months`
  /** Solde de chaque compte a la fin du mois de reference. */
  balances: ReadonlyMap<string, number>
}

export const UNCAT_KEY = '__uncat__'
export const REST_KEY = '__rest__'
// Categorie inconnue de la taxonomie (groupe supprime) : part nommee « Autre ».
const UNKNOWN_KEY = '__unknown__'

// Detection des prelevements recurrents (voir detectRecurring).
const DETECTION_MONTHS = 12
const MAX_AMOUNT_CV = 0.15
const MIN_SINGLE_SHARE = 0.75
// Au-dela, un prelevement est une charge fixe (loyer, credit), pas un abonnement.
const SMALL_SUBSCRIPTION = 6_000
// Donut : au-dela, les plus petits groupes sont regroupes en « Autres ».
const MAX_SLICES = 6

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Jour de semaine d'une date 'YYYY-MM-DD' (0 = lundi). Calcul UTC : aucun decalage de fuseau. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

function isoPlusDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length
}

function bump<K>(map: Map<K, number>, key: K, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta)
}

function nested<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key)
  if (value === undefined) {
    value = create()
    map.set(key, value)
  }
  return value
}

// Prefixes de moyen de paiement que parseBankLabel conserve (« CB », « PRLV
// SEPA », « VIR SEPA VERS ») : sans valeur dans une liste de marchands.
const PAYMENT_PREFIX = /^(?:(?:cb|prlv|sepa|vir|carte|vers)\s+)+/i

/** Nom affiche d'un marchand : libelle raccourci par parseBankLabel, sans prefixe de paiement. */
export function merchantLabel(raw: string): string {
  const short = parseBankLabel(raw).short
  const trimmed = short.replace(PAYMENT_PREFIX, '').trim()
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : short
}

/** Cle de marchand : cle de tiers (payeeKey) ou, a defaut, le libelle brut (prefixes distincts). */
export function merchantKey(label: string): string {
  const key = payeeKey(label)
  return key ? `payee:${key}` : `label:${label}`
}

// Libelle le plus frequent (egalite : ordre lexical, resultat stable), meme
// regle que le serveur.
function mostFrequent(labels: Map<string, number> | undefined): string {
  let best = ''
  let bestCount = 0
  for (const [label, count] of labels ?? []) {
    if (count > bestCount || (count === bestCount && label < best)) {
      best = label
      bestCount = count
    }
  }
  return best
}

function argMax<K>(map: Map<K, number> | undefined): K | null {
  let best: K | null = null
  let bestValue = -Infinity
  for (const [key, value] of map ?? []) {
    if (value > bestValue) {
      best = key
      bestValue = value
    }
  }
  return best
}

/** Groupe « Epargne » (cle d'icone historique 'piggy', rendue en pousse). */
export function isSavingsGroup(group: CategoryGroup | null | undefined): boolean {
  return group?.icon === 'piggy'
}

/** 'ce mois-ci' pour le mois courant, sinon 'en août 2026'. */
export function inMonth(month: string, current: string): string {
  return month === current ? 'ce mois-ci' : `en ${fmtMonthLong(month)}`
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })
}

/** Plage de mois lisible : 'de juin à août 2026', 'd’octobre 2025 à janvier 2026', 'd’août 2026'. */
export function monthsRangePhrase(first: string, last: string): string {
  const sameYear = first.slice(0, 4) === last.slice(0, 4)
  const from = first === last ? fmtMonthLong(first) : sameYear ? monthName(first) : fmtMonthLong(first)
  const de = /^[aeiouyàâéèêh]/i.test(from) ? 'd’' : 'de '
  return first === last ? `${de}${from}` : `${de}${from} à ${fmtMonthLong(last)}`
}

/** Taxonomie allegee derivee du cache bootstrap. */
export function taxonomyFrom(boot: Bootstrap): TaxonomyLite {
  return {
    onBudget: new Set(boot.accounts.filter((a) => a.onBudget).map((a) => a.id)),
    incomeCats: new Set(boot.categories.filter((c) => c.isIncome).map((c) => c.id)),
    categories: new Map(boot.categories.map((c) => [c.id, { name: c.name, groupId: c.groupId }])),
    groups: new Map(boot.groups.map((g) => [g.id, g])),
  }
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

export function computeAnalytics(
  txs: Transaction[],
  taxo: TaxonomyLite,
  reference: string,
  today: string,
  { period, crossBudget }: AnalyticsOptions,
): Analytics {
  const onBudget = (accountId: string) => taxo.onBudget.has(accountId)
  const counted = (t: Transaction) =>
    onBudget(t.accountId) && (!t.transferGroupId || (crossBudget && isCrossBudgetHalf(t, onBudget, txs)))
  const groupOfCategory = (categoryId: string | null): CategoryGroup | null => {
    if (!categoryId) return null
    const groupId = taxo.categories.get(categoryId)?.groupId
    return groupId ? (taxo.groups.get(groupId) ?? null) : null
  }

  const currentMonth = monthOf(today)
  const isCurrentMonth = reference === currentMonth
  const refDays = daysIn(reference)
  // Dernier jour ecoule du mois de reference (mois courant : aujourd'hui).
  const refLastDay = isCurrentMonth ? Math.min(Number(today.slice(8, 10)), refDays) : refDays
  const refEnd = `${reference}-${String(refDays).padStart(2, '0')}`

  // Fenetres : periode de comparaison (P mois complets + reference) et
  // detection des prelevements (12 mois glissants, independante de P).
  const periodStart = addMonths(reference, -period)
  const detectStart = addMonths(reference, -(DETECTION_MONTHS - 1))
  const scanStart = periodStart < detectStart ? periodStart : detectStart
  const windowMonths = monthRange(periodStart, reference)

  let firstDate: string | null = null
  const spendByMonth = new Map<string, number>()
  const incomeByMonth = new Map<string, number>()
  // Mouvements par jour (index 1..31) des mois de la periode : cumuls « a date ».
  const dailySpend = new Map<string, number[]>()
  const dailyIncome = new Map<string, number[]>()
  const catByMonth = new Map<string, Map<string, number>>() // mois -> categorie -> depense
  const labelsByMerchant = new Map<string, Map<string, number>>() // marchand -> libelle brut -> occurrences
  const groupsByMerchant = new Map<string, Map<string, number>>() // marchand -> groupe -> depense
  const chargesByMerchant = new Map<string, Map<string, number[]>>() // marchand -> mois -> prelevements
  const merchantsByCategory = new Map<string, Map<string, number>>() // categorie -> marchand -> depense
  const monthMerchants = new Map<string, { total: number; count: number }>()
  const monthGroups = new Map<string, number>()
  const weekdayCandidates: { date: string; spent: number; key: string }[] = []
  const bigCandidates: Transaction[] = []
  // Valeur nette : tout ce qui precede la fenetre + deltas mensuels ; soldes par
  // compte a la fin du mois de reference.
  let baseline = 0
  const netDelta = new Map<string, number>()
  const balances = new Map<string, number>()

  const newDays = () => new Array<number>(32).fill(0)

  for (const t of txs) {
    const m = monthOf(t.date)
    if (firstDate === null || t.date < firstDate) firstDate = t.date

    // Patrimoine : TOUTES les transactions (tous comptes, virements compris :
    // ils s'annulent entre comptes), jusqu'a la fin du mois de reference.
    if (t.date <= refEnd) {
      bump(balances, t.accountId, t.amount)
      if (m < periodStart) baseline += t.amount
      else bump(netDelta, m, t.amount)
    }

    if (!counted(t)) continue
    const inPeriod = m >= periodStart && m <= reference
    const day = Number(t.date.slice(8, 10))

    if (t.categoryId !== null && taxo.incomeCats.has(t.categoryId)) {
      bump(incomeByMonth, m, t.amount)
      if (inPeriod) nested(dailyIncome, m, newDays)[day]! += t.amount
      continue
    }
    // Remboursement sur une categorie de depense : ignore, comme le serveur.
    if (t.amount >= 0) continue

    const spent = -t.amount
    bump(spendByMonth, m, spent)
    if (m < scanStart || m > reference) continue

    const key = merchantKey(t.label)
    const catKey = t.categoryId ?? UNCAT_KEY
    const group = groupOfCategory(t.categoryId)
    bump(nested(labelsByMerchant, key, () => new Map()), t.label, 1)
    bump(nested(groupsByMerchant, key, () => new Map()), group?.id ?? UNCAT_KEY, spent)
    if (m >= detectStart) {
      nested(nested(chargesByMerchant, key, () => new Map<string, number[]>()), m, () => []).push(spent)
      bump(nested(merchantsByCategory, catKey, () => new Map()), key, spent)
    }
    if (inPeriod) {
      bump(nested(catByMonth, m, () => new Map()), catKey, spent)
      nested(dailySpend, m, newDays)[day]! += spent
      weekdayCandidates.push({ date: t.date, spent, key })
    }
    if (m === reference) {
      const merchant = nested(monthMerchants, key, () => ({ total: 0, count: 0 }))
      merchant.total += spent
      merchant.count += 1
      bump(monthGroups, t.categoryId ? (group?.id ?? UNKNOWN_KEY) : UNCAT_KEY, spent)
      bigCandidates.push(t)
    }
  }

  const firstMonth = firstDate ? monthOf(firstDate) : reference
  const spendOf = (m: string) => spendByMonth.get(m) ?? 0
  const incomeOf = (m: string) => incomeByMonth.get(m) ?? 0
  const active = (m: string) => spendOf(m) > 0 || incomeOf(m) !== 0

  // Mois des graphes (periode + reference), sans le vide anterieur aux donnees.
  const trimmed = windowMonths.filter((m) => m >= firstMonth)
  const months = trimmed.length > 0 ? trimmed : [reference]
  // Mois de comparaison : ceux de la periode qui ont une activite (on ne dilue
  // pas les moyennes avec des mois anterieurs au premier import).
  const averageMonths = windowMonths.filter((m) => m !== reference && m >= firstMonth && active(m))

  // --- Identite des marchands ------------------------------------------------
  const displayCache = new Map<string, string>()
  const displayName = (key: string): string => {
    let label = displayCache.get(key)
    if (label === undefined) {
      const raw = mostFrequent(labelsByMerchant.get(key)) || key.replace(/^(payee|label):/, '')
      label = merchantLabel(raw)
      displayCache.set(key, label)
    }
    return label
  }
  const initialOf = (key: string): string => displayName(key).match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
  const dominantGroup = (key: string): CategoryGroup | null => {
    const groupId = argMax(groupsByMerchant.get(key))
    return groupId && groupId !== UNCAT_KEY ? (taxo.groups.get(groupId) ?? null) : null
  }

  // --- Mois de reference -----------------------------------------------------
  const spending = spendOf(reference)
  const income = incomeOf(reference)
  const net = income - spending
  const savingsRate = income > 0 ? net / income : null

  let average: Averages | null = null
  if (averageMonths.length > 0) {
    const totalSpending = averageMonths.reduce((s, m) => s + spendOf(m), 0)
    const totalIncome = averageMonths.reduce((s, m) => s + incomeOf(m), 0)
    const avgSpending = Math.round(totalSpending / averageMonths.length)
    const avgIncome = Math.round(totalIncome / averageMonths.length)
    average = {
      spending: avgSpending,
      income: avgIncome,
      net: avgIncome - avgSpending,
      savingsRate: totalIncome > 0 ? (totalIncome - totalSpending) / totalIncome : null,
    }
  }

  // --- Cumuls journaliers ----------------------------------------------------
  const cumulative = (source: Map<string, number[]>, m: string, day: number): number => {
    const days = source.get(m)
    if (!days) return 0
    const last = Math.min(day, daysIn(m))
    let sum = 0
    for (let d = 1; d <= last; d++) sum += days[d]!
    return sum
  }
  const averageCumulative = (source: Map<string, number[]>, day: number): number | null =>
    averageMonths.length > 0 ? Math.round(mean(averageMonths.map((m) => cumulative(source, m, day)))) : null

  const refDaily = dailySpend.get(reference) ?? newDays()
  const daily: DailyPoint[] = []
  let running = 0
  for (let d = 1; d <= refDays; d++) {
    running += refDaily[d]!
    daily.push({
      day: d,
      current: d <= refLastDay ? running : null,
      average: averageCumulative(dailySpend, d),
    })
  }

  let toDate: Analytics['toDate'] = null
  let projectedSpending: number | null = null
  if (isCurrentMonth) {
    const spentToDate = cumulative(dailySpend, reference, refLastDay)
    const incomeToDate = cumulative(dailyIncome, reference, refLastDay)
    const avgSpentToDate = averageCumulative(dailySpend, refLastDay)
    const avgIncomeToDate = averageCumulative(dailyIncome, refLastDay)
    toDate = {
      day: refLastDay,
      spending: spentToDate,
      averageSpending: avgSpentToDate,
      net: incomeToDate - spentToDate,
      averageNet: avgSpentToDate === null || avgIncomeToDate === null ? null : avgIncomeToDate - avgSpentToDate,
    }
    // Projection : le reste du mois « comme d'habitude » (fin de mois moyenne
    // moins cumul moyen a date). Sans historique : extrapolation lineaire.
    projectedSpending =
      average && avgSpentToDate !== null
        ? spending + Math.max(0, average.spending - avgSpentToDate)
        : Math.round((spending / Math.max(1, refLastDay)) * refDays)
  }

  const previous = addMonths(reference, -1)
  const previousSpending =
    previous < firstMonth ? null : isCurrentMonth ? cumulative(dailySpend, previous, refLastDay) : spendOf(previous)

  // --- Repartition par groupe (donut) ----------------------------------------
  const slices: GroupSlice[] = []
  let uncatSlice: GroupSlice | null = null
  for (const [key, total] of monthGroups) {
    const group = taxo.groups.get(key) ?? null
    const slice: GroupSlice = {
      key,
      label: key === UNCAT_KEY ? 'À catégoriser' : (group?.name ?? 'Autre'),
      group,
      total,
      share: spending > 0 ? total / spending : 0,
    }
    if (key === UNCAT_KEY) uncatSlice = slice
    else slices.push(slice)
  }
  slices.sort((a, b) => b.total - a.total)
  // « À catégoriser » reste toujours visible (c'est une action a mener) ; au-dela
  // de 6 parts, les plus petits groupes nommes se fondent dans « Autres ».
  const namedRoom = MAX_SLICES - (uncatSlice ? 1 : 0)
  if (slices.length > namedRoom) {
    const rest = slices.splice(namedRoom - 1)
    const total = rest.reduce((s, x) => s + x.total, 0)
    slices.push({ key: REST_KEY, label: 'Autres', group: null, total, share: spending > 0 ? total / spending : 0 })
  }
  const byGroup = uncatSlice ? [...slices, uncatSlice] : slices

  // --- Categories : mois de reference vs moyenne -----------------------------
  const catIds = new Set<string>()
  for (const m of [...averageMonths, reference]) for (const id of catByMonth.get(m)?.keys() ?? []) catIds.add(id)
  const byCategory: CategoryStat[] = [...catIds].map((id) => {
    const thisMonth = catByMonth.get(reference)?.get(id) ?? 0
    const avg =
      averageMonths.length > 0 ? Math.round(mean(averageMonths.map((m) => catByMonth.get(m)?.get(id) ?? 0))) : 0
    return {
      id,
      name: id === UNCAT_KEY ? 'À catégoriser' : (taxo.categories.get(id)?.name ?? 'Autre'),
      group: id === UNCAT_KEY ? null : groupOfCategory(id),
      thisMonth,
      average: avg,
      delta: thisMonth - avg,
    }
  })
  byCategory.sort((a, b) => b.thisMonth - a.thisMonth || b.average - a.average)

  // --- Prelevements recurrents -------------------------------------------------
  const recurring = detectRecurring(chargesByMerchant, {
    reference,
    firstMonth,
    active,
    displayName,
    initialOf,
    dominantGroup,
  })
  const recurringKeys = new Set(recurring.map((r) => r.key))
  const recurringMonthly = recurring.reduce((s, r) => s + r.monthly, 0)
  // Categories faites surtout de prelevements (loyer, forfaits) : pas de
  // « rogner 10 % » dessus, ce ne sont pas des depenses d'habitude.
  const fixedCategories = new Set<string>()
  for (const [catKey, byMerchant] of merchantsByCategory) {
    let total = 0
    let fixed = 0
    for (const [key, value] of byMerchant) {
      total += value
      if (recurringKeys.has(key)) fixed += value
    }
    if (total > 0 && fixed / total >= 0.5) fixedCategories.add(catKey)
  }

  // --- Marchands du mois ------------------------------------------------------
  const merchants: MerchantStat[] = [...monthMerchants.entries()]
    .map(([key, v]) => ({
      key,
      label: displayName(key),
      initial: initialOf(key),
      group: dominantGroup(key),
      total: v.total,
      count: v.count,
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'fr'))

  // --- Plus grosses depenses ----------------------------------------------------
  const biggest: BigTx[] = bigCandidates
    .sort((a, b) => a.amount - b.amount || (a.date < b.date ? 1 : -1))
    .slice(0, 8)
    .map((t) => ({
      tx: t,
      label: displayName(merchantKey(t.label)),
      amount: -t.amount,
      categoryName: t.categoryId ? (taxo.categories.get(t.categoryId)?.name ?? null) : null,
      group: groupOfCategory(t.categoryId),
    }))

  // --- Jours de la semaine (habitudes : hors prelevements recurrents) --------
  const periodFirstDay = `${periodStart}-01`
  const weekday = computeWeekdays(weekdayCandidates, recurringKeys, {
    start: firstDate && firstDate > periodFirstDay ? firstDate : periodFirstDay,
    end: refEnd < today ? refEnd : today,
    displayName,
  })

  // --- Series mensuelles et patrimoine ------------------------------------------
  const monthly: MonthPoint[] = months.map((m) => ({
    month: m,
    income: incomeOf(m),
    spending: spendOf(m),
    net: incomeOf(m) - spendOf(m),
  }))
  let wealth = baseline
  const wealthByMonth = new Map<string, number>()
  for (const m of windowMonths) {
    wealth += netDelta.get(m) ?? 0
    wealthByMonth.set(m, wealth)
  }
  const netWorth = months.map((m) => ({ month: m, value: wealthByMonth.get(m) ?? baseline }))

  const suggestions = buildSuggestions({
    reference,
    currentMonth,
    byCategory,
    merchants,
    recurring,
    recurringKeys,
    fixedCategories,
  })

  return {
    reference,
    period,
    isCurrentMonth,
    hasData: firstDate !== null,
    hasActivity: active(reference),
    months,
    averageMonths,
    monthly,
    spending,
    income,
    net,
    savingsRate,
    average,
    toDate,
    projectedSpending,
    previousSpending,
    daily,
    byGroup,
    byCategory,
    merchants,
    recurring,
    recurringMonthly,
    biggest,
    weekday,
    suggestions,
    netWorth,
    balances,
  }
}

// ---------------------------------------------------------------------------
// Prelevements recurrents
// ---------------------------------------------------------------------------
//
// Un marchand est un prelevement recurrent s'il revient sur au moins la moitie
// des mois actifs (3 au minimum), UNE fois par mois (au moins 3 mois sur 4 :
// plusieurs passages par mois = une habitude, pas un prelevement), pour un
// montant stable (coefficient de variation <= 15 %), et s'il est toujours
// actif (vu le mois de reference ou le precedent : sinon il a ete resilie).

function detectRecurring(
  charges: Map<string, Map<string, number[]>>,
  ctx: {
    reference: string
    firstMonth: string
    active: (m: string) => boolean
    displayName: (key: string) => string
    initialOf: (key: string) => string
    dominantGroup: (key: string) => CategoryGroup | null
  },
): RecurringCharge[] {
  const detectMonths = monthRange(addMonths(ctx.reference, -(DETECTION_MONTHS - 1)), ctx.reference)
  const activeMonths = detectMonths.filter((m) => m !== ctx.reference && m >= ctx.firstMonth && ctx.active(m)).length
  const minMonths = Math.max(3, Math.ceil(activeMonths / 2))
  const lastAllowed = addMonths(ctx.reference, -1)

  const recurring: RecurringCharge[] = []
  for (const [key, byMonth] of charges) {
    const seen = [...byMonth.keys()].sort()
    if (seen.length < minMonths || seen[seen.length - 1]! < lastAllowed) continue
    const single = seen.filter((m) => byMonth.get(m)!.length === 1).length
    if (single / seen.length < MIN_SINGLE_SHARE) continue
    const amounts = seen.flatMap((m) => byMonth.get(m)!)
    const avg = mean(amounts)
    if (avg <= 0) continue
    const deviation = Math.sqrt(mean(amounts.map((v) => (v - avg) ** 2)))
    if (deviation / avg > MAX_AMOUNT_CV) continue
    recurring.push({
      key,
      label: ctx.displayName(key),
      initial: ctx.initialOf(key),
      group: ctx.dominantGroup(key),
      monthly: median(seen.slice(-3).flatMap((m) => byMonth.get(m)!)),
      months: seen.length,
    })
  }
  return recurring.sort((a, b) => b.monthly - a.monthly || a.label.localeCompare(b.label, 'fr'))
}

// ---------------------------------------------------------------------------
// Jours de la semaine
// ---------------------------------------------------------------------------
//
// Depense moyenne PAR JOUR CALENDAIRE de chaque jour de semaine (total des
// samedis / nombre de samedis de la fenetre), hors prelevements recurrents et
// hors journees exceptionnelles (les 10 % de journees les plus chargees de
// chaque jour de semaine : voyage, gros achat) : on mesure des habitudes, pas
// la date d'un loyer ni un billet d'avion.

const EXCEPTIONAL_DAYS = 0.1

function computeWeekdays(
  candidates: { date: string; spent: number; key: string }[],
  recurringKeys: ReadonlySet<string>,
  { start, end, displayName }: { start: string; end: string; displayName: (key: string) => string },
): WeekdayStats {
  const dayTotals = new Map<string, number>()
  const dayMerchants = new Map<string, Map<string, number>>()
  for (const c of candidates) {
    if (c.date < start || c.date > end || recurringKeys.has(c.key)) continue
    bump(dayTotals, c.date, c.spent)
    bump(nested(dayMerchants, c.date, () => new Map()), c.key, c.spent)
  }
  const datesByWeekday: string[][] = Array.from({ length: 7 }, () => [])
  let days = 0
  if (start <= end) {
    for (let d = start; d <= end; d = isoPlusDays(d, 1)) {
      datesByWeekday[weekdayOf(d)]!.push(d)
      days++
    }
  }
  const totalOf = (d: string) => dayTotals.get(d) ?? 0
  const kept = datesByWeekday.map((dates) =>
    [...dates].sort((x, y) => totalOf(y) - totalOf(x)).slice(Math.floor(dates.length * EXCEPTIONAL_DAYS)),
  )
  const average = kept.map((dates) =>
    dates.length > 0 ? Math.round(dates.reduce((s, d) => s + totalOf(d), 0) / dates.length) : 0,
  )
  let peak: number | null = null
  for (let i = 0; i < 7; i++) {
    if (average[i]! > 0 && (peak === null || average[i]! > average[peak]!)) peak = i
  }
  let peakMerchant: string | null = null
  if (peak !== null) {
    const merchants = new Map<string, number>()
    for (const d of kept[peak]!) for (const [key, v] of dayMerchants.get(d) ?? []) bump(merchants, key, v)
    const topKey = argMax(merchants)
    peakMerchant = topKey ? displayName(topKey) : null
  }
  return { average, peak, peakMerchant, days }
}

// ---------------------------------------------------------------------------
// Suggestions d'economies (triees par impact annuel decroissant)
// ---------------------------------------------------------------------------
//
// Ton encourageant, jamais culpabilisant, et chiffres honnetes : on ne propose
// que de l'actionnable (jamais « rogner le loyer » ni l'epargne).

function buildSuggestions(ctx: {
  reference: string
  currentMonth: string
  byCategory: CategoryStat[]
  merchants: MerchantStat[]
  recurring: RecurringCharge[]
  recurringKeys: ReadonlySet<string>
  fixedCategories: ReadonlySet<string>
}): Suggestion[] {
  const out: Suggestion[] = []
  const when = inMonth(ctx.reference, ctx.currentMonth)
  const When = when.charAt(0).toUpperCase() + when.slice(1)

  // Abonnements : petits prelevements (hors epargne), le plus cher en exemple.
  const subscriptions = ctx.recurring.filter((r) => r.monthly <= SMALL_SUBSCRIPTION && !isSavingsGroup(r.group))
  if (subscriptions.length >= 2) {
    const total = subscriptions.reduce((s, r) => s + r.monthly, 0)
    const top = subscriptions[0]!
    out.push({
      id: 'subscriptions',
      kind: 'subscriptions',
      title: `${subscriptions.length} abonnements, ${fmtEUR(total)} par mois`,
      detail: `Le plus cher, ${top.label}, revient à ${fmtEUR(top.monthly * 12)} par an. Toujours indispensable ?`,
      annual: top.monthly * 12,
    })
  }

  const eligible = ctx.byCategory.filter((c) => c.id !== UNCAT_KEY && !isSavingsGroup(c.group))

  // Categories nettement au-dessus de leur moyenne.
  const risers = eligible
    .filter((c) => c.average > 0 && c.delta > Math.max(2_000, c.average * 0.2))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
  for (const c of risers) {
    out.push({
      id: `rise-${c.id}`,
      kind: 'rise',
      title: `${c.name} en hausse`,
      detail: `${When} : ${fmtEUR(c.thisMonth)} contre ${fmtEUR(c.average)} en moyenne. Revenir à ta moyenne libère ${fmtEUR(c.delta)} par mois.`,
      annual: c.delta * 12,
    })
  }

  // Plus gros poste VARIABLE (hors categories faites de prelevements fixes).
  const trim = eligible
    .filter((c) => c.average >= 5_000 && !ctx.fixedCategories.has(c.id) && !risers.some((r) => r.id === c.id))
    .sort((a, b) => b.average - a.average)[0]
  if (trim) {
    out.push({
      id: `trim-${trim.id}`,
      kind: 'trim',
      title: `Rogner 10 % sur ${trim.name}`,
      detail: `C’est ton plus gros poste variable (${fmtEUR(trim.average)} par mois en moyenne) : 10 % de moins suffit à faire une vraie différence sur l’année.`,
      annual: Math.round(trim.average * 0.1) * 12,
    })
  }

  // Petits achats frequents chez un meme marchand (hors prelevements).
  const habit = ctx.merchants
    .filter(
      (m) => m.count >= 4 && m.total / m.count <= 1_500 && !ctx.recurringKeys.has(m.key) && !isSavingsGroup(m.group),
    )
    .sort((a, b) => b.total - a.total)[0]
  if (habit) {
    out.push({
      id: `habit-${habit.key}`,
      kind: 'habit',
      title: `Petits achats chez ${habit.label}`,
      detail: `${habit.count} passages ${when} pour ${fmtEUR(habit.total)}. En sauter un sur deux, c’est ${fmtEUR(Math.round(habit.total / 2))} de gagnés par mois.`,
      annual: Math.round(habit.total / 2) * 12,
    })
  }

  return out.sort((a, b) => b.annual - a.annual).slice(0, 4)
}
