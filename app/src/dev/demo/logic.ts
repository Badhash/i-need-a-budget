// Mode demonstration : regles metier partagees par le generateur de donnees et
// le serveur factice. Miroir fidele de supabase/functions/api/index.ts
// (entree moteur, badge « À catégoriser », rapports, memoire de tiers), plus
// la semantique des fonctionnalites serveur annoncees (lib/features.ts).

import type { BudgetInput } from '../../../../packages/engine/src/index'
import { payeeKey } from '../../../../packages/crypto/src/payee'
import type { DemoDb, DemoTransaction } from './db'

// ---------------------------------------------------------------------------
// Virements croises (fonctionnalite crossBudgetTransfers)
// ---------------------------------------------------------------------------

/**
 * Groupes de virement reliant un compte budget a un compte de suivi : la
 * moitie cote budget se categorise et sort (ou entre dans) le budget, comme
 * dans YNAB. Sans la fonctionnalite, tout virement reste neutre.
 */
export function crossBudgetGroups(db: DemoDb): Set<string> {
  const onBudget = new Map(db.accounts.map((a) => [a.id, a.onBudget]))
  const sides = new Map<string, { budget: boolean; tracking: boolean }>()
  for (const t of db.transactions) {
    if (!t.transferGroupId) continue
    const flag = onBudget.get(t.accountId)
    if (flag === undefined) continue
    const s = sides.get(t.transferGroupId) ?? { budget: false, tracking: false }
    if (flag) s.budget = true
    else s.tracking = true
    sides.set(t.transferGroupId, s)
  }
  const out = new Set<string>()
  for (const [group, s] of sides) if (s.budget && s.tracking) out.add(group)
  return out
}

/** Moitie cote budget d'un virement croise (categorisable avec la fonctionnalite). */
export function isCrossBudgetHalf(db: DemoDb, tx: DemoTransaction, groups = crossBudgetGroups(db)): boolean {
  if (!tx.transferGroupId || !groups.has(tx.transferGroupId)) return false
  return db.accounts.find((a) => a.id === tx.accountId)?.onBudget === true
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

/**
 * Entree du moteur d'enveloppes (toEngineInput du serveur). Avec les virements
 * croises, la moitie cote budget CATEGORISEE est comptee comme une activite
 * ordinaire de sa categorie (on lui retire son transferGroupId pour le moteur).
 */
export function engineInput(db: DemoDb, month: string, crossBudget: boolean): BudgetInput {
  const onBudget = new Map(db.accounts.map((a) => [a.id, a.onBudget]))
  const groups = crossBudget ? crossBudgetGroups(db) : new Set<string>()
  return {
    month,
    startMonth: db.budgetStartMonth,
    accounts: db.accounts.map((a) => ({ id: a.id, onBudget: a.onBudget })),
    categories: db.categories.map((c) => ({ id: c.id, isIncome: c.isIncome })),
    transactions: db.transactions.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      categoryId: t.categoryId,
      month: t.bookingMonth,
      amount: t.amount,
      transferGroupId:
        t.transferGroupId && t.categoryId && groups.has(t.transferGroupId) && onBudget.get(t.accountId)
          ? null
          : t.transferGroupId,
    })),
    assignments: db.assignments.map((a) => ({ categoryId: a.categoryId, month: a.month, amount: a.amount })),
  }
}

// ---------------------------------------------------------------------------
// Soldes et badge « À catégoriser »
// ---------------------------------------------------------------------------

export function accountBalances(db: DemoDb): Map<string, number> {
  const balances = new Map<string, number>()
  for (const t of db.transactions) balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount)
  return balances
}

/**
 * Regle du badge (countsAsUncategorized du serveur) : compte budget, sans
 * categorie, hors virement, pas dans le futur, pas avant le depart du budget.
 * Avec les virements croises, la moitie cote budget sans categorie compte
 * aussi : elle doit etre categorisee.
 */
