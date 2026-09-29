// Mode demonstration : serveur /api factice, en memoire. Miroir de l'Edge
// Function supabase/functions/api/index.ts : memes actions, memes parametres,
// memes formes de reponse et memes erreurs (ApiError avec le statut et le
// message du serveur), plus la semantique des fonctionnalites annoncees
// (lib/features.ts). Les ecritures modifient la base de la session ; tout
// repart du jeu de donnees initial au rechargement de la page.

import { ApiError } from '@/lib/api'
import { SERVER_FEATURES } from '@/lib/features'
import { currentMonth, today } from '@/lib/format'
import { markLocalWrite } from '@/lib/realtimeGate'
import { addMonths, computeBudget } from '../../../../packages/engine/src/index'
import {
  ACCOUNT_KINDS,
  RULE_OPS,
  jsonClone,
  randomUuid,
  type AccountKind,
  type DemoDb,
  type DemoRule,
  type DemoTransaction,
  type RuleOp,
  type TargetType,
} from './db'
import {
  accountBalances,
  autoCategorizer,
  computeReports,
  crossBudgetGroups,
  engineInput,
  forgetPayeeCategory,
  isCrossBudgetHalf,
  learnPayeeSafe,
  normalizeLabel,
  setPayeeDefault,
  uncategorizedCount,
} from './logic'
import { demoConfig, demoDb, hasFeature, simulateCall } from './state'

type Params = Record<string, unknown>

const crossBudget = () => hasFeature(SERVER_FEATURES.crossBudgetTransfers)

// Le serveur recent annonce toutes ses fonctionnalites d'un bloc : au moins une
// annoncee = code recent (marchands des rapports regroupes par cle de tiers).
// Aucune (features=none) = serveur ancien deploye, regroupement par libelle brut.
const reportsOptions = () => ({ crossBudget: crossBudget(), merchantsByPayee: demoConfig.features.length > 0 })

// ---------------------------------------------------------------------------
// Validation (memes regles et memes messages que le serveur)
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GROUP_COLORS = ['blue', 'amber', 'pink', 'purple', 'green', 'teal']
const GROUP_ICONS = ['home', 'car', 'sparkles', 'repeat', 'piggy', 'banknote']

function requireMonth(value: unknown): string {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) throw new ApiError(400, 'mois invalide (YYYY-MM attendu)')
  return value
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new ApiError(400, 'date invalide (YYYY-MM-DD attendue)')
  return value
}

function requireAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ApiError(400, 'montant invalide (centimes entiers attendus)')
  }
  return value
}

function requireText(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, `champ ${field} invalide`)
  }
  return value.trim()
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ApiError(400, `champ ${field} invalide`)
  return value
}

function optionalUuid(value: unknown, field: string): string | null {
  return value == null ? null : requireUuid(value, field)
}

function requirePriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new ApiError(400, 'priority invalide')
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new ApiError(400, `champ ${field} invalide`)
  return value
}

function requireUuidArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new ApiError(400, `champ ${field} invalide`)
  const ids = value.map((v) => requireUuid(v, field))
  if (new Set(ids).size !== ids.length) throw new ApiError(400, `champ ${field} contient des doublons`)
  return ids
}

function requireMatcher(value: unknown): DemoRule['matcher'] {
  if (typeof value !== 'object' || value === null) throw new ApiError(400, 'matcher invalide')
  const m = value as Record<string, unknown>
  if (m.field !== 'label') throw new ApiError(400, 'matcher.field invalide')
  if (typeof m.op !== 'string' || !RULE_OPS.includes(m.op as RuleOp)) throw new ApiError(400, 'matcher.op invalide')
  const opValue = requireText(m.value, 'matcher.value', 200)
  if (!normalizeLabel(opValue)) throw new ApiError(400, 'valeur de regle vide apres normalisation')
  return { field: 'label', op: m.op as RuleOp, value: opValue }
}

function requireArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new ApiError(400, `champ ${field} invalide`)
  if (value.length > max) throw new ApiError(400, `champ ${field} trop volumineux (max ${max})`)
  return value
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ApiError(400, `champ ${field} invalide`)
  return value as Record<string, unknown>
}

function requireAccountKind(value: unknown): AccountKind {
  if (typeof value !== 'string' || !ACCOUNT_KINDS.includes(value as AccountKind)) {
    throw new ApiError(400, 'type de compte invalide')
  }
  return value as AccountKind
}

function requireGroupColor(value: unknown): string {
  if (typeof value !== 'string' || !GROUP_COLORS.includes(value)) throw new ApiError(400, 'champ color invalide')
  return value
}

function requireGroupIcon(value: unknown): string {
  if (typeof value !== 'string' || !GROUP_ICONS.includes(value)) throw new ApiError(400, 'champ icon invalide')
  return value
}

function requireNonIncomeCategory(db: DemoDb, categoryId: string): void {
  const category = db.categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')
  if (category.isIncome) throw new ApiError(400, 'categorie de revenus interdite')
}

// ---------------------------------------------------------------------------
// Acces et serialisation
// ---------------------------------------------------------------------------

function findTx(db: DemoDb, id: string): DemoTransaction {
  const tx = db.transactions.find((t) => t.id === id)
  if (!tx) throw new ApiError(404, 'transaction inconnue')
  return tx
}

