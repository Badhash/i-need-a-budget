// Moteur d'enveloppes (regles YNAB) — TypeScript pur, zero dependance.
// Source de verite : section "Spec du moteur d'enveloppes" du CLAUDE.md.
//
// Invariants :
//   available(M) = rollover(M) + assigned(M) + activity(M)
//   rollover(M)  = max(available(M-1), 0)   (l'overspending ne se reporte pas)
//   RTA(M)       = inflows cumules <= M
//                  - assigned cumules <= M
//                  - assigned des mois futurs (> M)
//                  - somme des overspending des mois < M
//
// Nouveau budget (startMonth optionnel) : tout ce qui precede startMonth est
// gele. Les transactions des comptes on-budget anterieures a startMonth ne
// forment plus qu'un SOLDE DE DEPART (somme brute, transferts et non
// categorisees compris) verse au RTA de startMonth ; les assignations et
// l'activite anterieures sont ignorees. Ainsi RTA(startMonth) = solde des
// comptes budget au 1er du mois, et l'identite YNAB tient a partir de la :
// comptes budget = RTA + somme des disponibles + non categorisees.
//
// Tous les montants sont en centimes (entiers), depenses negatives.
// Les mois sont des chaines au format YYYY-MM, comparables lexicalement.

export interface Account {
  id: string
  /** false = compte de suivi (tracking) : exclu de l'activity et du RTA */
  onBudget: boolean
}

export interface Category {
  id: string
  /** true = categorie de revenus : ses transactions alimentent le RTA */
  isIncome: boolean
}

export interface Transaction {
  id: string
  accountId: string
  /** null = a categoriser : ignoree par les enveloppes et le RTA */
  categoryId: string | null
  /** mois comptable YYYY-MM */
  month: string
  /** centimes, negatif = depense */
  amount: number
  /** non nul = moitie d'un transfert lie : neutre pour activity et RTA */
  transferGroupId?: string | null
}

export interface Assignment {
  categoryId: string
  month: string
  /** centimes, montant alloue manuellement */
  amount: number
}

export interface BudgetInput {
  /** mois cible YYYY-MM */
  month: string
  /**
   * Mois de depart du budget (YYYY-MM), optionnel. Voir l'en-tete : l'historique
   * anterieur est reduit a un solde de depart verse au RTA de ce mois.
   */
  startMonth?: string | null
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  assignments: Assignment[]
}

export interface CategoryMonth {
  categoryId: string
  rollover: number
  assigned: number
  activity: number
  available: number
}

export interface BudgetMonth {
  month: string
  readyToAssign: number
  categories: CategoryMonth[]
  totals: {
    assigned: number
    activity: number
    available: number
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month)
}

