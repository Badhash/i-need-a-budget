// Edge Function /api — endpoint unique a actions typees.
//
// Flux : verification du JWT Supabase -> chargement des lignes chiffrees en
// service role -> dechiffrement EN MEMOIRE -> calculs via packages/engine ->
// reponse JSON en clair sur TLS. Les ecritures re-chiffrent le payload et
// recalculent les index aveugles.
//
// INTERDIT : logger des payloads dechiffres, la cle, ou tout contenu metier.
// Les logs se limitent a : nom d'action, code HTTP, message d'erreur statique.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  computeBudget,
  type Account as EngineAccount,
  type Assignment as EngineAssignment,
  type Category as EngineCategory,
  type Transaction as EngineTransaction,
} from '../../../packages/engine/src/index.ts'
import {
  assignIdx,
  assignMonthIdx,
  decryptJson,
  deriveKeys,
  encryptJson,
  pgHexToBytes,
  bytesToPgHex,
  txMonthIdx,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'

// ---------------------------------------------------------------------------
// Types des payloads chiffres (contrat du CLAUDE.md, section modele de donnees)
// ---------------------------------------------------------------------------

type AccountKind = 'checking' | 'savings' | 'investment'

interface AccountPayload {
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  closed: boolean
  connectionId?: string | null
  providerAccountUid?: string | null
}

interface GroupPayload {
  name: string
  color: string
  icon: string
  sortOrder: number
  hidden: boolean
}

interface CategoryPayload {
  groupId: string
  name: string
  isIncome: boolean
  sortOrder: number
  hidden: boolean
}

interface TxPayload {
  accountId: string
  categoryId: string | null
  bookingDate: string // YYYY-MM-DD
  bookingMonth: string // YYYY-MM
  amount: number // centimes, negatif = depense
  label: string
  counterparty?: string | null
  transferGroupId?: string | null
  notes?: string | null
}

interface AssignmentPayload {
  categoryId: string
  month: string
  amount: number
}

type WithId<T> = T & { id: string }

// ---------------------------------------------------------------------------
// Environnement et clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let keysPromise: Promise<CryptoKeys> | null = null
function getKeys(): Promise<CryptoKeys> {
  keysPromise ??= deriveKeys(Deno.env.get('ENCRYPTION_KEY') ?? '').catch((err) => {
    keysPromise = null
    throw err
  })
  return keysPromise
}

// ---------------------------------------------------------------------------
// CORS et erreurs
// ---------------------------------------------------------------------------

// Origines autorisees : renseignees hors depot via le secret ALLOWED_ORIGINS
// (URLs separees par des virgules, ex. l'URL GitHub Pages du projet). Les
// origines localhost de dev restent toujours acceptees. Aucune URL en dur.
const CONFIGURED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = new Set([
  ...CONFIGURED_ORIGINS,
  'http://localhost:5173',
  'http://localhost:4173',
])
// Origine non reconnue -> 'null' (fail-closed) : un navigateur tiers n'obtient
// pas l'en-tete. La protection reelle des donnees reste le JWT, pas le CORS.
const FALLBACK_ORIGIN = CONFIGURED_ORIGINS[0] ?? 'null'

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

function requireMonth(value: unknown): string {
  if (typeof value !== 'string' || !MONTH_RE.test(value)) {
    throw new ApiError(400, 'mois invalide (YYYY-MM attendu)')
  }
  return value
}

function requireDate(value: unknown): string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    throw new ApiError(400, 'date invalide (YYYY-MM-DD attendue)')
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ApiError(400, `champ ${field} invalide`)
  }
  return value
}

// ---------------------------------------------------------------------------
// Acces aux donnees chiffrees
// ---------------------------------------------------------------------------

async function decryptRows<T>(
  table: string,
  userId: string,
  rows: { id: string; enc_payload: string }[],
): Promise<WithId<T>[]> {
  const keys = await getKeys()
  const context = [table, userId]
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      ...(await decryptJson<T>(keys, pgHexToBytes(row.enc_payload), context)),
    })),
  )
}

async function loadAll<T>(table: string, userId: string): Promise<WithId<T>[]> {
  const { data, error } = await admin
    .from(table)
    .select('id, enc_payload')
    .eq('user_id', userId)
    .limit(20000)
  if (error) throw new ApiError(500, `lecture ${table} impossible`)
  return decryptRows<T>(table, userId, data ?? [])
}