function categoryExists(db: DemoDb, id: string): boolean {
  return db.categories.some((c) => c.id === id)
}

/** Transaction telle que servie par /api (la colonne tx_hash reste serveur). */
function txOut(t: DemoTransaction) {
  return {
    id: t.id,
    accountId: t.accountId,
    categoryId: t.categoryId,
    bookingDate: t.bookingDate,
    bookingMonth: t.bookingMonth,
    amount: t.amount,
    transferGroupId: t.transferGroupId,
    label: t.label,
    counterparty: t.counterparty,
    notes: t.notes,
  }
}

// Plus recentes d'abord (tri de actionListTransactions).
function listTx(db: DemoDb) {
  return db.transactions
    .slice()
    .sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : a.bookingDate > b.bookingDate ? -1 : 0))
    .map(txOut)
}

function buildBootstrap(db: DemoDb) {
  const balances = accountBalances(db)
  return {
    accounts: db.accounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? 0 })),
    groups: db.groups,
    categories: db.categories,
    uncategorizedCount: uncategorizedCount(db, currentMonth(), crossBudget()),
    budgetStartMonth: db.budgetStartMonth,
    payees: db.payees.map((p) => ({ key: p.key, categoryId: p.categoryId })),
    features: [...demoConfig.features],
  }
}

function budgetOf(db: DemoDb, month: string) {
  return computeBudget(engineInput(db, month, crossBudget()))
}

/** Miroir d'une moitie de virement : supprime s'il est synthetique, delie s'il est importe. */
function releaseMirror(db: DemoDb, tx: DemoTransaction): void {
  const mirror = db.transactions.find((t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id)
  if (!mirror) return
  if (mirror.txHash === null) db.transactions = db.transactions.filter((t) => t.id !== mirror.id)
  else mirror.transferGroupId = null
}

function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1
}