/** addMonths('2026-01', -1) === '2025-12' */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`
}

/** Liste des mois de from a to inclus (vide si from > to). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  while (cur <= to) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

/**
 * Calcule le budget du mois cible : etat de chaque enveloppe et Ready to Assign.
 * Deterministe et sans effet de bord ; l'appelant fournit des donnees deja
 * dechiffrees (l'Edge Function /api) ou mockees (le front en phase 1).
 */
export function computeBudget(input: BudgetInput): BudgetMonth {
  const { month, accounts, categories, transactions, assignments } = input
  if (!isValidMonth(month)) {
    throw new Error(`Mois cible invalide : "${month}" (attendu YYYY-MM)`)
  }
  const startMonth = input.startMonth ?? null
  if (startMonth !== null && !isValidMonth(startMonth)) {
    throw new Error(`Mois de depart invalide : "${startMonth}" (attendu YYYY-MM)`)
  }

  const onBudgetAccounts = new Set(accounts.filter((a) => a.onBudget).map((a) => a.id))
  const incomeCategories = new Set(categories.filter((c) => c.isIncome).map((c) => c.id))
  const envelopeCategories = categories.filter((c) => !c.isIncome)
  const envelopeIds = new Set(envelopeCategories.map((c) => c.id))

  // Mois cible anterieur au depart du budget : rien n'existe encore.
  if (startMonth !== null && month < startMonth) {
    return {
      month,
      readyToAssign: 0,
      categories: envelopeCategories.map((c) => ({
        categoryId: c.id,
        rollover: 0,
        assigned: 0,
        activity: 0,
        available: 0,
      })),
      totals: { assigned: 0, activity: 0, available: 0 },
    }
  }

  // Solde de depart : somme BRUTE des transactions on-budget anterieures a
  // startMonth (transferts, revenus, depenses, non categorisees : tout ce qui a
  // fait le solde des comptes budget au 1er du mois de depart).
  let openingBalance = 0
  if (startMonth !== null) {
    for (const t of transactions) {
      if (t.month < startMonth && onBudgetAccounts.has(t.accountId)) openingBalance += t.amount
    }
  }

  // Transactions comptabilisables : compte on budget, pas un transfert lie,
  // et pas anterieures au depart du budget (deja dans le solde de depart).
  const counted = transactions.filter(
    (t) =>
      onBudgetAccounts.has(t.accountId) &&
      !t.transferGroupId &&
      (startMonth === null || t.month >= startMonth),
  )
  const countedAssignments =
    startMonth === null ? assignments : assignments.filter((a) => a.month >= startMonth)

  // Bornes de la fenetre de calcul : du premier mois observe (ou du depart du
  // budget) au mois cible.
  let firstMonth = startMonth ?? month
  if (startMonth === null) {
    for (const t of counted) {
      if (t.month < firstMonth) firstMonth = t.month
    }
    for (const a of assignments) {
      if (a.month < firstMonth) firstMonth = a.month
    }
  }

  // Agregats par mois.
  const activityByMonth = new Map<string, Map<string, number>>()
  let inflows = openingBalance
  for (const t of counted) {
    if (t.month > month) continue
    if (t.categoryId !== null && incomeCategories.has(t.categoryId)) {
      inflows += t.amount
      continue
    }
    if (t.categoryId === null || !envelopeIds.has(t.categoryId)) continue
    let byCat = activityByMonth.get(t.month)
    if (!byCat) {
      byCat = new Map()
      activityByMonth.set(t.month, byCat)
    }
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount)
  }

  const assignedByMonth = new Map<string, Map<string, number>>()
  let assignedCumulative = 0
  let assignedFuture = 0
  for (const a of countedAssignments) {
    if (!envelopeIds.has(a.categoryId)) continue
    if (a.month > month) {
      assignedFuture += a.amount
      continue
    }
    assignedCumulative += a.amount
    let byCat = assignedByMonth.get(a.month)
    if (!byCat) {
      byCat = new Map()
      assignedByMonth.set(a.month, byCat)
    }
    byCat.set(a.categoryId, (byCat.get(a.categoryId) ?? 0) + a.amount)
  }

  // Deroule mois par mois : rollover et overspending.
  const prevAvailable = new Map<string, number>()
  let overspendBefore = 0
  let result: CategoryMonth[] = []

  for (const m of monthRange(firstMonth, month)) {
    const monthAssigned = assignedByMonth.get(m)
    const monthActivity = activityByMonth.get(m)
    // Seul le mois cible conserve ses lignes ; les mois anterieurs ne servent
    // qu'a derouler rollover et overspending, on n'alloue donc pas leurs objets.
    const isTarget = m === month
    const rows: CategoryMonth[] = []
    let monthOverspend = 0

    for (const cat of envelopeCategories) {
      const rollover = Math.max(prevAvailable.get(cat.id) ?? 0, 0)
      const assigned = monthAssigned?.get(cat.id) ?? 0
      const activity = monthActivity?.get(cat.id) ?? 0
      const available = rollover + assigned + activity
      if (isTarget) rows.push({ categoryId: cat.id, rollover, assigned, activity, available })
      if (available < 0) monthOverspend += -available
      prevAvailable.set(cat.id, available)
    }

    if (!isTarget) overspendBefore += monthOverspend
    else result = rows
  }

  const readyToAssign = inflows - assignedCumulative - assignedFuture - overspendBefore

  return {
    month,
    readyToAssign,
    categories: result,
    totals: {
      assigned: result.reduce((s, r) => s + r.assigned, 0),
      activity: result.reduce((s, r) => s + r.activity, 0),
      available: result.reduce((s, r) => s + r.available, 0),
    },
  }
}