async function insertEncrypted(
  table: string,
  userId: string,
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<string> {
  const keys = await getKeys()
  const { data, error } = await admin
    .from(table)
    .insert({
      user_id: userId,
      enc_payload: bytesToPgHex(await encryptJson(keys, payload, [table, userId])),
      ...extra,
    })
    .select('id')
    .single()
  if (error) throw new ApiError(500, `ecriture ${table} impossible`)
  return data.id
}

async function updateEncrypted(
  table: string,
  userId: string,
  id: string,
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<void> {
  const keys = await getKeys()
  const { error } = await admin
    .from(table)
    .update({ enc_payload: bytesToPgHex(await encryptJson(keys, payload, [table, userId])), ...extra })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw new ApiError(500, `mise a jour ${table} impossible`)
}

// ---------------------------------------------------------------------------
// Assemblage moteur
// ---------------------------------------------------------------------------

interface DecryptedData {
  accounts: WithId<AccountPayload>[]
  groups: WithId<GroupPayload>[]
  categories: WithId<CategoryPayload>[]
  transactions: WithId<TxPayload>[]
  assignments: WithId<AssignmentPayload>[]
}

async function loadBudgetData(userId: string): Promise<DecryptedData> {
  const [accounts, groups, categories, transactions, assignments] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
    loadAll<TxPayload>('transactions', userId),
    loadAll<AssignmentPayload>('assignments', userId),
  ])
  return { accounts, groups, categories, transactions, assignments }
}

function toEngineInput(data: DecryptedData, month: string) {
  const accounts: EngineAccount[] = data.accounts.map((a) => ({ id: a.id, onBudget: a.onBudget }))
  const categories: EngineCategory[] = data.categories.map((c) => ({
    id: c.id,
    isIncome: c.isIncome,
  }))
  const transactions: EngineTransaction[] = data.transactions.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    categoryId: t.categoryId,
    month: t.bookingMonth,
    amount: t.amount,
    transferGroupId: t.transferGroupId ?? null,
  }))
  const assignments: EngineAssignment[] = data.assignments.map((a) => ({
    categoryId: a.categoryId,
    month: a.month,
    amount: a.amount,
  }))
  return { month, accounts, categories, transactions, assignments }
}

// ---------------------------------------------------------------------------
// Agregations rapports (portage serveur de app/src/lib/reports.ts)
// ---------------------------------------------------------------------------

function prevMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