// Ids fournis en tete (dans l'ordre), les autres gardent leur ordre relatif.
function applyOrder<T extends { id: string; sortOrder: number }>(rows: T[], orderedIds: string[]): void {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const provided = new Set(orderedIds)
  const rest = rows
    .filter((r) => !provided.has(r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
  const finalOrder = [...orderedIds.map((id) => byId.get(id)!), ...rest]
  finalOrder.forEach((row, i) => {
    row.sortOrder = i
  })
}

function upsertAssignment(db: DemoDb, categoryId: string, month: string, amount: number): void {
  const existing = db.assignments.find((a) => a.categoryId === categoryId && a.month === month)
  if (existing) existing.amount = amount
  else db.assignments.push({ id: randomUuid(), categoryId, month, amount })
}

function wipeBudget(db: DemoDb): void {
  db.transactions = []
  db.assignments = []
  db.targets = []
  db.rules = []
  db.categories = []
  db.groups = []
  db.accounts = []
  db.budgetStartMonth = null
  db.payees = []
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const DEFAULT_STRUCTURE: { group: { name: string; color: string; icon: string }; categories: string[] }[] = [
  { group: { name: 'Essentiels', color: 'blue', icon: 'home' }, categories: ['Loyer', 'Courses', 'Électricité & gaz', 'Internet & mobile', 'Assurances'] },
  { group: { name: 'Transport', color: 'amber', icon: 'car' }, categories: ['Transports en commun', 'Essence', 'VTC & taxi'] },
  { group: { name: 'Plaisirs', color: 'pink', icon: 'sparkles' }, categories: ['Restaurants', 'Shopping', 'Sorties & loisirs', 'Vacances'] },
  { group: { name: 'Abonnements', color: 'purple', icon: 'repeat' }, categories: ['Streaming', 'Musique', 'Stockage cloud'] },
  { group: { name: 'Épargne & objectifs', color: 'green', icon: 'piggy' }, categories: ["Fonds d'urgence", 'Cadeaux', 'Projets'] },
]

const ACTIONS: Record<string, (db: DemoDb, p: Params) => unknown> = {
  // --- Lectures -------------------------------------------------------------
  bootstrap: (db) => buildBootstrap(db),

  bootstrapFull: (db, p) => {
    const month = requireMonth(p.month)
    return {
      bootstrap: buildBootstrap(db),
      budget: budgetOf(db, month),
      transactions: listTx(db),
      reports: computeReports(db, month, reportsOptions()),
    }
  },

  getBudgetMonth: (db, p) => budgetOf(db, requireMonth(p.month)),

  getTransactions: (db, p) => {
    const month = requireMonth(p.month)
    return { transactions: listTx(db).filter((t) => t.bookingMonth === month) }
  },

  listTransactions: (db) => ({ transactions: listTx(db) }),

  getReports: (db, p) => computeReports(db, requireMonth(p.month), reportsOptions()),

  // --- Transactions ---------------------------------------------------------
  addTransaction: (db, p) => {
    const accountId = requireUuid(p.accountId, 'accountId')
    const bookingDate = requireDate(p.date)
    const amount = requireAmount(p.amount)
    const label = requireText(p.label, 'label')
    const categoryId = optionalUuid(p.categoryId, 'categoryId')
    const notes = p.notes == null ? null : requireText(p.notes, 'notes', 500)
    if (!db.accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
    if (categoryId && !categoryExists(db, categoryId)) throw new ApiError(404, 'categorie inconnue')
    const tx: DemoTransaction = {
      id: randomUuid(),
      accountId,
      categoryId,
      bookingDate,
      bookingMonth: bookingDate.slice(0, 7),
      amount,
      label,
      counterparty: null,
      transferGroupId: null,
      notes,
      txHash: null,
    }
    db.transactions.push(tx)
    return { id: tx.id }
  },

  categorizeTransaction: (db, p) => {
    const transactionId = requireUuid(p.transactionId, 'transactionId')
    const categoryId = optionalUuid(p.categoryId, 'categoryId')
    const tx = findTx(db, transactionId)
    if (categoryId && !categoryExists(db, categoryId)) throw new ApiError(404, 'categorie inconnue')
    if (tx.transferGroupId) {
      // Seule la moitie cote budget d'un virement croise se categorise ; un
      // virement n'est pas un marchand (pas d'apprentissage de tiers).
      if (!crossBudget() || !isCrossBudgetHalf(db, tx)) throw new ApiError(400, 'un transfert ne se categorise pas')
      tx.categoryId = categoryId
      return { ok: true }
    }
    tx.categoryId = categoryId
    learnPayeeSafe(db, tx, categoryId)
    return { ok: true }
  },

  categorizeMany: (db, p) => {
    const ids = requireUuidArray(p.transactionIds, 'transactionIds')
    if (ids.length > 200) throw new ApiError(400, 'au plus 200 transactions par lot')
    const categoryId = optionalUuid(p.categoryId, 'categoryId')
    if (categoryId && !categoryExists(db, categoryId)) throw new ApiError(404, 'categorie inconnue')
    const wanted = new Set(ids)
    const groups = crossBudget() ? crossBudgetGroups(db) : new Set<string>()
    const targets = db.transactions.filter(
      (t) =>
        wanted.has(t.id) &&
        t.categoryId !== categoryId &&
        (!t.transferGroupId || isCrossBudgetHalf(db, t, groups)),
    )
    for (const t of targets) t.categoryId = categoryId
    for (const t of targets) if (!t.transferGroupId) learnPayeeSafe(db, t, categoryId)
    return { ok: true, updated: targets.length }
  },

  setPayeeCategory: (db, p) => {
    const label = requireText(p.label, 'label')
    const categoryId = optionalUuid(p.categoryId, 'categoryId')
    if (categoryId) requireNonIncomeCategory(db, categoryId)
    return { ok: true, key: setPayeeDefault(db, label, categoryId) }
  },

  updateTransaction: (db, p) => {
    const transactionId = requireUuid(p.transactionId, 'transactionId')
    const accountId = requireUuid(p.accountId, 'accountId')
    const bookingDate = requireDate(p.date)
    const amount = requireAmount(p.amount)
    const label = requireText(p.label, 'label')
    const categoryId = optionalUuid(p.categoryId, 'categoryId')
    const notes = p.notes == null ? null : requireText(p.notes, 'notes', 500)
    const existing = findTx(db, transactionId)
    if (existing.transferGroupId) {
      // Un virement reste coherent avec son miroir. Exception (virements
      // croises) : categorie, libelle et notes de la moitie cote budget.
      const refused = new ApiError(400, 'un transfert ne se modifie pas, annulez-le d abord')
      if (!crossBudget()) throw refused
      if (accountId !== existing.accountId || bookingDate !== existing.bookingDate || amount !== existing.amount) {
        throw refused
      }
      if (!isCrossBudgetHalf(db, existing)) throw refused
      if (categoryId && !categoryExists(db, categoryId)) throw new ApiError(404, 'categorie inconnue')
      existing.categoryId = categoryId
      existing.label = label
      existing.notes = notes
      return { ok: true }
    }
    if (!db.accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
    if (categoryId && !categoryExists(db, categoryId)) throw new ApiError(404, 'categorie inconnue')
    const previousCategory = existing.categoryId
    Object.assign(existing, {
      accountId,
      categoryId,
      bookingDate,
      bookingMonth: bookingDate.slice(0, 7),
      amount,
      label,
      notes,
    })
    if (categoryId && categoryId !== previousCategory) learnPayeeSafe(db, existing, categoryId)
    return { ok: true }
  },

  convertToTransfer: (db, p) => {
    const transactionId = requireUuid(p.transactionId, 'transactionId')
    const targetAccountId = requireUuid(p.targetAccountId, 'targetAccountId')
    const tx = findTx(db, transactionId)
    if (tx.transferGroupId) throw new ApiError(400, 'transaction deja liee a un transfert')
    if (tx.accountId === targetAccountId) {
      throw new ApiError(400, 'le compte cible doit etre different du compte d origine')
    }
    const target = db.accounts.find((a) => a.id === targetAccountId)
    if (!target) throw new ApiError(400, 'compte cible inconnu')
    if (target.closed) throw new ApiError(400, 'compte cible cloture')
    const originOnBudget = db.accounts.some((a) => a.id === tx.accountId && a.onBudget)
    // Virement croise : la moitie cote budget (l'origine) garde sa categorie.
    const keepCategory = crossBudget() && originOnBudget && !target.onBudget
    const transferGroupId = randomUuid()
    db.transactions.push({
      id: randomUuid(),
      accountId: targetAccountId,
      categoryId: null,
      bookingDate: tx.bookingDate,
      bookingMonth: tx.bookingMonth,
      amount: -tx.amount,
      label: tx.label,
      counterparty: null,
      transferGroupId,
      notes: null,
      txHash: null,
    })
    tx.categoryId = keepCategory ? tx.categoryId : null
    tx.transferGroupId = transferGroupId
    return { ok: true, transferGroupId }
  },

  convertTransferToNormal: (db, p) => {
    const transactionId = requireUuid(p.transactionId, 'transactionId')
    const kept = findTx(db, transactionId)
    if (!kept.transferGroupId) throw new ApiError(400, 'la transaction n est pas un transfert')
    releaseMirror(db, kept)
    kept.transferGroupId = null
    return { ok: true }
  },

  deleteTransaction: (db, p) => {
    const transactionId = requireUuid(p.transactionId, 'transactionId')
    const tx = findTx(db, transactionId)
    if (tx.transferGroupId) releaseMirror(db, tx)
    db.transactions = db.transactions.filter((t) => t.id !== transactionId)
    return { ok: true }
  },

  // --- Budget ---------------------------------------------------------------
  setAssigned: (db, p) => {
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    const month = requireMonth(p.month)
    const amount = requireAmount(p.amount)
    const category = db.categories.find((c) => c.id === categoryId)
    if (!category) throw new ApiError(404, 'categorie inconnue')
    if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne recoivent pas d assignation')
    upsertAssignment(db, categoryId, month, amount)
    return { ok: true }
  },

  newBudget: (db, p) => {
    const month = requireMonth(p.month)
    if (month > addMonths(currentMonth(), 1)) {
      throw new ApiError(400, 'le mois de depart ne peut pas depasser le mois prochain')
    }
    if (month < '2000-01') throw new ApiError(400, 'mois de depart trop ancien')
    db.assignments = []
    db.budgetStartMonth = month
    return { ok: true, budgetStartMonth: month }
  },

  // --- Comptes --------------------------------------------------------------
  createAccount: (db, p) => {
    const name = requireText(p.name, 'name', 80)
    const institution = requireText(p.institution, 'institution', 80)
    const kind = p.kind as AccountKind
    if (!ACCOUNT_KINDS.includes(kind)) throw new ApiError(400, 'type de compte invalide')
    const onBudget = p.onBudget !== false
    const openingBalance = requireAmount(p.openingBalance ?? 0)
    const openingDate = requireDate(p.openingDate ?? today())
    let incomeCategoryId: string | null = null
    if (openingBalance !== 0) {
      const income =
        db.categories.find((c) => c.isIncome && c.name === "Solde d'ouverture") ?? db.categories.find((c) => c.isIncome)
      if (onBudget && !income) throw new ApiError(409, "initialiser les categories d'abord (action seedDefaults)")
      incomeCategoryId = income?.id ?? null
    }
    const accountId = randomUuid()
    db.accounts.push({
      id: accountId,
      name,
      institution,
      kind,
      onBudget,
      closed: false,
      connectionId: null,
      providerAccountUid: null,
    })
    if (openingBalance !== 0) {
      db.transactions.push({
        id: randomUuid(),
        accountId,
        categoryId: onBudget ? incomeCategoryId : null,
        bookingDate: openingDate,
        bookingMonth: openingDate.slice(0, 7),
        amount: openingBalance,
        label: "Solde d'ouverture",
        counterparty: null,
        transferGroupId: null,
        notes: null,
        txHash: null,
      })
    }
    return { id: accountId }
  },

  updateAccount: (db, p) => {
    const accountId = requireUuid(p.accountId, 'accountId')
    const name = p.name == null ? null : requireText(p.name, 'name', 80)
    const institution = p.institution == null ? null : requireText(p.institution, 'institution', 80)
    const kind = p.kind == null ? null : (p.kind as AccountKind)
    if (kind !== null && !ACCOUNT_KINDS.includes(kind)) throw new ApiError(400, 'type de compte invalide')
    // Fonctionnalite accountFlags : bascule budget/suivi et archivage. Un
    // serveur ancien ignore ces champs.
    const flags = hasFeature(SERVER_FEATURES.accountFlags)
    const onBudget = flags && p.onBudget != null ? requireBoolean(p.onBudget, 'onBudget') : null
    const closed = flags && p.closed != null ? requireBoolean(p.closed, 'closed') : null
    const account = db.accounts.find((a) => a.id === accountId)
    if (!account) throw new ApiError(404, 'compte inconnu')
    if (closed === true && !account.closed && (accountBalances(db).get(accountId) ?? 0) !== 0) {
      throw new ApiError(400, 'solde non nul : ramenez-le a 0 avant de clore le compte')
    }
    if (name !== null) account.name = name
    if (institution !== null) account.institution = institution
    if (kind !== null) account.kind = kind
    if (closed !== null) account.closed = closed
    if (onBudget !== null) account.onBudget = onBudget
    return { ok: true }
  },

  deleteAccount: (db, p) => {
    const accountId = requireUuid(p.accountId, 'accountId')
    if (!db.accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
    const own = db.transactions.filter((t) => t.accountId === accountId)
    const ownGroups = new Set(own.map((t) => t.transferGroupId).filter((g): g is string => g !== null))
    // Les miroirs situes sur d'autres comptes sont delies, jamais supprimes.
    for (const t of db.transactions) {
      if (t.accountId !== accountId && t.transferGroupId && ownGroups.has(t.transferGroupId)) t.transferGroupId = null
    }
    db.transactions = db.transactions.filter((t) => t.accountId !== accountId)
    db.accounts = db.accounts.filter((a) => a.id !== accountId)
    return { ok: true, deleted: own.length }
  },

  // --- Taxonomie ------------------------------------------------------------
  seedDefaults: (db) => {
    const expectedGroups = DEFAULT_STRUCTURE.length + 1
    const expectedCats = 3 + DEFAULT_STRUCTURE.reduce((sum, entry) => sum + entry.categories.length, 0)
    if (db.groups.length >= expectedGroups && db.categories.length >= expectedCats) {
      throw new ApiError(409, 'des categories existent deja')
    }
    db.categories = []
    db.groups = []
    const incomeGroupId = randomUuid()
    db.groups.push({
      id: incomeGroupId,
      name: 'Revenus',
      color: 'teal',
      icon: 'banknote',
      sortOrder: DEFAULT_STRUCTURE.length + 1,
      hidden: false,
    })
    ;['Salaire', 'Autres revenus', "Solde d'ouverture"].forEach((name, i) => {
      db.categories.push({
        id: randomUuid(),
        groupId: incomeGroupId,
        name,
        isIncome: true,
        sortOrder: i + 1,
        hidden: name === "Solde d'ouverture",
      })
    })
    DEFAULT_STRUCTURE.forEach((entry, gi) => {
      const groupId = randomUuid()
      db.groups.push({ id: groupId, ...entry.group, sortOrder: gi + 1, hidden: false })
      entry.categories.forEach((name, ci) => {
        db.categories.push({ id: randomUuid(), groupId, name, isIncome: false, sortOrder: ci + 1, hidden: false })
      })
    })
    return { ok: true }
  },

  createCategory: (db, p) => {
    const groupId = requireUuid(p.groupId, 'groupId')
    const name = requireText(p.name, 'name', 80)
    if (!db.groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')
    const id = randomUuid()
    db.categories.push({
      id,
      groupId,
      name,
      isIncome: false,
      sortOrder: nextSortOrder(db.categories.filter((c) => c.groupId === groupId)),
      hidden: false,
    })
    return { id }
  },

  updateCategory: (db, p) => {
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    const name = p.name == null ? null : requireText(p.name, 'name', 80)
    const groupId = optionalUuid(p.groupId, 'groupId')
    const hidden = p.hidden == null ? null : requireBoolean(p.hidden, 'hidden')
    const category = db.categories.find((c) => c.id === categoryId)
    if (!category) throw new ApiError(404, 'categorie inconnue')
    if (category.isIncome && hidden === true) throw new ApiError(400, 'une categorie de revenus ne peut pas etre cachee')
    if (category.isIncome && groupId !== null && groupId !== category.groupId) {
      throw new ApiError(400, 'une categorie de revenus ne peut pas changer de groupe')
    }
    if (groupId !== null && groupId !== category.groupId && !db.groups.some((g) => g.id === groupId)) {
      throw new ApiError(404, 'groupe inconnu')
    }
    if (name !== null) category.name = name
    if (hidden !== null) category.hidden = hidden
    if (groupId !== null && groupId !== category.groupId) {
      // Un deplacement place la categorie a la fin du groupe cible.
      category.sortOrder = nextSortOrder(db.categories.filter((c) => c.groupId === groupId))
      category.groupId = groupId
    }
    return { ok: true }
  },

  deleteCategory: (db, p) => {
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    const category = db.categories.find((c) => c.id === categoryId)
    if (!category) throw new ApiError(404, 'categorie inconnue')
    if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne se suppriment pas')
    let uncategorized = 0
    for (const t of db.transactions) {
      if (t.categoryId !== categoryId) continue
      t.categoryId = null
      uncategorized += 1
    }
    db.assignments = db.assignments.filter((a) => a.categoryId !== categoryId)
    db.targets = db.targets.filter((t) => t.categoryId !== categoryId)
    db.rules = db.rules.filter((r) => r.categoryId !== categoryId)
    forgetPayeeCategory(db, categoryId)
    db.categories = db.categories.filter((c) => c.id !== categoryId)
    return { ok: true, uncategorized }
  },

  createCategoryGroup: (db, p) => {
    const name = requireText(p.name, 'name', 80)
    const color = p.color == null ? 'blue' : requireGroupColor(p.color)
    const icon = p.icon == null ? 'sparkles' : requireGroupIcon(p.icon)
    const id = randomUuid()
    db.groups.push({ id, name, color, icon, sortOrder: nextSortOrder(db.groups), hidden: false })
    return { id }
  },

  updateCategoryGroup: (db, p) => {
    const groupId = requireUuid(p.groupId, 'groupId')
    const name = p.name == null ? null : requireText(p.name, 'name', 80)
    const color = p.color == null ? null : requireGroupColor(p.color)
    const icon = p.icon == null ? null : requireGroupIcon(p.icon)
    const hidden = p.hidden == null ? null : requireBoolean(p.hidden, 'hidden')
    const group = db.groups.find((g) => g.id === groupId)
    if (!group) throw new ApiError(404, 'groupe inconnu')
    if (name !== null) group.name = name
    if (color !== null) group.color = color
    if (icon !== null) group.icon = icon
    if (hidden !== null) group.hidden = hidden
    return { ok: true }
  },

  deleteCategoryGroup: (db, p) => {
    const groupId = requireUuid(p.groupId, 'groupId')
    if (!db.groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')
    if (db.categories.some((c) => c.groupId === groupId)) {
      throw new ApiError(400, 'le groupe contient encore des categories : deplacez-les ou supprimez-les d abord')
    }
    db.groups = db.groups.filter((g) => g.id !== groupId)
    return { ok: true }
  },

  reorderCategories: (db, p) => {
    const groupId = requireUuid(p.groupId, 'groupId')
    const orderedIds = requireUuidArray(p.orderedIds, 'orderedIds')
    if (!db.groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')
    const inGroup = db.categories.filter((c) => c.groupId === groupId)
    const inGroupIds = new Set(inGroup.map((c) => c.id))
    for (const id of orderedIds) {
      if (!inGroupIds.has(id)) throw new ApiError(400, 'categorie hors du groupe ou inconnue')
    }
    applyOrder(inGroup, orderedIds)
    return { ok: true }
  },

  reorderCategoryGroups: (db, p) => {
    const orderedIds = requireUuidArray(p.orderedIds, 'orderedIds')
    const known = new Set(db.groups.map((g) => g.id))
    for (const id of orderedIds) {
      if (!known.has(id)) throw new ApiError(400, 'groupe inconnu dans orderedIds')
    }
    applyOrder(db.groups, orderedIds)
    return { ok: true }
  },

  // --- Regles ---------------------------------------------------------------
  listRules: (db) => ({
    rules: db.rules.slice().sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1)),
  }),

  createRule: (db, p) => {
    const matcher = requireMatcher(p.matcher)
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    requireNonIncomeCategory(db, categoryId)
    const priority =
      p.priority == null ? db.rules.reduce((max, r) => Math.max(max, r.priority), -1) + 1 : requirePriority(p.priority)
    const id = randomUuid()
    db.rules.push({ id, matcher, categoryId, priority })
    return { id }
  },

  updateRule: (db, p) => {
    const id = requireUuid(p.id, 'id')
    const matcher = requireMatcher(p.matcher)
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    const priority = requirePriority(p.priority)
    requireNonIncomeCategory(db, categoryId)
    const rule = db.rules.find((r) => r.id === id)
    if (!rule) throw new ApiError(404, 'regle inconnue')
    Object.assign(rule, { matcher, categoryId, priority })
    return { ok: true }
  },

  deleteRule: (db, p) => {
    const id = requireUuid(p.id, 'id')
    db.rules = db.rules.filter((r) => r.id !== id)
    return { ok: true }
  },

  applyRulesToUncategorized: (db) => {
    // Regles d'abord, puis repli sur la memoire de tiers (comptes budget).
    const categorize = autoCategorizer(db)
    let categorized = 0
    for (const tx of db.transactions) {
      if (tx.categoryId || tx.transferGroupId) continue
      const categoryId = categorize(tx)
      if (!categoryId) continue
      tx.categoryId = categoryId
      categorized += 1
    }
    return { categorized }
  },

  // --- Objectifs ------------------------------------------------------------
  listTargets: (db) => ({ targets: db.targets }),

  setTarget: (db, p) => {
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    const allowed: TargetType[] = hasFeature(SERVER_FEATURES.refillTargets)
      ? ['monthly', 'byDate', 'refill']
      : ['monthly', 'byDate']
    const type = p.type as TargetType
    if (!allowed.includes(type)) throw new ApiError(400, 'type d objectif invalide')
    const amount = requireAmount(p.amount)
    if (amount <= 0) throw new ApiError(400, 'montant d objectif invalide')
    const dueMonth = type === 'byDate' ? requireMonth(p.dueMonth) : null
    requireNonIncomeCategory(db, categoryId)
    const existing = db.targets.find((t) => t.categoryId === categoryId)
    if (existing) Object.assign(existing, { type, amount, dueMonth })
    else db.targets.push({ id: randomUuid(), categoryId, type, amount, dueMonth })
    return { ok: true }
  },

  deleteTarget: (db, p) => {
    const categoryId = requireUuid(p.categoryId, 'categoryId')
    db.targets = db.targets.filter((t) => t.categoryId !== categoryId)
    return { ok: true }
  },

  // --- Banque ---------------------------------------------------------------
  getBankConnections: (db) => {
    const byUid = new Map<string, { id: string; name: string }>()
    for (const a of db.accounts) if (a.providerAccountUid) byUid.set(a.providerAccountUid, { id: a.id, name: a.name })
    const now = Date.now()
    const expiryWindow = 14 * 86_400_000
    const maskIban = (iban: string) => {
      const clean = iban.replace(/\s+/g, '')
      return clean.length <= 8 ? clean : `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`
    }
    return {
      connections: db.bankConnections.map((c) => {
        let status: 'active' | 'expiring' | 'expired' | 'pending'
        if (!c.validUntil) status = 'pending'
        else {
          const expiry = new Date(c.validUntil).getTime()
          if (Number.isNaN(expiry) || expiry < now) status = 'expired'
          else if (expiry < now + expiryWindow) status = 'expiring'
          else status = 'active'
        }
        return {
          id: c.id,
          institution: c.institution,
          validUntil: c.validUntil,
          status,
          accounts: c.accounts.map((acc) => {
            const linked = byUid.get(acc.uid) ?? null
            return {
              uid: acc.uid,
              name: acc.name ?? null,
              iban: acc.iban ? maskIban(acc.iban) : null,
              product: acc.product ?? null,
              linkedAccountId: linked?.id ?? null,
              linkedAccountName: linked?.name ?? null,
            }
          }),
        }
      }),
    }
  },

  linkBankAccount: (db, p) => {
    const connectionId = requireUuid(p.connectionId, 'connectionId')
    const providerAccountUid = requireText(p.providerAccountUid, 'providerAccountUid', 200)
    const accountId = p.accountId == null || p.accountId === '' ? null : requireUuid(p.accountId, 'accountId')
    if (accountId && !db.accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
    for (const a of db.accounts) {
      if (a.providerAccountUid === providerAccountUid && a.id !== accountId) {
        a.providerAccountUid = null
        a.connectionId = null
      }
    }
    const target = accountId ? db.accounts.find((a) => a.id === accountId) : undefined
    if (target) {
      target.connectionId = connectionId
      target.providerAccountUid = providerAccountUid
    }
    return { ok: true }
  },

  listSyncLogs: (db) => ({
    logs: db.syncLogs
      .slice()
      .sort((a, b) => (a.runAt < b.runAt ? 1 : a.runAt > b.runAt ? -1 : 0))
      .slice(0, 10)
      .map((l) => ({ id: l.id, runAt: l.runAt, status: l.status, importedCount: l.importedCount, error: l.error })),
  }),

  // --- Export, import, maintenance ------------------------------------------
  exportData: (db) => ({
    exportedAt: new Date().toISOString(),
    budgetStartMonth: db.budgetStartMonth,
    accounts: db.accounts,
    groups: db.groups,
    categories: db.categories,
    transactions: db.transactions.map(txOut),
    assignments: db.assignments,
    targets: db.targets,
    rules: db.rules,
    payees: db.payees.map((p) => ({ key: p.key, categoryId: p.categoryId })),
  }),

  importReplaceBegin: (db, p) => {
    const rawAccounts = requireArray(p.accounts, 'accounts', 50)
    const rawGroups = requireArray(p.groups, 'groups', 200)
    const rawCategories = requireArray(p.categories, 'categories', 1000)
    // Tout est valide AVANT le moindre effacement.
    const groupInputs = rawGroups.map((g) => {
      const o = requireObject(g, 'groups[]')
      return {
        key: requireText(o.key, 'groups.key', 200),
        name: requireText(o.name, 'groups.name', 80),
        color: o.color == null ? 'blue' : requireGroupColor(o.color),
        icon: o.icon == null ? 'sparkles' : requireGroupIcon(o.icon),
        hidden: o.hidden == null ? false : requireBoolean(o.hidden, 'groups.hidden'),
      }
    })
    const catInputs = rawCategories.map((c) => {
      const o = requireObject(c, 'categories[]')
      return {
        key: requireText(o.key, 'categories.key', 200),
        groupKey: requireText(o.groupKey, 'categories.groupKey', 200),
        name: requireText(o.name, 'categories.name', 80),
        isIncome: o.isIncome == null ? false : requireBoolean(o.isIncome, 'categories.isIncome'),
        hidden: o.hidden == null ? false : requireBoolean(o.hidden, 'categories.hidden'),
      }
    })
    const accInputs = rawAccounts.map((a) => {
      const o = requireObject(a, 'accounts[]')
      return {
        key: requireText(o.key, 'accounts.key', 200),
        name: requireText(o.name, 'accounts.name', 80),
        institution: o.institution == null ? 'Import YNAB' : requireText(o.institution, 'accounts.institution', 80),
        kind: o.kind == null ? ('checking' as AccountKind) : requireAccountKind(o.kind),
        onBudget: o.onBudget == null ? true : requireBoolean(o.onBudget, 'accounts.onBudget'),
      }
    })

    // Effacement destructif : connexions bancaires et journaux preserves.
    wipeBudget(db)

    const groupIdByKey = new Map<string, string>()
    groupInputs.forEach((g, i) => {
      const id = randomUuid()
      db.groups.push({ id, name: g.name, color: g.color, icon: g.icon, sortOrder: i + 1, hidden: g.hidden })
      groupIdByKey.set(g.key, id)
    })
    const categoryIdByKey = new Map<string, string>()
    const catSortByGroup = new Map<string, number>()
    let hasIncome = false
    for (const c of catInputs) {
      const groupId = groupIdByKey.get(c.groupKey)
      if (!groupId) continue
      const sortOrder = (catSortByGroup.get(groupId) ?? 0) + 1
      catSortByGroup.set(groupId, sortOrder)
      const id = randomUuid()
      db.categories.push({ id, groupId, name: c.name, isIncome: c.isIncome, sortOrder, hidden: c.isIncome ? false : c.hidden })
      categoryIdByKey.set(c.key, id)
      if (c.isIncome) hasIncome = true
    }
    let incomeFallbackId: string | undefined
    if (!hasIncome) {
      const groupId = randomUuid()
      db.groups.push({ id: groupId, name: 'Revenus', color: 'teal', icon: 'banknote', sortOrder: db.groups.length + 1, hidden: false })
      incomeFallbackId = randomUuid()
      db.categories.push({ id: incomeFallbackId, groupId, name: 'Revenus', isIncome: true, sortOrder: 1, hidden: false })
    }
    const accountIdByKey = new Map<string, string>()
    for (const a of accInputs) {
      const id = randomUuid()
      db.accounts.push({
        id,
        name: a.name,
        institution: a.institution,
        kind: a.kind,
        onBudget: a.onBudget,
        closed: false,
        connectionId: null,
        providerAccountUid: null,
      })
      accountIdByKey.set(a.key, id)
    }
    return {
      accountMap: Object.fromEntries(accountIdByKey),
      categoryMap: Object.fromEntries(categoryIdByKey),
      incomeFallbackId,
    }
  },

  importReplaceTransactions: (db, p) => {
    const raw = requireArray(p.transactions, 'transactions', 200)
    const accountIds = new Set(db.accounts.map((a) => a.id))
    const onBudget = new Set(db.accounts.filter((a) => a.onBudget).map((a) => a.id))
    const categoryIds = new Set(db.categories.map((c) => c.id))
    // Fonctionnalite importTransfers : paires de virements YNAB (meme groupe).
    const transfers = hasFeature(SERVER_FEATURES.importTransfers)
    const rows: DemoTransaction[] = raw.map((t) => {
      const o = requireObject(t, 'transactions[]')
      const accountId = requireUuid(o.accountId, 'accountId')
      if (!accountIds.has(accountId)) throw new ApiError(404, 'compte inconnu')
      const rawCategoryId = optionalUuid(o.categoryId, 'categoryId')
      if (rawCategoryId && !categoryIds.has(rawCategoryId)) throw new ApiError(404, 'categorie inconnue')
      const bookingDate = requireDate(o.date)
      const transferGroupId = transfers ? optionalUuid(o.transferGroupId, 'transferGroupId') : null
      return {
        id: randomUuid(),
        accountId,
        // La moitie cote compte de suivi d'un virement ne porte jamais de categorie.
        categoryId: transferGroupId && !onBudget.has(accountId) ? null : rawCategoryId,
        bookingDate,
        bookingMonth: bookingDate.slice(0, 7),
        amount: requireAmount(o.amount),
        label: requireText(o.label, 'label', 200),
        counterparty: o.counterparty == null ? null : requireText(o.counterparty, 'counterparty', 200),
        transferGroupId,
        notes: o.notes == null ? null : requireText(o.notes, 'notes', 500),
        txHash: null,
      }
    })
    db.transactions.push(...rows)
    return { inserted: rows.length }
  },

  importReplaceAssignments: (db, p) => {
    const raw = requireArray(p.assignments, 'assignments', 500)
    const byId = new Map(db.categories.map((c) => [c.id, c]))
    const rows = raw.map((a) => {
      const o = requireObject(a, 'assignments[]')
      const categoryId = requireUuid(o.categoryId, 'categoryId')
      const category = byId.get(categoryId)
      if (!category) throw new ApiError(404, 'categorie inconnue')
      if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne recoivent pas d assignation')
      return { categoryId, month: requireMonth(o.month), amount: requireAmount(o.amount) }
    })
    for (const r of rows) upsertAssignment(db, r.categoryId, r.month, r.amount)
    return { upserted: rows.length }
  },

  migrateSplitPayload: () => ({ migrated: 0 }),

  recomputeAggregates: () => ({ ok: true, ready: true }),
}

// Actions de LECTURE (meme classement que lib/api.ts) : les autres horodatent
// l'ecriture locale comme le vrai client.
const READ_ACTION = /^(get|list|export|bootstrap)/

/** Remplace apiCall en mode demonstration (cf. lib/api.ts). */
export async function demoApiCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const isWrite = !READ_ACTION.test(action)
  if (isWrite) markLocalWrite()
  // Les parametres voyagent en JSON, comme sur le reseau (undefined retire).
  const payload = jsonClone(params ?? {})
  const result = await simulateCall(action, () => {
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : undefined
    if (!handler) throw new ApiError(400, 'action inconnue')
    try {
      // Instantane de la reponse au moment du traitement (JSON, comme le reseau).
      return jsonClone(handler(demoDb(), payload))
    } catch (err) {
      if (err instanceof ApiError) throw err
      // Bug du serveur factice : visible en console, erreur generique cote UI.
      console.error(`demo api action=${action}`, err)
      throw new ApiError(500, 'erreur interne')
    }
  })
  if (isWrite) markLocalWrite()
  return result as T
}
