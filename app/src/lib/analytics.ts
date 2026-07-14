// Analyse de depenses cote client, calculee sur l'historique complet en cache
// (useTransactions). On reprend EXACTEMENT la definition de "depense" du serveur
// (computeReports) pour rester coherent : montant < 0, hors transferts, compte
// on-budget, categorie non-revenu. Tous les montants sont en centimes ; les
// depenses sont exprimees en valeur ABSOLUE positive (plus lisible pour l'UI).
//
// Module pur (aucune dependance React) : entree = transactions + taxonomie,
// sortie = un objet d'analyse serialisable, memoise par la page.

import type { Transaction } from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import { addMonths, monthOf } from '@/lib/format'
import { parseBankLabel } from '@/lib/bankLabel'

export interface TaxonomyLite {
  onBudget: Set<string> // ids de comptes on-budget
  incomeCats: Set<string> // ids de categories de revenu
  catName: Map<string, string>
  catGroup: Map<string, string> // categoryId -> groupId
  groupName: Map<string, string>
  groupColor: Map<string, CatColor>
}

interface MonthPoint {
  month: string
  income: number
  spending: number
  net: number
}

interface CategoryStat {
  id: string
  name: string
  groupName: string
  color: CatColor | null
  thisMonth: number
  avgRecent: number // moyenne des mois COMPLETS de la fenetre (hors mois courant)
  // Variation du mois courant par rapport a la moyenne recente (>0 = plus cher).
  deltaVsAvg: number
}

interface Subscription {
  label: string
  monthly: number // montant mensuel median
  months: number // nombre de mois distincts ou il apparait
}

interface BigTx {
  id: string
  label: string
  amount: number // positif
  date: string
  categoryName: string | null
  color: CatColor | null
}

interface Suggestion {
  id: string
  title: string
  detail: string
  annual: number // economie annuelle potentielle estimee (centimes)
}

export interface Analytics {
  reference: string // mois de reference (mois affiche)
  isCurrentMonth: boolean
  months: string[] // fenetre glissante, du plus ancien au plus recent (mois courant inclus)
  monthly: MonthPoint[]
  currentSpending: number
  currentIncome: number
  avgSpending: number // moyenne des mois COMPLETS (hors courant)
  savingsRate: number // (revenu - depense) / revenu du mois de reference
  avgSavingsRate: number
  daysElapsed: number
  daysInMonth: number
  projectedSpending: number // projection fin de mois (si mois courant)
  byCategory: CategoryStat[] // trie par depense du mois decroissante
  subscriptions: Subscription[]
  subscriptionsMonthly: number
  biggest: BigTx[]
  weekday: number[] // 7 cases (lun..dim), depense moyenne par jour de semaine sur la fenetre
  suggestions: Suggestion[]
  netWorth: { month: string; value: number }[] // patrimoine a la fin de chaque mois de la fenetre
}

const WINDOW = 12 // mois glissants analyses

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!
}

function daysInMonthOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function computeAnalytics(
  txs: Transaction[],
  taxo: TaxonomyLite,
  reference: string,
  today: string,
): Analytics {
  const isSpending = (t: Transaction) =>
    t.amount < 0 &&
    !t.transferGroupId &&
    taxo.onBudget.has(t.accountId) &&
    (t.categoryId === null || !taxo.incomeCats.has(t.categoryId))

  const isIncome = (t: Transaction) =>
    t.amount > 0 &&
    !t.transferGroupId &&
    taxo.onBudget.has(t.accountId) &&
    t.categoryId !== null &&
    taxo.incomeCats.has(t.categoryId)

  // Fenetre de mois (du plus ancien au plus recent), mois de reference inclus.
  const months: string[] = []
  for (let i = WINDOW - 1; i >= 0; i--) months.push(addMonths(reference, -i))
  const inWindow = new Set(months)

  // Agregats par mois et par (mois, categorie).
  const spendingByMonth = new Map<string, number>()
  const incomeByMonth = new Map<string, number>()
  const spendByMonthCat = new Map<string, Map<string, number>>() // month -> catKey -> cents
  const byMerchantMonths = new Map<string, Map<string, number>>() // merchant -> month -> cents
  const weekdaySum = new Array(7).fill(0)
  const weekdayMonths: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>())
  const bigCandidates: BigTx[] = []

  // Valeur nette (patrimoine) : accumulee dans la MEME passe que le reste. Voir
  // le commentaire detaille plus bas, avant la construction de netWorth.
  // `baseline` = tout ce qui precede la fenetre ; `deltaByMonth` = delta mensuel.
  let baseline = 0
  const deltaByMonth = new Map<string, number>()

  const UNCAT = '__uncat__'

  for (const t of txs) {
    const m = monthOf(t.date)

    // Patrimoine : concerne TOUTES les transactions (y compris hors fenetre),
    // donc avant le filtre inWindow ci-dessous.
    if (m < months[0]!) baseline += t.amount
    else if (inWindow.has(m)) deltaByMonth.set(m, (deltaByMonth.get(m) ?? 0) + t.amount)

    if (!inWindow.has(m)) continue

    if (isIncome(t)) {
      incomeByMonth.set(m, (incomeByMonth.get(m) ?? 0) + t.amount)
      continue
    }
    if (!isSpending(t)) continue

    const spent = -t.amount
    spendingByMonth.set(m, (spendingByMonth.get(m) ?? 0) + spent)

    const catKey = t.categoryId ?? UNCAT
    let catMap = spendByMonthCat.get(m)
    if (!catMap) {
      catMap = new Map()
      spendByMonthCat.set(m, catMap)
    }
    catMap.set(catKey, (catMap.get(catKey) ?? 0) + spent)

    const merchant = parseBankLabel(t.label).short
    let mm = byMerchantMonths.get(merchant)
    if (!mm) {
      mm = new Map()
      byMerchantMonths.set(merchant, mm)
    }
    mm.set(m, (mm.get(m) ?? 0) + spent)

    // Jour de semaine (0 = lundi). Date locale a partir du 'YYYY-MM-DD'.
    const [yy, mo, dd] = t.date.split('-').map(Number)
    const wd = (new Date(yy, mo - 1, dd).getDay() + 6) % 7
    weekdaySum[wd] += spent
    weekdayMonths[wd]!.add(m)

    if (m === reference) {
      bigCandidates.push({
        id: t.id,
        label: parseBankLabel(t.label).short,
        amount: spent,
        date: t.date,
        categoryName: t.categoryId ? (taxo.catName.get(t.categoryId) ?? null) : null,
        color: t.categoryId
          ? (taxo.groupColor.get(taxo.catGroup.get(t.categoryId) ?? '') ?? null)
          : null,
      })
    }
  }

  // Valeur nette (patrimoine) a la fin de chaque mois : solde cumule de TOUS les
  // comptes. Le solde d'un compte = somme de ses transactions (le solde
  // d'ouverture est une transaction) ; on somme donc toutes les transactions
  // jusqu'a la fin du mois, tous comptes confondus (les virements internes
  // s'annulent, ce qui est correct pour un total patrimonial). baseline et
  // deltaByMonth sont alimentes dans la passe principale ci-dessus ; il ne reste
  // qu'a cumuler les deltas mensuels.
  const netWorth: { month: string; value: number }[] = []
  let running = baseline
  for (const m of months) {
    running += deltaByMonth.get(m) ?? 0
    netWorth.push({ month: m, value: running })
  }

  const monthly: MonthPoint[] = months.map((m) => {
    const income = incomeByMonth.get(m) ?? 0
    const spending = spendingByMonth.get(m) ?? 0
    return { month: m, income, spending, net: income - spending }
  })

  const currentSpending = spendingByMonth.get(reference) ?? 0
  const currentIncome = incomeByMonth.get(reference) ?? 0

  // Mois COMPLETS = tous les mois de la fenetre sauf le mois de reference.
  const pastMonths = months.filter((m) => m !== reference)
  // On ne compte que les mois ayant reellement de l'activite (depense ou revenu)
  // pour ne pas diluer les moyennes avec des mois anterieurs au 1er import.
  const activePast = pastMonths.filter(
    (m) => (spendingByMonth.get(m) ?? 0) > 0 || (incomeByMonth.get(m) ?? 0) > 0,
  )
  const avgSpending =
    activePast.length > 0
      ? Math.round(activePast.reduce((s, m) => s + (spendingByMonth.get(m) ?? 0), 0) / activePast.length)
      : 0

  const rateOf = (m: string) => {
    const inc = incomeByMonth.get(m) ?? 0
    return inc > 0 ? (inc - (spendingByMonth.get(m) ?? 0)) / inc : 0
  }
  const savingsRate = rateOf(reference)
  const avgSavingsRate =
    activePast.length > 0 ? activePast.reduce((s, m) => s + rateOf(m), 0) / activePast.length : 0

  // Stats par categorie (mois de reference + moyenne des mois actifs).
  const catIds = new Set<string>()
  for (const catMap of spendByMonthCat.values()) for (const k of catMap.keys()) catIds.add(k)
  const byCategory: CategoryStat[] = [...catIds].map((catKey) => {
    const thisMonth = spendByMonthCat.get(reference)?.get(catKey) ?? 0
    const past = activePast.map((m) => spendByMonthCat.get(m)?.get(catKey) ?? 0)
    const avgRecent = past.length > 0 ? Math.round(past.reduce((s, v) => s + v, 0) / past.length) : 0
    const groupId = catKey === UNCAT ? null : (taxo.catGroup.get(catKey) ?? null)
    return {
      id: catKey,
      name: catKey === UNCAT ? 'À catégoriser' : (taxo.catName.get(catKey) ?? 'Autre'),
      groupName: groupId ? (taxo.groupName.get(groupId) ?? '') : '',
      color: groupId ? (taxo.groupColor.get(groupId) ?? null) : null,
      thisMonth,
      avgRecent,
      deltaVsAvg: thisMonth - avgRecent,
    }
  })
  byCategory.sort((a, b) => b.thisMonth - a.thisMonth || b.avgRecent - a.avgRecent)

  // Abonnements probables : un marchand qui revient sur au moins la moitie des
  // mois actifs (min 3), avec un montant mensuel stable (coeff. de variation
  // faible). montant = mediane des montants mensuels observes.
  const minMonths = Math.max(3, Math.ceil(activePast.length / 2))
  const subscriptions: Subscription[] = []
  for (const [label, mm] of byMerchantMonths) {
    const amounts = [...mm.values()]
    if (amounts.length < minMonths) continue
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length
    if (mean <= 0) continue
    const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length
    const cv = Math.sqrt(variance) / mean
    if (cv > 0.25) continue // trop irregulier : ce n'est pas un abonnement
    subscriptions.push({ label, monthly: median(amounts), months: amounts.length })
  }
  subscriptions.sort((a, b) => b.monthly - a.monthly)
  const subscriptionsMonthly = subscriptions.reduce((s, x) => s + x.monthly, 0)

  const biggest = bigCandidates.sort((a, b) => b.amount - a.amount).slice(0, 6)

  const weekday = weekdaySum.map((sum, i) => {
    const n = weekdayMonths[i]!.size
    return n > 0 ? Math.round(sum / n) : 0
  })

  // Projection fin de mois (uniquement si on regarde le mois en cours).
  const isCurrentMonth = reference === monthOf(today)
  const daysInMonth = daysInMonthOf(reference)
  const daysElapsed = isCurrentMonth ? Number(today.slice(8, 10)) : daysInMonth
  const projectedSpending =
    isCurrentMonth && daysElapsed > 0
      ? Math.round((currentSpending / daysElapsed) * daysInMonth)
      : currentSpending

  // --- Suggestions d'economies (triees par impact annuel decroissant) --------
  const suggestions: Suggestion[] = []

  if (subscriptions.length > 0 && subscriptionsMonthly > 0) {
    suggestions.push({
      id: 'subs',
      title: `${subscriptions.length} abonnement${subscriptions.length > 1 ? 's' : ''} récurrent${subscriptions.length > 1 ? 's' : ''}`,
      detail:
        'Ces prélèvements reviennent chaque mois. En résilier ne serait-ce qu’un ou deux allège durablement le budget.',
      annual: subscriptionsMonthly * 12,
    })
  }

  // Categories en hausse : mois de reference nettement au-dessus de leur moyenne.
  const risers = byCategory
    .filter((c) => c.avgRecent > 0 && c.deltaVsAvg > Math.max(2000, c.avgRecent * 0.2))
    .sort((a, b) => b.deltaVsAvg - a.deltaVsAvg)
    .slice(0, 2)
  for (const c of risers) {
    suggestions.push({
      id: `rise-${c.id}`,
      title: `${c.name} en hausse`,
      detail: `Ce mois-ci ${Math.round((c.thisMonth / c.avgRecent - 1) * 100)} % au-dessus de ta moyenne. Revenir à la moyenne libèrerait cette somme.`,
      annual: c.deltaVsAvg * 12,
    })
  }

  // Plus gros poste recurrent : reduire de 10 % sa moyenne.
  const topRecurrent = byCategory.filter((c) => c.avgRecent > 0).sort((a, b) => b.avgRecent - a.avgRecent)[0]
  if (topRecurrent) {
    suggestions.push({
      id: `trim-${topRecurrent.id}`,
      title: `Rogner 10 % sur ${topRecurrent.name}`,
      detail: `C’est ton plus gros poste (${Math.round(topRecurrent.avgRecent / 100)} €/mois en moyenne). –10 % suffit à faire une vraie différence sur l’année.`,
      annual: Math.round(topRecurrent.avgRecent * 0.1) * 12,
    })
  }

  suggestions.sort((a, b) => b.annual - a.annual)

  return {
    reference,
    isCurrentMonth,
    months,
    monthly,
    currentSpending,
    currentIncome,
    avgSpending,
    savingsRate,
    avgSavingsRate,
    daysElapsed,
    daysInMonth,
    projectedSpending,
    byCategory,
    subscriptions: subscriptions.slice(0, 8),
    subscriptionsMonthly,
    biggest,
    weekday,
    suggestions: suggestions.slice(0, 4),
    netWorth,
  }
}