function computeReports(data: DecryptedData, month: string) {
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const income = new Set(data.categories.filter((c) => c.isIncome).map((c) => c.id))
  const catToGroup = new Map(data.categories.map((c) => [c.id, c.groupId]))

  const isSpending = (t: TxPayload) =>
    t.amount < 0 &&
    !t.transferGroupId &&
    onBudget.has(t.accountId) &&
    (t.categoryId === null || !income.has(t.categoryId))

  const spendingOf = (m: string) =>
    data.transactions
      .filter((t) => t.bookingMonth === m && isSpending(t))
      .reduce((s, t) => s - t.amount, 0)
  const incomeOf = (m: string) =>
    data.transactions
      .filter(
        (t) =>
          t.bookingMonth === m &&
          t.categoryId !== null &&
          income.has(t.categoryId) &&
          onBudget.has(t.accountId) &&
          !t.transferGroupId,
      )
      .reduce((s, t) => s + t.amount, 0)

  const monthTxs = data.transactions.filter((t) => t.bookingMonth === month)
  const byGroup = new Map<string, number>()
  const byMerchant = new Map<string, { total: number; count: number }>()
  for (const t of monthTxs) {
    if (!isSpending(t)) continue
    const groupKey = t.categoryId ? (catToGroup.get(t.categoryId) ?? 'uncat') : 'uncat'
    byGroup.set(groupKey, (byGroup.get(groupKey) ?? 0) - t.amount)
    const merchant = byMerchant.get(t.label) ?? { total: 0, count: 0 }
    merchant.total -= t.amount
    merchant.count += 1
    byMerchant.set(t.label, merchant)
  }

  const cashflow = Array.from({ length: 6 }, (_, i) => {
    const m = prevMonth(month, i - 5)
    const inc = incomeOf(m)
    const spend = spendingOf(m)
    return { month: m, income: inc, spending: spend, net: inc - spend }
  })

  const rateMonth = prevMonth(month, -1)
  const rateIncome = incomeOf(rateMonth)
  const rateSpending = spendingOf(rateMonth)
  const prevIncome = incomeOf(prevMonth(month, -2))
  const prevSpending = spendingOf(prevMonth(month, -2))

  return {
    month,
    totalSpending: spendingOf(month),
    prevTotalSpending: spendingOf(prevMonth(month, -1)),
    spendingByGroup: (() => {
      const groupById = new Map(data.groups.map((g) => [g.id, g]))
      const named = [...byGroup.entries()]
        .filter(([key]) => key !== 'uncat')
        .map(([key, total]) => ({
          key,
          label: groupById.get(key)?.name ?? 'Autre',
          color: groupById.get(key)?.color ?? null,
          total,
        }))
        .sort((a, b) => b.total - a.total)
      const uncat = byGroup.get('uncat')
      if (uncat !== undefined) {
        named.push({ key: 'uncat', label: 'À catégoriser', color: null, total: uncat })
      }
      return named
    })(),
    topMerchants: [...byMerchant.entries()]
      .map(([label, v]) => ({ label, ...v }))
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
// Actions
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>

async function actionBootstrap(userId: string) {
  const data = await loadBudgetData(userId)
  const balances = new Map<string, number>()
  for (const t of data.transactions) {
    balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount)
  }
  const currentMonth = new Date().toISOString().slice(0, 7)
  return {
    accounts: data.accounts.map((a) => ({ ...a, balance: balances.get(a.id) ?? 0 })),
    groups: data.groups,
    categories: data.categories,
    uncategorizedCount: data.transactions.filter(
      (t) => !t.categoryId && !t.transferGroupId && t.bookingMonth <= currentMonth,
    ).length,
  }
}

async function actionGetBudgetMonth(userId: string, params: Params) {
  const month = requireMonth(params.month)
  const data = await loadBudgetData(userId)
  return computeBudget(toEngineInput(data, month))
}

async function actionGetTransactions(userId: string, params: Params) {
  const month = requireMonth(params.month)
  const keys = await getKeys()
  const idx = await txMonthIdx(keys, userId, month)
  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_payload')
    .eq('user_id', userId)
    .eq('month_idx', idx)
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  const rows = await decryptRows<TxPayload>('transactions', userId, data ?? [])
  rows.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1))
  return { transactions: rows }
}

async function actionListTransactions(userId: string) {
  const rows = await loadAll<TxPayload>('transactions', userId)
  rows.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1))
  return { transactions: rows }
}

async function actionGetReports(userId: string, params: Params) {
  const month = requireMonth(params.month)
  const data = await loadBudgetData(userId)
  return computeReports(data, month)
}