export function uncategorizedCount(db: DemoDb, currentMonth: string, crossBudget: boolean): number {
  const onBudget = new Set(db.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const groups = crossBudget ? crossBudgetGroups(db) : new Set<string>()
  const start = db.budgetStartMonth
  return db.transactions.filter(
    (t) =>
      onBudget.has(t.accountId) &&
      !t.categoryId &&
      (!t.transferGroupId || groups.has(t.transferGroupId)) &&
      t.bookingMonth <= currentMonth &&
      (start === null || t.bookingMonth >= start),
  ).length
}

// ---------------------------------------------------------------------------
// Rapports (portage exact de computeReports)
// ---------------------------------------------------------------------------

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

// Libelle le plus frequent d'un groupe de marchand (egalite : ordre lexical).
function mostFrequentLabel(labels: Map<string, number>): string {
  let best = ''
  let bestCount = 0
  for (const [label, count] of labels) {
    if (count > bestCount || (count === bestCount && label < best)) {
      best = label
      bestCount = count
    }
  }
  return best
}

/**
 * Agregats de la vue Rapports. Perimetre : comptes budget, hors virement entre
 * comptes budget ; avec les virements croises, la moitie cote budget compte
 * comme une transaction ordinaire. Marchands regroupes par cle de tiers.
 */
export function computeReports(db: DemoDb, month: string, crossBudget: boolean) {
  const onBudget = new Set(db.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const income = new Set(db.categories.filter((c) => c.isIncome).map((c) => c.id))
  const catToGroup = new Map(db.categories.map((c) => [c.id, c.groupId]))
  const crossGroups = crossBudget ? crossBudgetGroups(db) : new Set<string>()
  const counted = (t: DemoTransaction) =>
    onBudget.has(t.accountId) && (!t.transferGroupId || crossGroups.has(t.transferGroupId))

  const isSpending = (t: DemoTransaction) =>
    t.amount < 0 && counted(t) && (t.categoryId === null || !income.has(t.categoryId))

  const isIncome = (t: DemoTransaction) => t.categoryId !== null && income.has(t.categoryId) && counted(t)

  const spendByMonth = new Map<string, number>()
  const incomeByMonth = new Map<string, number>()
  for (const t of db.transactions) {
    if (isSpending(t)) {
      spendByMonth.set(t.bookingMonth, (spendByMonth.get(t.bookingMonth) ?? 0) - t.amount)
    } else if (isIncome(t)) {
      incomeByMonth.set(t.bookingMonth, (incomeByMonth.get(t.bookingMonth) ?? 0) + t.amount)
    }
  }
  const spendingOf = (m: string) => spendByMonth.get(m) ?? 0
  const incomeOf = (m: string) => incomeByMonth.get(m) ?? 0

  const byGroup = new Map<string, number>()
  const byMerchant = new Map<string, { total: number; count: number; labels: Map<string, number> }>()
  for (const t of db.transactions) {
    if (t.bookingMonth !== month || !isSpending(t)) continue
    const groupKey = t.categoryId ? (catToGroup.get(t.categoryId) ?? 'uncat') : 'uncat'
    byGroup.set(groupKey, (byGroup.get(groupKey) ?? 0) - t.amount)
    const key = payeeKey(t.label)
    const merchantKey = key ? `payee:${key}` : `label:${t.label}`
    let merchant = byMerchant.get(merchantKey)
    if (!merchant) {
      merchant = { total: 0, count: 0, labels: new Map() }
      byMerchant.set(merchantKey, merchant)
    }
    merchant.total -= t.amount
    merchant.count += 1
    merchant.labels.set(t.label, (merchant.labels.get(t.label) ?? 0) + 1)
  }

  const cashflow = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(month, i - 5)
    const inc = incomeOf(m)
    const spend = spendingOf(m)
    return { month: m, income: inc, spending: spend, net: inc - spend }
  })

  const rateMonth = shiftMonth(month, -1)
  const rateIncome = incomeOf(rateMonth)
  const rateSpending = spendingOf(rateMonth)
  const prevIncome = incomeOf(shiftMonth(month, -2))
  const prevSpending = spendingOf(shiftMonth(month, -2))

  const groupById = new Map(db.groups.map((g) => [g.id, g]))
  const named: { key: string; label: string; color: string | null; total: number }[] = [...byGroup.entries()]
    .filter(([key]) => key !== 'uncat')
    .map(([key, total]) => ({
      key,
      label: groupById.get(key)?.name ?? 'Autre',
      color: groupById.get(key)?.color ?? null,
      total,
    }))
    .sort((a, b) => b.total - a.total)
  const uncat = byGroup.get('uncat')
  if (uncat !== undefined) named.push({ key: 'uncat', label: 'À catégoriser', color: null, total: uncat })

  return {
    month,
    totalSpending: spendingOf(month),
    prevTotalSpending: spendingOf(shiftMonth(month, -1)),
    spendingByGroup: named,
    topMerchants: [...byMerchant.values()]
      .map((m) => ({ label: mostFrequentLabel(m.labels), total: m.total, count: m.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    cashflow,
    savingsRate: {
      month: rateMonth,
      rate: rateIncome > 0 ? (rateIncome - rateSpending) / rateIncome : 0,
      prevRate: prevIncome > 0 ? (prevIncome - prevSpending) / prevIncome : 0,
      income: rateIncome,
      saved: rateIncome - rateSpending,
    },
  }
}

// ---------------------------------------------------------------------------
// Memoire de tiers (REF N, portage de supabase/functions/api/payees.ts)
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 3

/** Defaut « 2 des 3 concordent » : X si au moins 2 entrees valent X, sinon fallback. */
function pickDefault(history: string[], fallback: string): string {
  const counts = new Map<string, number>()
  for (const id of history) {
    const n = (counts.get(id) ?? 0) + 1
    if (n >= 2) return id
    counts.set(id, n)
  }
  return fallback
}

/** Apprend une categorisation manuelle (libelle sans mot stable : no-op). */
export function learnPayee(db: DemoDb, label: string, categoryId: string): void {
  const key = payeeKey(label)
  if (!key) return
  const old = db.payees.find((p) => p.key === key)
  const history = [categoryId, ...(old?.history ?? [])].slice(0, HISTORY_SIZE)
  if (old) {
    old.categoryId = pickDefault(history, old.categoryId || categoryId)
    old.history = history
  } else {
    db.payees.push({ key, categoryId, history })
  }
}

/**
 * Apprentissage apres une categorisation manuelle : comptes budget et
 * categories hors revenus uniquement (learnPayeeSafe du serveur).
 */
export function learnPayeeSafe(db: DemoDb, tx: { accountId: string; label: string }, categoryId: string | null): void {
  if (!categoryId) return
  const account = db.accounts.find((a) => a.id === tx.accountId)
  const category = db.categories.find((c) => c.id === categoryId)
  if (!account?.onBudget || !category || category.isIncome) return
  learnPayee(db, tx.label, categoryId)
}

/** Force (ou efface avec null) la categorie par defaut d'un tiers. Renvoie la cle. */
export function setPayeeDefault(db: DemoDb, label: string, categoryId: string | null): string {
  const key = payeeKey(label)
  if (!key) return key
  db.payees = db.payees.filter((p) => p.key !== key)
  if (categoryId !== null) db.payees.push({ key, categoryId, history: [categoryId] })
  return key
}

/** Oublie une categorie supprimee (forgetPayeeCategory du serveur). */
export function forgetPayeeCategory(db: DemoDb, categoryId: string): void {
  const next: DemoDb['payees'] = []
  for (const p of db.payees) {
    if (p.categoryId !== categoryId && !p.history.includes(categoryId)) {
      next.push(p)
      continue
    }
    const history = p.history.filter((id) => id !== categoryId)
    const def = p.categoryId === categoryId ? pickDefault(history, history[0] ?? '') : p.categoryId
    if (def) next.push({ key: p.key, categoryId: def, history })
  }
  db.payees = next
}

export function payeeDefaults(db: DemoDb): Map<string, string> {
  return new Map(db.payees.filter((p) => p.key && p.categoryId).map((p) => [p.key, p.categoryId]))
}

// ---------------------------------------------------------------------------
// Regles (matchLabel du serveur)
// ---------------------------------------------------------------------------

/** normalizeLabel de packages/crypto : minuscules sans accents, blancs reduits. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function matchLabel(label: string, matcher: { op: string; value: string }): boolean {
  const haystack = normalizeLabel(label)
  const needle = normalizeLabel(matcher.value)
  if (!needle) return false
  switch (matcher.op) {
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