async function actionAddTransaction(userId: string, params: Params) {
  const accountId = requireUuid(params.accountId, 'accountId')
  const bookingDate = requireDate(params.date)
  const amount = requireAmount(params.amount)
  const label = requireText(params.label, 'label')
  const categoryId = params.categoryId == null ? null : requireUuid(params.categoryId, 'categoryId')
  const notes = params.notes == null ? null : requireText(params.notes, 'notes', 500)

  const [accounts, categories] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  if (!accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
  if (categoryId && !categories.some((c) => c.id === categoryId)) {
    throw new ApiError(404, 'categorie inconnue')
  }

  const bookingMonth = bookingDate.slice(0, 7)
  const keys = await getKeys()
  const payload: TxPayload = {
    accountId,
    categoryId,
    bookingDate,
    bookingMonth,
    amount,
    label,
    notes,
    transferGroupId: null,
  }
  // tx_hash reste NULL : saisie manuelle, pas de dedup (doublons legitimes)
  const id = await insertEncrypted('transactions', userId, payload, {
    month_idx: await txMonthIdx(keys, userId, bookingMonth),
  })
  return { id }
}

async function actionCategorizeTransaction(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')
  const categoryId = params.categoryId == null ? null : requireUuid(params.categoryId, 'categoryId')

  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_payload')
    .eq('user_id', userId)
    .eq('id', transactionId)
    .maybeSingle()
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  if (!data) throw new ApiError(404, 'transaction inconnue')

  if (categoryId) {
    const categories = await loadAll<CategoryPayload>('categories', userId)
    if (!categories.some((c) => c.id === categoryId)) throw new ApiError(404, 'categorie inconnue')
  }

  const keys = await getKeys()
  const payload = await decryptJson<TxPayload>(keys, pgHexToBytes(data.enc_payload), [
    'transactions',
    userId,
  ])
  if (payload.transferGroupId) throw new ApiError(400, 'un transfert ne se categorise pas')
  await updateEncrypted('transactions', userId, transactionId, { ...payload, categoryId })
  return { ok: true }
}

async function actionSetAssigned(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const month = requireMonth(params.month)
  const amount = requireAmount(params.amount)
  if (amount < 0) throw new ApiError(400, 'montant assigne negatif interdit')

  const categories = await loadAll<CategoryPayload>('categories', userId)
  const category = categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')
  if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne recoivent pas d assignation')

  const keys = await getKeys()
  const payload: AssignmentPayload = { categoryId, month, amount }
  const { error } = await admin.from('assignments').upsert(
    {
      user_id: userId,
      assign_idx: await assignIdx(keys, userId, categoryId, month),
      month_idx: await assignMonthIdx(keys, userId, month),
      enc_payload: bytesToPgHex(await encryptJson(keys, payload, ['assignments', userId])),
    },
    { onConflict: 'user_id,assign_idx' },
  )
  if (error) throw new ApiError(500, 'ecriture assignments impossible')
  return { ok: true }
}

async function actionCreateAccount(userId: string, params: Params) {
  const name = requireText(params.name, 'name', 80)
  const institution = requireText(params.institution, 'institution', 80)
  const kind = params.kind as AccountKind
  if (!['checking', 'savings', 'investment'].includes(kind)) {
    throw new ApiError(400, 'type de compte invalide')
  }
  const onBudget = params.onBudget !== false
  const openingBalance = requireAmount(params.openingBalance ?? 0)
  const openingDate = requireDate(params.openingDate ?? new Date().toISOString().slice(0, 10))

  const payload: AccountPayload = {
    name,
    institution,
    kind,
    onBudget,
    closed: false,
    connectionId: null,
    providerAccountUid: null,
  }
  const accountId = await insertEncrypted('accounts', userId, payload)

  if (openingBalance !== 0) {
    const categories = await loadAll<CategoryPayload>('categories', userId)
    // solde d'ouverture : inflow vers le RTA via une categorie de revenus
    const incomeCategory = categories.find((c) => c.isIncome && c.name === "Solde d'ouverture")
      ?? categories.find((c) => c.isIncome)
    if (onBudget && !incomeCategory) {
      throw new ApiError(409, "initialiser les categories d'abord (action seedDefaults)")
    }
    const keys = await getKeys()
    const bookingMonth = openingDate.slice(0, 7)
    const txPayload: TxPayload = {
      accountId,
      categoryId: onBudget ? (incomeCategory?.id ?? null) : null,
      bookingDate: openingDate,
      bookingMonth,
      amount: openingBalance,
      label: "Solde d'ouverture",
      transferGroupId: null,
    }
    await insertEncrypted('transactions', userId, txPayload, {
      month_idx: await txMonthIdx(keys, userId, bookingMonth),
    })
  }
  return { id: accountId }
}

const DEFAULT_STRUCTURE: { group: Omit<GroupPayload, 'sortOrder' | 'hidden'>; categories: string[] }[] = [
  { group: { name: 'Essentiels', color: 'blue', icon: 'home' }, categories: ['Loyer', 'Courses', 'Électricité & gaz', 'Internet & mobile', 'Assurances'] },
  { group: { name: 'Transport', color: 'amber', icon: 'car' }, categories: ['Transports en commun', 'Essence', 'VTC & taxi'] },
  { group: { name: 'Plaisirs', color: 'pink', icon: 'sparkles' }, categories: ['Restaurants', 'Shopping', 'Sorties & loisirs', 'Vacances'] },
  { group: { name: 'Abonnements', color: 'purple', icon: 'repeat' }, categories: ['Streaming', 'Musique', 'Stockage cloud'] },
  { group: { name: 'Épargne & objectifs', color: 'green', icon: 'piggy' }, categories: ["Fonds d'urgence", 'Cadeaux', 'Projets'] },
]

async function actionSeedDefaults(userId: string) {
  // Idempotence : les inserts PostgREST ne sont pas transactionnels. Un seed
  // complet possede forcement une categorie de revenus (inseree en premier) ;
  // un seed partiel (echec en cours de route) est purge puis rejoue.
  const [existingGroups, existingCategories] = await Promise.all([
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  const complete = existingGroups.length > 0 && existingCategories.some((c) => c.isIncome)
  if (complete) throw new ApiError(409, 'des categories existent deja')
  if (existingGroups.length > 0 || existingCategories.length > 0) {
    const delCats = await admin.from('categories').delete().eq('user_id', userId)
    const delGroups = await admin.from('category_groups').delete().eq('user_id', userId)
    if (delCats.error || delGroups.error) {
      throw new ApiError(500, 'purge du seed partiel impossible')
    }
  }

  // Le groupe Revenus d'abord : tout etat partiel garde une categorie isIncome
  const incomeGroupId = await insertEncrypted('category_groups', userId, {
    name: 'Revenus',
    color: 'teal',
    icon: 'banknote',
    sortOrder: DEFAULT_STRUCTURE.length + 1,
    hidden: false,
  } satisfies GroupPayload)
  const incomeNames = ['Salaire', 'Autres revenus', "Solde d'ouverture"]
  for (let i = 0; i < incomeNames.length; i++) {
    await insertEncrypted('categories', userId, {
      groupId: incomeGroupId,
      name: incomeNames[i],
      isIncome: true,
      sortOrder: i + 1,
      hidden: incomeNames[i] === "Solde d'ouverture",
    } satisfies CategoryPayload)
  }

  let sortOrder = 0
  for (const entry of DEFAULT_STRUCTURE) {
    sortOrder += 1
    const groupId = await insertEncrypted('category_groups', userId, {
      ...entry.group,
      sortOrder,
      hidden: false,
    } satisfies GroupPayload)
    let catOrder = 0
    for (const name of entry.categories) {
      catOrder += 1
      await insertEncrypted('categories', userId, {
        groupId,
        name,
        isIncome: false,
        sortOrder: catOrder,
        hidden: false,
      } satisfies CategoryPayload)
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, (userId: string, params: Params) => Promise<unknown>> = {
  bootstrap: (u) => actionBootstrap(u),
  getBudgetMonth: actionGetBudgetMonth,
  getTransactions: actionGetTransactions,
  listTransactions: (u) => actionListTransactions(u),
  getReports: actionGetReports,
  addTransaction: actionAddTransaction,
  categorizeTransaction: actionCategorizeTransaction,
  setAssigned: actionSetAssigned,
  createAccount: actionCreateAccount,
  seedDefaults: (u) => actionSeedDefaults(u),
}

// Lecture du corps bornee sur les octets REELLEMENT recus : l'en-tete
// Content-Length est controlee par le client (omission / Transfer-Encoding),
// on ne s'y fie pas. On annule la lecture des que la limite est depassee.
async function readBoundedBody(req: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ApiError(413, 'corps de requete trop volumineux')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'application/json' }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'methode non autorisee' }), { status: 405, headers })
  }

  let action = 'inconnue'
  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) throw new ApiError(401, 'authentification requise')
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: authError } = await authClient.auth.getUser()
    if (authError || !userData.user) throw new ApiError(401, 'session invalide')
    // App mono-utilisateur : allowlist OBLIGATOIRE (fail-closed). Sans
    // ALLOWED_USER_EMAILS configuree, aucune requete n'est servie, meme si le
    // signup du projet restait ouvert. C'est la config qui verrouille l'acces.
    const allowedEmails = (Deno.env.get('ALLOWED_USER_EMAILS') ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    if (allowedEmails.length === 0) {
      throw new ApiError(503, 'allowlist non configuree (ALLOWED_USER_EMAILS)')
    }
    const email = (userData.user.email ?? '').toLowerCase()
    if (!email || !allowedEmails.includes(email)) {
      throw new ApiError(403, 'acces non autorise')
    }
    const userId = userData.user.id

    const rawBody = await readBoundedBody(req, 64_000)
    let body: { action?: unknown; params?: unknown }
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody))
    } catch {
      throw new ApiError(400, 'corps JSON invalide')
    }
    if (typeof body?.action !== 'string' || !Object.hasOwn(ACTIONS, body.action)) {
      throw new ApiError(400, 'action inconnue')
    }
    action = body.action

    const result = await ACTIONS[action](userId, (body.params as Params) ?? {})
    return new Response(JSON.stringify(result), { status: 200, headers })
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`api action=${action} status=${err.status} message=${err.message}`)
      return new Response(JSON.stringify({ error: err.message }), { status: err.status, headers })
    }
    // erreur inattendue : message generique, jamais de contenu metier
    console.error(`api action=${action} status=500 erreur inattendue`)
    return new Response(JSON.stringify({ error: 'erreur interne' }), { status: 500, headers })
  }
})
