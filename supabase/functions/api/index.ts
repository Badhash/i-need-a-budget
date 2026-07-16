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
  normalizeLabel,
  base64ToBytes,
  bytesToBase64,
  targetIdx,
  txMonthIdx,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'

// ---------------------------------------------------------------------------
// Types des payloads chiffres (contrat du CLAUDE.md, section modele de donnees)
// ---------------------------------------------------------------------------

const ACCOUNT_KINDS = ['checking', 'savings', 'investment', 'card_deferred'] as const
type AccountKind = (typeof ACCOUNT_KINDS)[number]

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

// REF H : le payload transaction est scinde en deux colonnes chiffrees.
// - enc_core : champs legers (compte, categorie, mois, montant, transfert, date)
//   lus par le moteur budget, les rapports, le bootstrap et les soldes.
// - enc_text : champs lourds en texte libre (libelle, contrepartie, notes) lus
//   uniquement par la liste des transactions et les top-marchands des rapports.
// Chaque colonne a une AAD distincte (txCoreCtx / txTextCtx) : un ciphertext
// recopie d'une colonne a l'autre ne se dechiffre pas. Transport : les deux
// colonnes passent par la base64 de la REF D (enc_core_b64 / enc_text_b64 en
// lecture, decode(...,'base64') via enc_insert/enc_update en ecriture).
type TxCore = Pick<
  TxPayload,
  'accountId' | 'categoryId' | 'bookingDate' | 'bookingMonth' | 'amount' | 'transferGroupId'
>
type TxText = Pick<TxPayload, 'label' | 'counterparty' | 'notes'>

interface AssignmentPayload {
  categoryId: string
  month: string
  amount: number
}

const RULE_OPS = ['contains', 'equals', 'startsWith'] as const
type RuleOp = (typeof RULE_OPS)[number]

interface RuleMatcher {
  field: 'label'
  op: RuleOp
  value: string
}

interface RulePayload {
  matcher: RuleMatcher
  categoryId: string
  priority: number
}

type TargetType = 'monthly' | 'byDate'

interface TargetPayload {
  categoryId: string
  type: TargetType
  amount: number
  dueMonth: string | null
}

// Payload tolerant : sync-bank peut n'avoir pose que l'institution avant l'auth.
interface BankConnectionPayload {
  institution: string
  validUntil?: string | null
  sessionState?: string
  sessionId?: string
  accounts?: { uid: string; name?: string; iban?: string; product?: string }[]
}

// Contenu chiffre d'un sync_log (ecrit par sync-bank). run_at reste en clair
// cote colonne (retention) ; le reste du contenu est chiffre.
interface SyncLogPayload {
  connectionId: string | null
  status: 'ok' | 'error'
  importedCount: number
  error?: string
}

type BankConnectionStatus = 'active' | 'expiring' | 'expired' | 'pending'

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

function requirePriority(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ApiError(400, 'priority invalide')
  }
  return value
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ApiError(400, `champ ${field} invalide`)
  }
  return value
}

// Liste d'uuids non vide et sans doublon (reordonnancements).
function requireUuidArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, `champ ${field} invalide`)
  }
  const ids = value.map((v) => requireUuid(v, field))
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(400, `champ ${field} contient des doublons`)
  }
  return ids
}

// Valide un matcher de regle : seul le champ 'label' est supporte pour l'instant.
function requireMatcher(value: unknown): RuleMatcher {
  if (typeof value !== 'object' || value === null) {
    throw new ApiError(400, 'matcher invalide')
  }
  const m = value as Record<string, unknown>
  if (m.field !== 'label') throw new ApiError(400, 'matcher.field invalide')
  if (typeof m.op !== 'string' || !RULE_OPS.includes(m.op as RuleOp)) {
    throw new ApiError(400, 'matcher.op invalide')
  }
  const opValue = requireText(m.value, 'matcher.value', 200)
  if (!normalizeLabel(opValue)) throw new ApiError(400, 'valeur de regle vide apres normalisation')
  return { field: 'label', op: m.op as RuleOp, value: opValue }
}

// Comparaison pure d'un libelle a un matcher : insensible casse/accents des deux cotes.
function matchLabel(label: string, matcher: RuleMatcher): boolean {
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
  }
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
      ...(await decryptJson<T>(keys, base64ToBytes(row.enc_payload), context)),
    })),
  )
}

// Taille de page de lecture. PostgREST plafonne toute reponse a `db-max-rows`
// (1000 par defaut sur Supabase) : un simple `.limit(20000)` NE l'outrepasse
// PAS, la reponse est tronquee silencieusement a 1000 lignes. Il faut donc
// PAGINER avec `.range()` jusqu'a epuisement. Sans ca, tout calcul (RTA,
// rapports, export) est faux des que l'utilisateur depasse 1000 transactions.
const READ_PAGE = 1000

async function loadAllRows<R>(table: string, userId: string, columns: string): Promise<R[]> {
  const rows: R[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new ApiError(500, `lecture ${table} impossible`)
    if (!data || data.length === 0) break
    rows.push(...(data as R[]))
    if (data.length < READ_PAGE) break
  }
  return rows
}

async function loadAll<T>(table: string, userId: string): Promise<WithId<T>[]> {
  const rows = await loadAllRows<{ id: string; enc_payload: string }>(
    table,
    userId,
    'id, enc_payload:enc_b64',
  )
  return decryptRows<T>(table, userId, rows)
}

async function insertEncrypted(
  table: string,
  userId: string,
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<string> {
  const keys = await getKeys()
  // Ecriture via RPC enc_insert : enc_payload transporte en base64 (decode(...,
  // 'base64') cote Postgres). -33% de volume vs le litteral hex bytea.
  const row = {
    user_id: userId,
    enc_payload: bytesToBase64(await encryptJson(keys, payload, [table, userId])),
    ...extra,
  }
  const { data, error } = await admin.rpc('enc_insert', { p_table: table, p_rows: [row] })
  const id = Array.isArray(data) ? (data[0] as string | undefined) : undefined
  if (error || !id) throw new ApiError(500, `ecriture ${table} impossible`)
  return id
}

async function updateEncrypted(
  table: string,
  userId: string,
  id: string,
  payload: unknown,
  extra: Record<string, string> = {},
): Promise<void> {
  const keys = await getKeys()
  const { error } = await admin.rpc('enc_update', {
    p_table: table,
    p_user: userId,
    p_id: id,
    p_row: {
      enc_payload: bytesToBase64(await encryptJson(keys, payload, [table, userId])),
      ...extra,
    },
  })
  if (error) throw new ApiError(500, `mise a jour ${table} impossible`)
}

// ---------------------------------------------------------------------------
// Transactions : colonnes chiffrees enc_core / enc_text (REF H) sur transport
// base64 (REF D) + fallback legacy enc_payload
// ---------------------------------------------------------------------------

// Contextes AAD par colonne : lient chaque ciphertext a [table, colonne, user].
// L'ancien contexte ['transactions', user] reste utilise pour LIRE les lignes
// non encore migrees (colonne enc_payload). On n'ecrit plus jamais enc_payload.
const txCoreCtx = (userId: string): string[] => ['transactions', 'core', userId]
const txTextCtx = (userId: string): string[] => ['transactions', 'text', userId]

// Ligne transaction telle que lue en base : colonnes chiffrees exposees en
// base64 (computed columns REF D) + index en clair.
interface TxRow {
  id: string
  enc_core?: string | null
  enc_text?: string | null
  enc_payload?: string | null
  tx_hash?: string | null
}

// Reconstitue le payload complet. Ligne migree : enc_core + enc_text (AAD par
// colonne). Ligne legacy (enc_core NULL) : fallback sur enc_payload (ancienne
// AAD). Chaque colonne arrive en base64 (REF D) -> base64ToBytes avant dechiffrement.
async function decodeTx(keys: CryptoKeys, userId: string, row: TxRow): Promise<TxPayload> {
  if (row.enc_core) {
    const core = await decryptJson<TxCore>(keys, base64ToBytes(row.enc_core), txCoreCtx(userId))
    const text = row.enc_text
      ? await decryptJson<TxText>(keys, base64ToBytes(row.enc_text), txTextCtx(userId))
      : { label: '', counterparty: null, notes: null }
    return { ...core, ...text }
  }
  if (!row.enc_payload) throw new ApiError(500, 'transaction sans payload dechiffrable')
  return decryptJson<TxPayload>(keys, base64ToBytes(row.enc_payload), ['transactions', userId])
}

// Variante allegee : ne dechiffre QUE enc_core. Sur une ligne legacy,
// enc_payload contient deja tous les champs de core (superset), on le relit.
async function decodeTxCore(keys: CryptoKeys, userId: string, row: TxRow): Promise<TxCore> {
  if (row.enc_core) {
    return decryptJson<TxCore>(keys, base64ToBytes(row.enc_core), txCoreCtx(userId))
  }
  if (!row.enc_payload) throw new ApiError(500, 'transaction sans payload dechiffrable')
  return decryptJson<TxCore>(keys, base64ToBytes(row.enc_payload), ['transactions', userId])
}

// Colonnes chiffrees a ecrire pour une transaction, transportees en base64 (REF
// D) : enc_insert/enc_update les decodent via decode(...,'base64'). enc_payload
// est remis a NULL : toute ecriture (insert ou update) migre la ligne vers la
// forme scindee.
async function encodeTxColumns(
  keys: CryptoKeys,
  userId: string,
  payload: TxPayload,
): Promise<{ enc_core: string; enc_text: string; enc_payload: null }> {
  const core: TxCore = {
    accountId: payload.accountId,
    categoryId: payload.categoryId,
    bookingDate: payload.bookingDate,
    bookingMonth: payload.bookingMonth,
    amount: payload.amount,
    transferGroupId: payload.transferGroupId ?? null,
  }
  const text: TxText = {
    label: payload.label,
    counterparty: payload.counterparty ?? null,
    notes: payload.notes ?? null,
  }
  return {
    enc_core: bytesToBase64(await encryptJson(keys, core, txCoreCtx(userId))),
    enc_text: bytesToBase64(await encryptJson(keys, text, txTextCtx(userId))),
    enc_payload: null,
  }
}

// Insert d'une transaction (colonnes scindees) via la RPC enc_insert de la REF D.
// `extra` porte les index en clair (month_idx, tx_hash).
async function insertTx(
  userId: string,
  payload: TxPayload,
  extra: Record<string, string> = {},
): Promise<string> {
  const keys = await getKeys()
  const cols = await encodeTxColumns(keys, userId, payload)
  const { data, error } = await admin.rpc('enc_insert', {
    p_table: 'transactions',
    p_rows: [{ user_id: userId, ...cols, ...extra }],
  })
  const id = Array.isArray(data) ? (data[0] as string | undefined) : undefined
  if (error || !id) throw new ApiError(500, 'ecriture transactions impossible')
  return id
}

// Update d'une transaction (colonnes scindees, migre la ligne au passage) via la
// RPC enc_update de la REF D. enc_payload remis a NULL.
async function updateTx(
  userId: string,
  id: string,
  payload: TxPayload,
  extra: Record<string, string> = {},
): Promise<void> {
  const keys = await getKeys()
  const cols = await encodeTxColumns(keys, userId, payload)
  const { error } = await admin.rpc('enc_update', {
    p_table: 'transactions',
    p_user: userId,
    p_id: id,
    p_row: { ...cols, ...extra },
  })
  if (error) throw new ApiError(500, 'mise a jour transactions impossible')
}

// Chargements en masse (pagines). loadTxFull dechiffre les deux colonnes ;
// loadTxCore ne lit que enc_core (moins d'egress pour budget/bootstrap/soldes).
async function loadTxFull(userId: string): Promise<WithId<TxPayload>[]> {
  const rows = await loadAllRows<TxRow>(
    'transactions',
    userId,
    'id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64',
  )
  const keys = await getKeys()
  return Promise.all(rows.map(async (r) => ({ id: r.id, ...(await decodeTx(keys, userId, r)) })))
}

async function loadTxCore(userId: string): Promise<WithId<TxCore>[]> {
  const rows = await loadAllRows<TxRow>(
    'transactions',
    userId,
    'id, enc_core:enc_core_b64, enc_payload:enc_b64',
  )
  const keys = await getKeys()
  return Promise.all(rows.map(async (r) => ({ id: r.id, ...(await decodeTxCore(keys, userId, r)) })))
}

// ---------------------------------------------------------------------------
// Assemblage moteur
// ---------------------------------------------------------------------------

// Budget / bootstrap / soldes ne lisent QUE enc_core : transactions typees TxCore.
interface DecryptedData {
  accounts: WithId<AccountPayload>[]
  groups: WithId<GroupPayload>[]
  categories: WithId<CategoryPayload>[]
  transactions: WithId<TxCore>[]
  assignments: WithId<AssignmentPayload>[]
}

// Variante transactions COMPLETES (enc_core + enc_text) : liste des transactions
// et rapports (top-marchands ont besoin du libelle). TxPayload etant un superset
// de TxCore, une FullData est structurellement assignable a DecryptedData.
interface FullData {
  accounts: WithId<AccountPayload>[]
  groups: WithId<GroupPayload>[]
  categories: WithId<CategoryPayload>[]
  transactions: WithId<TxPayload>[]
  assignments: WithId<AssignmentPayload>[]
}

async function loadBudgetDataFromDb(userId: string): Promise<DecryptedData> {
  const [accounts, groups, categories, transactions, assignments] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
    loadTxCore(userId),
    loadAll<AssignmentPayload>('assignments', userId),
  ])
  return { accounts, groups, categories, transactions, assignments }
}

// Chargeur complet (taxonomie + assignments + transactions completes) : sert
// l'action consolidee bootstrapFull, qui a besoin du libelle pour la liste et
// les rapports.
async function loadFullBudgetData(userId: string): Promise<FullData> {
  const [accounts, groups, categories, transactions, assignments] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
    loadTxFull(userId),
    loadAll<AssignmentPayload>('assignments', userId),
  ])
  return { accounts, groups, categories, transactions, assignments }
}

// Chargeur allege pour les rapports : computeReports n'utilise jamais les
// assignments, on evite donc de charger cette table entiere (egress inutile).
// Transactions COMPLETES (les top-marchands lisent le libelle).
async function loadReportsData(userId: string): Promise<FullData> {
  const [accounts, groups, categories, transactions] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
    loadTxFull(userId),
  ])
  return { accounts, groups, categories, transactions, assignments: [] }
}

// ---------------------------------------------------------------------------
// Cache memoire TTL tres court de loadBudgetData (REF K) — reduction egress
// ---------------------------------------------------------------------------
//
// L'isolate Deno reste chaud quelques minutes : une meme invocation en sert
// plusieurs rapprochees (rafale bootstrap/getBudgetMonth/getReports au
// demarrage). Ce cache module-level, CLE STRICTEMENT PAR userId, evite de
// relire les 5 tables a chaque action en quelques ms.
//
// Garanties multi-tenant : la seule cle est le userId (jamais partage entre
// tenants). Aucun contenu dechiffre n'est jamais logge. TTL tres court pour
// borner toute fraicheur perdue. Toute action d'ecriture PURGE l'entree du
// user (voir invalidateBudgetCache + dispatcher) pour ne jamais servir du
// perime. On memorise la PROMISE (pas seulement la valeur resolue) pour
// dedupliquer aussi les chargements concurrents dans la meme invocation.
const BUDGET_CACHE_TTL_MS = 3_000
const budgetDataCache = new Map<string, { promise: Promise<DecryptedData>; expiresAt: number }>()

function invalidateBudgetCache(userId: string): void {
  budgetDataCache.delete(userId)
}

async function loadBudgetData(userId: string): Promise<DecryptedData> {
  const now = Date.now()
  const cached = budgetDataCache.get(userId)
  if (cached && cached.expiresAt > now) {
    return cached.promise
  }
  const promise = loadBudgetDataFromDb(userId).catch((err) => {
    // Ne jamais garder en cache un chargement en echec.
    const current = budgetDataCache.get(userId)
    if (current && current.promise === promise) budgetDataCache.delete(userId)
    throw err
  })
  budgetDataCache.set(userId, { promise, expiresAt: now + BUDGET_CACHE_TTL_MS })
  return promise
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

function computeReports(data: FullData, month: string) {
  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const income = new Set(data.categories.filter((c) => c.isIncome).map((c) => c.id))
  const catToGroup = new Map(data.categories.map((c) => [c.id, c.groupId]))

  const isSpending = (t: TxPayload) =>
    t.amount < 0 &&
    !t.transferGroupId &&
    onBudget.has(t.accountId) &&
    (t.categoryId === null || !income.has(t.categoryId))

  const isIncome = (t: TxPayload) =>
    t.categoryId !== null &&
    income.has(t.categoryId) &&
    onBudget.has(t.accountId) &&
    !t.transferGroupId

  // Un seul balayage : depense et revenu par mois comptable, memes predicats
  // qu'avant. spendingOf/incomeOf ne font plus que lire dans ces maps.
  const spendByMonth = new Map<string, number>()
  const incomeByMonth = new Map<string, number>()
  for (const t of data.transactions) {
    if (isSpending(t)) {
      spendByMonth.set(t.bookingMonth, (spendByMonth.get(t.bookingMonth) ?? 0) - t.amount)
    } else if (isIncome(t)) {
      incomeByMonth.set(t.bookingMonth, (incomeByMonth.get(t.bookingMonth) ?? 0) + t.amount)
    }
  }

  const spendingOf = (m: string) => spendByMonth.get(m) ?? 0
  const incomeOf = (m: string) => incomeByMonth.get(m) ?? 0

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

// Construit la reponse `bootstrap` (taxonomie + soldes) a partir de donnees deja
// dechiffrees : partage entre l'action bootstrap et l'action consolidee
// bootstrapFull (un seul loadBudgetData pour les deux).
function buildBootstrap(data: DecryptedData) {
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

// Liste complete des transactions (memes tri et forme que actionListTransactions)
// a partir de donnees deja dechiffrees.
function buildTransactionList(data: FullData) {
  const rows = data.transactions.slice()
  rows.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1))
  return { transactions: rows }
}

async function actionBootstrap(userId: string) {
  const data = await loadBudgetData(userId)
  return buildBootstrap(data)
}

// Action consolidee de demarrage : UN SEUL loadBudgetData (donc une seule
// lecture/dechiffrement de la table transactions) sert a produire d'un coup la
// taxonomie, le budget du mois, la liste des transactions et les agregats
// rapports du mois. Evite le double/triple chargement de la table transactions
// au lancement (bootstrap + getBudgetMonth + listTransactions). Le front hydrate
// les caches TanStack correspondants a partir de la reponse.
async function actionBootstrapFull(userId: string, params: Params) {
  const month = requireMonth(params.month)
  // Transactions COMPLETES : la reponse porte la liste des transactions (libelle)
  // et les top-marchands des rapports. Un seul chargement sert les 4 blocs.
  const data = await loadFullBudgetData(userId)
  return {
    bootstrap: buildBootstrap(data),
    budget: computeBudget(toEngineInput(data, month)),
    transactions: buildTransactionList(data).transactions,
    reports: computeReports(data, month),
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
    .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64')
    .eq('user_id', userId)
    .eq('month_idx', idx)
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  const rows = await Promise.all(
    (data ?? []).map(async (r) => ({ id: r.id, ...(await decodeTx(keys, userId, r as TxRow)) })),
  )
  rows.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1))
  return { transactions: rows }
}

async function actionListTransactions(userId: string) {
  const rows = await loadTxFull(userId)
  rows.sort((a, b) => (a.bookingDate < b.bookingDate ? 1 : -1))
  return { transactions: rows }
}

async function actionGetReports(userId: string, params: Params) {
  const month = requireMonth(params.month)
  const data = await loadReportsData(userId)
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
  const id = await insertTx(userId, payload, {
    month_idx: await txMonthIdx(keys, userId, bookingMonth),
  })
  return { id }
}

async function actionCategorizeTransaction(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')
  const categoryId = params.categoryId == null ? null : requireUuid(params.categoryId, 'categoryId')

  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64')
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
  const payload = await decodeTx(keys, userId, data as TxRow)
  if (payload.transferGroupId) throw new ApiError(400, 'un transfert ne se categorise pas')
  await updateTx(userId, transactionId, { ...payload, categoryId })
  return { ok: true }
}

async function actionUpdateTransaction(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')
  const accountId = requireUuid(params.accountId, 'accountId')
  const bookingDate = requireDate(params.date)
  const amount = requireAmount(params.amount)
  const label = requireText(params.label, 'label')
  const categoryId = params.categoryId == null ? null : requireUuid(params.categoryId, 'categoryId')
  const notes = params.notes == null ? null : requireText(params.notes, 'notes', 500)

  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64')
    .eq('user_id', userId)
    .eq('id', transactionId)
    .maybeSingle()
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  if (!data) throw new ApiError(404, 'transaction inconnue')

  const keys = await getKeys()
  const existing = await decodeTx(keys, userId, data as TxRow)
  // Un transfert doit rester coherent avec son miroir (montant oppose, meme
  // date) : on ne l'edite pas ici, l'utilisateur l'annule d'abord via
  // convertTransferToNormal.
  if (existing.transferGroupId) throw new ApiError(400, 'un transfert ne se modifie pas, annulez-le d abord')

  // Integrite referentielle verifiee en Edge Function (pas de FK SQL metier).
  const [accounts, categories] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  if (!accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')
  if (categoryId && !categories.some((c) => c.id === categoryId)) {
    throw new ApiError(404, 'categorie inconnue')
  }

  const bookingMonth = bookingDate.slice(0, 7)
  // On repart de l'existant pour preserver les champs non edites (counterparty).
  const payload: TxPayload = {
    ...existing,
    accountId,
    categoryId,
    bookingDate,
    bookingMonth,
    amount,
    label,
    notes,
  }
  // month_idx recalcule (identique si le mois n'a pas change). tx_hash n'est
  // PAS repasse en extra : il reste fige, la dedup des imports ne bouge pas
  // meme si le montant ou la date changent.
  await updateTx(userId, transactionId, payload, {
    month_idx: await txMonthIdx(keys, userId, bookingMonth),
  })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Transferts entre comptes (conversion d'une transaction existante)
// ---------------------------------------------------------------------------

async function actionConvertToTransfer(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')
  const targetAccountId = requireUuid(params.targetAccountId, 'targetAccountId')

  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64')
    .eq('user_id', userId)
    .eq('id', transactionId)
    .maybeSingle()
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  if (!data) throw new ApiError(404, 'transaction inconnue')

  const keys = await getKeys()
  const payload = await decodeTx(keys, userId, data as TxRow)
  if (payload.transferGroupId) throw new ApiError(400, 'transaction deja liee a un transfert')
  if (payload.accountId === targetAccountId) {
    throw new ApiError(400, 'le compte cible doit etre different du compte d origine')
  }
  const accounts = await loadAll<AccountPayload>('accounts', userId)
  const targetAccount = accounts.find((a) => a.id === targetAccountId)
  if (!targetAccount) throw new ApiError(400, 'compte cible inconnu')
  // Un compte clos ne recoit plus d'activite : meme regle que sync-bank.
  if (targetAccount.closed) throw new ApiError(400, 'compte cible cloture')

  const transferGroupId = crypto.randomUUID()
  // Transaction miroir sur le compte cible : montant oppose, sans categorie.
  // tx_hash reste NULL (ecriture non bancaire), month_idx comme actionAddTransaction.
  const mirror: TxPayload = {
    accountId: targetAccountId,
    categoryId: null,
    bookingDate: payload.bookingDate,
    bookingMonth: payload.bookingMonth,
    amount: -payload.amount,
    label: payload.label,
    counterparty: null,
    transferGroupId,
    notes: null,
  }
  // Ordre anti-orphelin : la transaction d'origine est mise a jour AVANT
  // l'insertion du miroir. Si l'insert echoue, rollback compensatoire de
  // l'origine ; un miroir orphelin fausserait silencieusement le solde du
  // compte cible, alors qu'un demi-transfert sur l'origine reste visible et
  // annulable via convertTransferToNormal.
  await updateTx(userId, transactionId, {
    ...payload,
    categoryId: null,
    transferGroupId,
  })
  try {
    await insertTx(userId, mirror, {
      month_idx: await txMonthIdx(keys, userId, payload.bookingMonth),
    })
  } catch (err) {
    try {
      await updateTx(userId, transactionId, payload)
    } catch {
      // Rollback impossible : l'origine reste liee a un groupe sans miroir,
      // etat reparable par convertTransferToNormal ou une nouvelle conversion.
    }
    throw err
  }
  return { ok: true, transferGroupId }
}

async function actionConvertTransferToNormal(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')

  // tx_hash est charge en clair pour distinguer un miroir systeme (tx_hash
  // NULL, ecriture synthetique) d'un vrai import bancaire (tx_hash non NULL,
  // cas des paires liees par sync-bank) : un import reel ne doit JAMAIS etre
  // supprime, sous peine de fausser durablement le solde du compte.
  const data = await loadAllRows<TxRow>(
    'transactions',
    userId,
    'id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64, tx_hash',
  )
  const keys = await getKeys()
  const rows = await Promise.all(
    data.map(async (row) => ({
      id: row.id,
      txHash: row.tx_hash ?? null,
      payload: await decodeTx(keys, userId, row),
    })),
  )
  const kept = rows.find((t) => t.id === transactionId)
  if (!kept) throw new ApiError(404, 'transaction inconnue')
  if (!kept.payload.transferGroupId) {
    throw new ApiError(400, 'la transaction n est pas un transfert')
  }

  const mirror = rows.find(
    (t) => t.payload.transferGroupId === kept.payload.transferGroupId && t.id !== transactionId,
  )
  if (mirror) {
    if (mirror.txHash === null) {
      // Miroir systeme : suppression sans perte de donnees bancaires.
      const { error: delErr } = await admin
        .from('transactions')
        .delete()
        .eq('user_id', userId)
        .eq('id', mirror.id)
      if (delErr) throw new ApiError(500, 'suppression transactions impossible')
    } else {
      // Import bancaire reel : on delie au lieu de supprimer, la transaction
      // redevient une ecriture normale a recategoriser.
      await updateTx(userId, mirror.id, {
        ...mirror.payload,
        transferGroupId: null,
      })
    }
  }
  // La transaction conservee redevient normale ; categoryId reste null,
  // l'utilisateur la recategorise ensuite.
  await updateTx(userId, transactionId, {
    ...kept.payload,
    transferGroupId: null,
  })
  return { ok: true }
}

async function actionDeleteTransaction(userId: string, params: Params) {
  const transactionId = requireUuid(params.transactionId, 'transactionId')

  const { data, error } = await admin
    .from('transactions')
    .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64, tx_hash')
    .eq('user_id', userId)
    .eq('id', transactionId)
    .maybeSingle()
  if (error) throw new ApiError(500, 'lecture transactions impossible')
  if (!data) throw new ApiError(404, 'transaction inconnue')

  const keys = await getKeys()
  const payload = await decodeTx(keys, userId, data as TxRow)

  // Transfert : le miroir est traite comme dans convertTransferToNormal —
  // supprime s'il est synthetique (tx_hash NULL), simplement delie s'il s'agit
  // d'un vrai import bancaire (jamais de perte de donnees bancaires implicite).
  if (payload.transferGroupId) {
    const rows = await loadAllRows<TxRow>(
      'transactions',
      userId,
      'id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64, tx_hash',
    )
    for (const row of rows) {
      if (row.id === transactionId) continue
      const other = await decodeTx(keys, userId, row)
      if (other.transferGroupId !== payload.transferGroupId) continue
      if ((row.tx_hash as string | null) === null) {
        const { error: delErr } = await admin
          .from('transactions')
          .delete()
          .eq('user_id', userId)
          .eq('id', row.id)
        if (delErr) throw new ApiError(500, 'suppression transactions impossible')
      } else {
        await updateTx(userId, row.id, {
          ...other,
          transferGroupId: null,
        })
      }
      break
    }
  }

  const { error: delErr } = await admin
    .from('transactions')
    .delete()
    .eq('user_id', userId)
    .eq('id', transactionId)
  if (delErr) throw new ApiError(500, 'suppression transactions impossible')
  return { ok: true }
}

async function actionSetAssigned(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const month = requireMonth(params.month)
  const amount = requireAmount(params.amount)
  // Un assigne negatif est autorise : il correspond a un RETRAIT d'enveloppe
  // vers le Pret a assigner (parite avec YNAB et avec l'import d'assignations,
  // actionImportReplaceAssignments, qui accepte deja des montants negatifs).
  // Le moteur d'enveloppes gere nativement les assignes negatifs : le
  // disponible de la categorie baisse et le RTA remonte d'autant.

  const categories = await loadAll<CategoryPayload>('categories', userId)
  const category = categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')
  if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne recoivent pas d assignation')

  const keys = await getKeys()
  const payload: AssignmentPayload = { categoryId, month, amount }
  const { error } = await admin.rpc('enc_insert', {
    p_table: 'assignments',
    p_rows: [
      {
        user_id: userId,
        assign_idx: await assignIdx(keys, userId, categoryId, month),
        month_idx: await assignMonthIdx(keys, userId, month),
        enc_payload: bytesToBase64(await encryptJson(keys, payload, ['assignments', userId])),
      },
    ],
    p_conflict: 'user_id,assign_idx',
  })
  if (error) throw new ApiError(500, 'ecriture assignments impossible')
  return { ok: true }
}

async function actionCreateAccount(userId: string, params: Params) {
  const name = requireText(params.name, 'name', 80)
  const institution = requireText(params.institution, 'institution', 80)
  const kind = params.kind as AccountKind
  if (!ACCOUNT_KINDS.includes(kind)) {
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
    await insertTx(userId, txPayload, {
      month_idx: await txMonthIdx(keys, userId, bookingMonth),
    })
  }
  return { id: accountId }
}

// Edition des metadonnees d'un compte : nom, etablissement, type. Le flag
// on_budget n'est PAS modifiable ici : le basculer changerait le RTA et la
// categorie du solde d'ouverture (hors perimetre, evite une incoherence moteur).
async function actionUpdateAccount(userId: string, params: Params) {
  const accountId = requireUuid(params.accountId, 'accountId')
  const name = params.name == null ? null : requireText(params.name, 'name', 80)
  const institution = params.institution == null ? null : requireText(params.institution, 'institution', 80)
  const kind = params.kind == null ? null : (params.kind as AccountKind)
  if (kind !== null && !ACCOUNT_KINDS.includes(kind)) {
    throw new ApiError(400, 'type de compte invalide')
  }

  const accounts = await loadAll<AccountPayload>('accounts', userId)
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new ApiError(404, 'compte inconnu')

  const { id, ...payload } = account
  const next: AccountPayload = { ...payload }
  if (name !== null) next.name = name
  if (institution !== null) next.institution = institution
  if (kind !== null) next.kind = kind
  await updateEncrypted('accounts', userId, id, next)
  return { ok: true }
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
  // Comptes attendus d'un seed complet : le groupe Revenus + les groupes de
  // DEFAULT_STRUCTURE, et les 3 categories de revenus + les categories de chaque
  // groupe. Un etat partiel (moins que ces comptes) est purge puis rejoue.
  const expectedGroups = DEFAULT_STRUCTURE.length + 1
  const expectedCats = 3 + DEFAULT_STRUCTURE.reduce((sum, entry) => sum + entry.categories.length, 0)
  const complete =
    existingGroups.length >= expectedGroups && existingCategories.length >= expectedCats
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
// Categories et groupes (CRUD, reordonnancement)
// ---------------------------------------------------------------------------

// Valeurs legales des groupes : memes couleurs/icones que le seed par defaut
// (DEFAULT_STRUCTURE + groupe Revenus).
const GROUP_COLORS = ['blue', 'amber', 'pink', 'purple', 'green', 'teal'] as const
const GROUP_ICONS = ['home', 'car', 'sparkles', 'repeat', 'piggy', 'banknote'] as const

function requireGroupColor(value: unknown): string {
  if (typeof value !== 'string' || !(GROUP_COLORS as readonly string[]).includes(value)) {
    throw new ApiError(400, 'champ color invalide')
  }
  return value
}

function requireGroupIcon(value: unknown): string {
  if (typeof value !== 'string' || !(GROUP_ICONS as readonly string[]).includes(value)) {
    throw new ApiError(400, 'champ icon invalide')
  }
  return value
}

// Position de fin de liste : max des sortOrder existants + 1.
function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1
}

async function actionCreateCategory(userId: string, params: Params) {
  const groupId = requireUuid(params.groupId, 'groupId')
  const name = requireText(params.name, 'name', 80)

  const [groups, categories] = await Promise.all([
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  if (!groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')

  const payload: CategoryPayload = {
    groupId,
    name,
    isIncome: false,
    sortOrder: nextSortOrder(categories.filter((c) => c.groupId === groupId)),
    hidden: false,
  }
  const id = await insertEncrypted('categories', userId, payload)
  return { id }
}

async function actionUpdateCategory(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const name = params.name == null ? null : requireText(params.name, 'name', 80)
  const groupId = params.groupId == null ? null : requireUuid(params.groupId, 'groupId')
  const hidden = params.hidden == null ? null : requireBoolean(params.hidden, 'hidden')

  const categories = await loadAll<CategoryPayload>('categories', userId)
  const category = categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')

  // Une categorie de revenus peut etre renommee, mais jamais cachee ni deplacee.
  if (category.isIncome && hidden === true) {
    throw new ApiError(400, 'une categorie de revenus ne peut pas etre cachee')
  }
  if (category.isIncome && groupId !== null && groupId !== category.groupId) {
    throw new ApiError(400, 'une categorie de revenus ne peut pas changer de groupe')
  }

  const { id, ...payload } = category
  const next: CategoryPayload = { ...payload }
  if (name !== null) next.name = name
  if (hidden !== null) next.hidden = hidden
  if (groupId !== null && groupId !== category.groupId) {
    const groups = await loadAll<GroupPayload>('category_groups', userId)
    if (!groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')
    // Un deplacement place la categorie a la fin du groupe cible.
    next.groupId = groupId
    next.sortOrder = nextSortOrder(categories.filter((c) => c.groupId === groupId))
  }
  await updateEncrypted('categories', userId, id, next)
  return { ok: true }
}

async function actionDeleteCategory(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')

  const categories = await loadAll<CategoryPayload>('categories', userId)
  const category = categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')
  if (category.isIncome) throw new ApiError(400, 'les categories de revenus ne se suppriment pas')

  const [transactions, assignments, targets, rules] = await Promise.all([
    loadTxFull(userId),
    loadAll<AssignmentPayload>('assignments', userId),
    loadAll<TargetPayload>('targets', userId),
    loadAll<RulePayload>('rules', userId),
  ])

  // Decategorise chaque transaction referencant la categorie ; pas d'extra :
  // month_idx et tx_hash des lignes restent intacts.
  let uncategorized = 0
  for (const tx of transactions) {
    if (tx.categoryId !== categoryId) continue
    const { id, ...payload } = tx
    await updateTx(userId, id, { ...payload, categoryId: null })
    uncategorized += 1
  }

  // Purge les assignations et objectifs orphelins (reference dans le payload,
  // suppression par id apres dechiffrement).
  const assignmentIds = assignments.filter((a) => a.categoryId === categoryId).map((a) => a.id)
  if (assignmentIds.length > 0) {
    const { error } = await admin
      .from('assignments')
      .delete()
      .eq('user_id', userId)
      .in('id', assignmentIds)
    if (error) throw new ApiError(500, 'suppression assignments impossible')
  }
  const targetIds = targets.filter((t) => t.categoryId === categoryId).map((t) => t.id)
  if (targetIds.length > 0) {
    const { error } = await admin
      .from('targets')
      .delete()
      .eq('user_id', userId)
      .in('id', targetIds)
    if (error) throw new ApiError(500, 'suppression targets impossible')
  }

  // Purge les regles pointant vers la categorie supprimee : sans cela,
  // sync-bank et applyRulesToUncategorized continueraient d'appliquer un
  // categoryId inexistant aux nouveaux imports (integrite referentielle
  // assuree ici, pas de FK SQL).
  const ruleIds = rules.filter((r) => r.categoryId === categoryId).map((r) => r.id)
  if (ruleIds.length > 0) {
    const { error } = await admin
      .from('rules')
      .delete()
      .eq('user_id', userId)
      .in('id', ruleIds)
    if (error) throw new ApiError(500, 'suppression rules impossible')
  }

  const { error } = await admin
    .from('categories')
    .delete()
    .eq('user_id', userId)
    .eq('id', categoryId)
  if (error) throw new ApiError(500, 'suppression categories impossible')
  return { ok: true, uncategorized }
}

async function actionCreateCategoryGroup(userId: string, params: Params) {
  const name = requireText(params.name, 'name', 80)
  // Defauts raisonnables si absents : couleur et icone neutres de la palette.
  const color = params.color == null ? 'blue' : requireGroupColor(params.color)
  const icon = params.icon == null ? 'sparkles' : requireGroupIcon(params.icon)

  const groups = await loadAll<GroupPayload>('category_groups', userId)
  const payload: GroupPayload = {
    name,
    color,
    icon,
    sortOrder: nextSortOrder(groups),
    hidden: false,
  }
  const id = await insertEncrypted('category_groups', userId, payload)
  return { id }
}

async function actionUpdateCategoryGroup(userId: string, params: Params) {
  const groupId = requireUuid(params.groupId, 'groupId')
  const name = params.name == null ? null : requireText(params.name, 'name', 80)
  const color = params.color == null ? null : requireGroupColor(params.color)
  const icon = params.icon == null ? null : requireGroupIcon(params.icon)
  const hidden = params.hidden == null ? null : requireBoolean(params.hidden, 'hidden')

  const groups = await loadAll<GroupPayload>('category_groups', userId)
  const group = groups.find((g) => g.id === groupId)
  if (!group) throw new ApiError(404, 'groupe inconnu')

  const { id, ...payload } = group
  const next: GroupPayload = { ...payload }
  if (name !== null) next.name = name
  if (color !== null) next.color = color
  if (icon !== null) next.icon = icon
  if (hidden !== null) next.hidden = hidden
  await updateEncrypted('category_groups', userId, id, next)
  return { ok: true }
}

async function actionDeleteCategoryGroup(userId: string, params: Params) {
  const groupId = requireUuid(params.groupId, 'groupId')

  const [groups, categories] = await Promise.all([
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  if (!groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')
  // Refus si des categories (meme cachees) referencent encore le groupe.
  if (categories.some((c) => c.groupId === groupId)) {
    throw new ApiError(
      400,
      'le groupe contient encore des categories : deplacez-les ou supprimez-les d abord',
    )
  }

  const { error } = await admin
    .from('category_groups')
    .delete()
    .eq('user_id', userId)
    .eq('id', groupId)
  if (error) throw new ApiError(500, 'suppression category_groups impossible')
  return { ok: true }
}

// Reecrit les sortOrder d'une liste : les ids fournis prennent leur index dans
// la liste, les lignes absentes conservent leur ordre relatif apres celles
// fournies. Seules les lignes dont l'ordre change sont reecrites.
async function applyOrder<T extends { sortOrder: number }>(
  table: string,
  userId: string,
  rows: WithId<T>[],
  orderedIds: string[],
): Promise<void> {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const provided = new Set(orderedIds)
  const rest = rows
    .filter((r) => !provided.has(r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : 1))
  const finalOrder = [...orderedIds.map((oid) => byId.get(oid)!), ...rest]
  for (let i = 0; i < finalOrder.length; i++) {
    if (finalOrder[i].sortOrder === i) continue
    const { id, ...payload } = finalOrder[i]
    await updateEncrypted(table, userId, id, { ...payload, sortOrder: i })
  }
}

async function actionReorderCategories(userId: string, params: Params) {
  const groupId = requireUuid(params.groupId, 'groupId')
  const orderedIds = requireUuidArray(params.orderedIds, 'orderedIds')

  const [groups, categories] = await Promise.all([
    loadAll<GroupPayload>('category_groups', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  if (!groups.some((g) => g.id === groupId)) throw new ApiError(404, 'groupe inconnu')

  // Chaque id fourni doit designer une categorie de l'utilisateur DANS ce groupe.
  const inGroup = categories.filter((c) => c.groupId === groupId)
  const inGroupIds = new Set(inGroup.map((c) => c.id))
  for (const oid of orderedIds) {
    if (!inGroupIds.has(oid)) throw new ApiError(400, 'categorie hors du groupe ou inconnue')
  }
  await applyOrder('categories', userId, inGroup, orderedIds)
  return { ok: true }
}

async function actionReorderCategoryGroups(userId: string, params: Params) {
  const orderedIds = requireUuidArray(params.orderedIds, 'orderedIds')

  const groups = await loadAll<GroupPayload>('category_groups', userId)
  const knownIds = new Set(groups.map((g) => g.id))
  for (const oid of orderedIds) {
    if (!knownIds.has(oid)) throw new ApiError(400, 'groupe inconnu dans orderedIds')
  }
  await applyOrder('category_groups', userId, groups, orderedIds)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Regles de categorisation automatique
// ---------------------------------------------------------------------------

// Garde partagee : la categorie doit exister et ne pas etre une categorie de revenus.
async function requireNonIncomeCategory(userId: string, categoryId: string): Promise<void> {
  const categories = await loadAll<CategoryPayload>('categories', userId)
  const category = categories.find((c) => c.id === categoryId)
  if (!category) throw new ApiError(404, 'categorie inconnue')
  if (category.isIncome) throw new ApiError(400, 'categorie de revenus interdite')
}

async function actionListRules(userId: string) {
  const rules = await loadAll<RulePayload>('rules', userId)
  rules.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))
  return { rules }
}

async function actionCreateRule(userId: string, params: Params) {
  const matcher = requireMatcher(params.matcher)
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  await requireNonIncomeCategory(userId, categoryId)

  const rules = await loadAll<RulePayload>('rules', userId)
  // Defaut : se place a la fin (priorite la plus basse) = max existant + 1.
  const priority =
    params.priority == null
      ? rules.reduce((max, r) => Math.max(max, r.priority), -1) + 1
      : requirePriority(params.priority)

  const payload: RulePayload = { matcher, categoryId, priority }
  const id = await insertEncrypted('rules', userId, payload)
  return { id }
}

async function actionUpdateRule(userId: string, params: Params) {
  const id = requireUuid(params.id, 'id')
  const matcher = requireMatcher(params.matcher)
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const priority = requirePriority(params.priority)
  await requireNonIncomeCategory(userId, categoryId)

  // Charge la ligne pour verifier son existence avant de remplacer le payload.
  const { data, error } = await admin
    .from('rules')
    .select('id')
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new ApiError(500, 'lecture rules impossible')
  if (!data) throw new ApiError(404, 'regle inconnue')

  const payload: RulePayload = { matcher, categoryId, priority }
  await updateEncrypted('rules', userId, id, payload)
  return { ok: true }
}

async function actionDeleteRule(userId: string, params: Params) {
  const id = requireUuid(params.id, 'id')
  const { error } = await admin.from('rules').delete().eq('user_id', userId).eq('id', id)
  if (error) throw new ApiError(500, 'suppression rules impossible')
  return { ok: true }
}

async function actionApplyRulesToUncategorized(userId: string) {
  const [rules, transactions] = await Promise.all([
    loadAll<RulePayload>('rules', userId),
    loadTxFull(userId),
  ])
  rules.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1))

  let categorized = 0
  for (const tx of transactions) {
    // On ne touche qu'aux transactions non categorisees et hors transfert.
    if (tx.categoryId || tx.transferGroupId) continue
    const rule = rules.find((r) => matchLabel(tx.label, r.matcher))
    if (!rule) continue
    // On retire id du payload et on ne passe PAS d'extra : month_idx et
    // tx_hash de la ligne restent intacts.
    const { id, ...payload } = tx
    await updateTx(userId, id, { ...payload, categoryId: rule.categoryId })
    categorized += 1
  }
  return { categorized }
}

// ---------------------------------------------------------------------------
// Objectifs (targets)
// ---------------------------------------------------------------------------

async function actionListTargets(userId: string) {
  const targets = await loadAll<TargetPayload>('targets', userId)
  return { targets }
}

async function actionSetTarget(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const type = params.type
  if (type !== 'monthly' && type !== 'byDate') {
    throw new ApiError(400, 'type d objectif invalide')
  }
  const amount = requireAmount(params.amount)
  if (amount <= 0) throw new ApiError(400, 'montant d objectif invalide')
  const dueMonth = type === 'byDate' ? requireMonth(params.dueMonth) : null
  await requireNonIncomeCategory(userId, categoryId)

  const keys = await getKeys()
  const payload: TargetPayload = { categoryId, type, amount, dueMonth }
  // Upsert par target_idx : un seul objectif par categorie (modele actionSetAssigned).
  const { error } = await admin.rpc('enc_insert', {
    p_table: 'targets',
    p_rows: [
      {
        user_id: userId,
        target_idx: await targetIdx(keys, userId, categoryId),
        enc_payload: bytesToBase64(await encryptJson(keys, payload, ['targets', userId])),
      },
    ],
    p_conflict: 'user_id,target_idx',
  })
  if (error) throw new ApiError(500, 'ecriture targets impossible')
  return { ok: true }
}

async function actionDeleteTarget(userId: string, params: Params) {
  const categoryId = requireUuid(params.categoryId, 'categoryId')
  const keys = await getKeys()
  const idx = await targetIdx(keys, userId, categoryId)
  const { error } = await admin.from('targets').delete().eq('user_id', userId).eq('target_idx', idx)
  if (error) throw new ApiError(500, 'suppression targets impossible')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Connexions bancaires (lecture de statut)
// ---------------------------------------------------------------------------

const EXPIRY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

// IBAN masque cote serveur : seuls le pays et les 4 derniers chiffres quittent
// le serveur (l'IBAN complet reste chiffre en base, jamais expose au front).
function maskIban(iban: string): string {
  const clean = iban.replace(/\s+/g, '')
  if (clean.length <= 8) return clean
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`
}

async function actionGetBankConnections(userId: string) {
  const [rows, accounts] = await Promise.all([
    loadAll<BankConnectionPayload>('bank_connections', userId),
    loadAll<AccountPayload>('accounts', userId),
  ])
  // uid provider -> compte local lie (pour afficher l'etat de liaison).
  const byUid = new Map<string, { id: string; name: string }>()
  for (const a of accounts) {
    if (a.providerAccountUid) byUid.set(a.providerAccountUid, { id: a.id, name: a.name })
  }
  const now = Date.now()
  const connections = rows.map((p) => {
    const validUntil = p.validUntil ?? null
    let status: BankConnectionStatus
    if (!validUntil) {
      status = 'pending'
    } else {
      const expiry = new Date(validUntil).getTime()
      if (Number.isNaN(expiry) || expiry < now) status = 'expired'
      else if (expiry < now + EXPIRY_WINDOW_MS) status = 'expiring'
      else status = 'active'
    }
    const ebAccounts = (p.accounts ?? []).map((acc) => {
      const linked = byUid.get(acc.uid) ?? null
      return {
        uid: acc.uid,
        name: acc.name ?? null,
        iban: acc.iban ? maskIban(acc.iban) : null,
        product: acc.product ?? null,
        linkedAccountId: linked?.id ?? null,
        linkedAccountName: linked?.name ?? null,
      }
    })
    return { id: p.id, institution: p.institution, validUntil, status, accounts: ebAccounts }
  })
  return { connections }
}

// Lie (ou detache) un compte bancaire Enable Banking (uid) a un compte local.
// Un uid ne peut etre lie qu'a un seul compte : on detache tout autre compte.
async function actionLinkBankAccount(userId: string, params: Params) {
  const connectionId = requireUuid(params.connectionId, 'connectionId')
  const providerAccountUid = requireText(params.providerAccountUid, 'providerAccountUid', 200)
  const accountId =
    params.accountId == null || params.accountId === ''
      ? null
      : requireUuid(params.accountId, 'accountId')

  const accounts = await loadAll<AccountPayload>('accounts', userId)
  if (accountId && !accounts.some((a) => a.id === accountId)) throw new ApiError(404, 'compte inconnu')

  for (const a of accounts) {
    if (a.providerAccountUid === providerAccountUid && a.id !== accountId) {
      const { id, ...rest } = a
      await updateEncrypted('accounts', userId, id, {
        ...rest,
        providerAccountUid: null,
        connectionId: null,
      })
    }
  }
  if (accountId) {
    const target = accounts.find((a) => a.id === accountId)!
    const { id, ...rest } = target
    await updateEncrypted('accounts', userId, id, { ...rest, connectionId, providerAccountUid })
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Sante de la synchronisation (lecture des sync_logs)
// ---------------------------------------------------------------------------

// Renvoie en clair les N derniers runs de synchronisation (run_at en clair,
// reste dechiffre en memoire). Une entree indechiffrable est ignoree : elle ne
// doit pas casser l'affichage de l'historique. Aucun payload n'est logge.
async function actionListSyncLogs(userId: string) {
  const keys = await getKeys()
  const { data, error } = await admin
    .from('sync_logs')
    .select('id, enc_payload:enc_b64, run_at')
    .eq('user_id', userId)
    .order('run_at', { ascending: false })
    .limit(10)
  if (error) throw new ApiError(500, 'lecture sync_logs impossible')

  const logs: {
    id: string
    runAt: string
    status: 'ok' | 'error'
    importedCount: number
    error: string | null
  }[] = []
  for (const row of data ?? []) {
    try {
      const payload = await decryptJson<SyncLogPayload>(keys, base64ToBytes(row.enc_payload), [
        'sync_logs',
        userId,
      ])
      logs.push({
        id: row.id as string,
        runAt: String(row.run_at),
        status: payload.status,
        importedCount: payload.importedCount,
        error: payload.error ?? null,
      })
    } catch {
      // Entree corrompue / indechiffrable : ignoree, ne bloque pas l'historique.
    }
  }
  return { logs }
}

// ---------------------------------------------------------------------------
// Export complet (donnees dechiffrees, avec id)
// ---------------------------------------------------------------------------

async function actionExportData(userId: string) {
  const [accounts, groups, categories, transactions, assignments, targets, rules] =
    await Promise.all([
      loadAll<AccountPayload>('accounts', userId),
      loadAll<GroupPayload>('category_groups', userId),
      loadAll<CategoryPayload>('categories', userId),
      loadTxFull(userId),
      loadAll<AssignmentPayload>('assignments', userId),
      loadAll<TargetPayload>('targets', userId),
      loadAll<RulePayload>('rules', userId),
    ])
  return {
    exportedAt: new Date().toISOString(),
    accounts,
    groups,
    categories,
    transactions,
    assignments,
    targets,
    rules,
  }
}

// ---------------------------------------------------------------------------
// Backfill REF H : migration des lignes legacy (enc_payload) vers enc_core/enc_text
// ---------------------------------------------------------------------------

// Rechiffre par lots les transactions non migrees (enc_core NULL) : dechiffre
// l'ancien enc_payload (lu en base64, REF D) puis reecrit enc_core + enc_text via
// updateTx (qui remet enc_payload a NULL). month_idx et tx_hash restent intacts.
// Idempotent : une ligne migree sort du filtre, relancer l'action ne retouche
// rien. A appeler APRES le deploiement du code compatible et l'ajout des colonnes
// et RPC SQL (H-split-payload.sql compose avec D).
async function actionMigrateSplitPayload(userId: string) {
  const keys = await getKeys()
  const BATCH = 200
  let migrated = 0
  for (;;) {
    const { data, error } = await admin
      .from('transactions')
      .select('id, enc_payload:enc_b64')
      .eq('user_id', userId)
      .is('enc_core', null)
      .not('enc_payload', 'is', null)
      .limit(BATCH)
    if (error) throw new ApiError(500, 'lecture transactions impossible')
    if (!data || data.length === 0) break
    for (const row of data) {
      const payload = await decryptJson<TxPayload>(
        keys,
        base64ToBytes(row.enc_payload as string),
        ['transactions', userId],
      )
      await updateTx(userId, row.id as string, payload)
      migrated += 1
    }
  }
  return { migrated }
}

// ---------------------------------------------------------------------------
// Import YNAB -> INAB (destructif : remplace toutes les donnees budget)
// ---------------------------------------------------------------------------

// Validateurs specifiques a l'import par lots.
function requireArray(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) throw new ApiError(400, `champ ${field} invalide`)
  if (value.length > max) throw new ApiError(400, `champ ${field} trop volumineux (max ${max})`)
  return value
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, `champ ${field} invalide`)
  }
  return value as Record<string, unknown>
}

function requireAccountKind(value: unknown): AccountKind {
  if (typeof value !== 'string' || !ACCOUNT_KINDS.includes(value as AccountKind)) {
    throw new ApiError(400, 'type de compte invalide')
  }
  return value as AccountKind
}

// Tables budget effacees par un import destructif. PERIMETRE VOLONTAIREMENT
// LIMITE : bank_connections et sync_logs sont EXCLUS. Ce sont des tables
// d'infrastructure Enable Banking (session PSD2 de 180 jours + historique de
// synchronisation) ; les preserver permet de continuer a synchroniser la banque
// apres un import YNAB sans redemander le consentement. Aucune FK SQL metier
// n'existe (les references vivent dans le payload chiffre) : l'ordre de
// suppression est indifferent.
const BUDGET_TABLES = [
  'transactions',
  'assignments',
  'targets',
  'rules',
  'categories',
  'category_groups',
  'accounts',
] as const

async function wipeUserBudget(userId: string): Promise<void> {
  for (const table of BUDGET_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error) throw new ApiError(500, `effacement ${table} impossible`)
  }
}

async function actionImportReplaceBegin(userId: string, params: Params) {
  // Bornes anti-DoS (le corps est deja borne a 64 ko, ceci borne le travail).
  const rawAccounts = requireArray(params.accounts, 'accounts', 50)
  const rawGroups = requireArray(params.groups, 'groups', 200)
  const rawCategories = requireArray(params.categories, 'categories', 1000)

  // On valide TOUT avant d'effacer quoi que ce soit : un import invalide ne doit
  // jamais laisser l'utilisateur avec des donnees a moitie detruites.
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
      institution:
        o.institution == null ? 'Import YNAB' : requireText(o.institution, 'accounts.institution', 80),
      kind: o.kind == null ? ('checking' as AccountKind) : requireAccountKind(o.kind),
      onBudget: o.onBudget == null ? true : requireBoolean(o.onBudget, 'accounts.onBudget'),
    }
  })

  // Effacement destructif (perimetre BUDGET_TABLES, bancaire preserve). Relancer
  // l'import re-efface proprement : l'operation est idempotente en tete.
  await wipeUserBudget(userId)

  // Groupes -> map groupKey -> id serveur.
  const groupIdByKey = new Map<string, string>()
  let groupSort = 0
  for (const g of groupInputs) {
    groupSort += 1
    const id = await insertEncrypted('category_groups', userId, {
      name: g.name,
      color: g.color,
      icon: g.icon,
      sortOrder: groupSort,
      hidden: g.hidden,
    } satisfies GroupPayload)
    groupIdByKey.set(g.key, id)
  }

  // Categories -> map categoryKey -> id serveur (sortOrder incremental par groupe).
  const categoryIdByKey = new Map<string, string>()
  const catSortByGroup = new Map<string, number>()
  let hasIncome = false
  for (const c of catInputs) {
    const groupServerId = groupIdByKey.get(c.groupKey)
    // Groupe non resolu (key incoherente) : categorie ignoree silencieusement.
    // Ses eventuelles transactions retomberont sur categoryId null cote client.
    if (!groupServerId) continue
    const nextSort = (catSortByGroup.get(groupServerId) ?? 0) + 1
    catSortByGroup.set(groupServerId, nextSort)
    const id = await insertEncrypted('categories', userId, {
      groupId: groupServerId,
      name: c.name,
      isIncome: c.isIncome,
      sortOrder: nextSort,
      // Invariant du modele : une categorie de revenus n'est jamais masquee.
      hidden: c.isIncome ? false : c.hidden,
    } satisfies CategoryPayload)
    categoryIdByKey.set(c.key, id)
    if (c.isIncome) hasIncome = true
  }

  // Garantie du moteur : au moins une categorie de revenus doit exister (sinon
  // aucun RTA calculable). On en cree une par defaut si l'import n'en fournit pas.
  let incomeFallbackId: string | undefined
  if (!hasIncome) {
    groupSort += 1
    const incomeGroupId = await insertEncrypted('category_groups', userId, {
      name: 'Revenus',
      color: 'teal',
      icon: 'banknote',
      sortOrder: groupSort,
      hidden: false,
    } satisfies GroupPayload)
    incomeFallbackId = await insertEncrypted('categories', userId, {
      groupId: incomeGroupId,
      name: 'Revenus',
      isIncome: true,
      sortOrder: 1,
      hidden: false,
    } satisfies CategoryPayload)
  }

  // Comptes -> map accountKey -> id serveur.
  const accountIdByKey = new Map<string, string>()
  for (const a of accInputs) {
    const id = await insertEncrypted('accounts', userId, {
      name: a.name,
      institution: a.institution,
      kind: a.kind,
      onBudget: a.onBudget,
      closed: false,
      connectionId: null,
      providerAccountUid: null,
    } satisfies AccountPayload)
    accountIdByKey.set(a.key, id)
  }

  return {
    accountMap: Object.fromEntries(accountIdByKey),
    categoryMap: Object.fromEntries(categoryIdByKey),
    incomeFallbackId,
  }
}

async function actionImportReplaceTransactions(userId: string, params: Params) {
  const raw = requireArray(params.transactions, 'transactions', 200)

  // Chargement des ids valides UNE fois (integrite referentielle : pas de FK SQL).
  const [accounts, categories] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  const accountIds = new Set(accounts.map((a) => a.id))
  const categoryIds = new Set(categories.map((c) => c.id))

  const keys = await getKeys()
  const rows: {
    user_id: string
    enc_core: string
    enc_text: string
    enc_payload: null
    month_idx: string
  }[] = []
  for (const t of raw) {
    const o = requireObject(t, 'transactions[]')
    const accountId = requireUuid(o.accountId, 'accountId')
    if (!accountIds.has(accountId)) throw new ApiError(404, 'compte inconnu')
    const categoryId = o.categoryId == null ? null : requireUuid(o.categoryId, 'categoryId')
    if (categoryId && !categoryIds.has(categoryId)) throw new ApiError(404, 'categorie inconnue')
    const bookingDate = requireDate(o.date)
    const amount = requireAmount(o.amount)
    const label = requireText(o.label, 'label', 200)
    const counterparty =
      o.counterparty == null ? null : requireText(o.counterparty, 'counterparty', 200)
    const notes = o.notes == null ? null : requireText(o.notes, 'notes', 500)
    const bookingMonth = bookingDate.slice(0, 7)
    const payload: TxPayload = {
      accountId,
      categoryId,
      bookingDate,
      bookingMonth,
      amount,
      label,
      counterparty,
      transferGroupId: null,
      notes,
    }
    // tx_hash reste NULL : saisie non bancaire (la dedup ne concerne que les
    // imports Enable Banking). month_idx calcule pour le filtre par mois.
    rows.push({
      user_id: userId,
      ...(await encodeTxColumns(keys, userId, payload)),
      month_idx: await txMonthIdx(keys, userId, bookingMonth),
    })
  }
  if (rows.length > 0) {
    const { error } = await admin.rpc('enc_insert', { p_table: 'transactions', p_rows: rows })
    if (error) throw new ApiError(500, 'ecriture transactions impossible')
  }
  return { inserted: rows.length }
}

async function actionImportReplaceAssignments(userId: string, params: Params) {
  const raw = requireArray(params.assignments, 'assignments', 500)

  const categories = await loadAll<CategoryPayload>('categories', userId)
  const byId = new Map(categories.map((c) => [c.id, c]))

  const keys = await getKeys()
  const rows: { user_id: string; assign_idx: string; month_idx: string; enc_payload: string }[] = []
  for (const a of raw) {
    const o = requireObject(a, 'assignments[]')
    const categoryId = requireUuid(o.categoryId, 'categoryId')
    const category = byId.get(categoryId)
    if (!category) throw new ApiError(404, 'categorie inconnue')
    if (category.isIncome) {
      throw new ApiError(400, 'les categories de revenus ne recoivent pas d assignation')
    }
    const month = requireMonth(o.month)
    // Contrairement a setAssigned (saisie manuelle, >= 0), l'import YNAB accepte
    // les montants NEGATIFS : dans YNAB, retirer de l'argent d'une enveloppe se
    // traduit par un "Assigned" negatif sur le mois. Le moteur les gere
    // nativement (available = rollover + assigned + activity) et les ignorer
    // fausserait massivement le Ready to Assign (somme des assignes gonflee).
    const amount = requireAmount(o.amount)
    const payload: AssignmentPayload = { categoryId, month, amount }
    rows.push({
      user_id: userId,
      assign_idx: await assignIdx(keys, userId, categoryId, month),
      month_idx: await assignMonthIdx(keys, userId, month),
      enc_payload: bytesToBase64(await encryptJson(keys, payload, ['assignments', userId])),
    })
  }
  if (rows.length > 0) {
    // Upsert par (user_id, assign_idx) : idempotent si un meme (categorie, mois)
    // revient dans un lot ulterieur. Le parser garantit l'unicite intra-lot.
    const { error } = await admin.rpc('enc_insert', {
      p_table: 'assignments',
      p_rows: rows,
      p_conflict: 'user_id,assign_idx',
    })
    if (error) throw new ApiError(500, 'ecriture assignments impossible')
  }
  return { upserted: rows.length }
}

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

const ACTIONS: Record<string, (userId: string, params: Params) => Promise<unknown>> = {
  bootstrap: (u) => actionBootstrap(u),
  bootstrapFull: actionBootstrapFull,
  getBudgetMonth: actionGetBudgetMonth,
  getTransactions: actionGetTransactions,
  listTransactions: (u) => actionListTransactions(u),
  getReports: actionGetReports,
  addTransaction: actionAddTransaction,
  categorizeTransaction: actionCategorizeTransaction,
  setAssigned: actionSetAssigned,
  createAccount: actionCreateAccount,
  updateAccount: actionUpdateAccount,
  seedDefaults: (u) => actionSeedDefaults(u),
  createCategory: actionCreateCategory,
  updateCategory: actionUpdateCategory,
  deleteCategory: actionDeleteCategory,
  createCategoryGroup: actionCreateCategoryGroup,
  updateCategoryGroup: actionUpdateCategoryGroup,
  deleteCategoryGroup: actionDeleteCategoryGroup,
  reorderCategories: actionReorderCategories,
  reorderCategoryGroups: actionReorderCategoryGroups,
  updateTransaction: actionUpdateTransaction,
  convertToTransfer: actionConvertToTransfer,
  convertTransferToNormal: actionConvertTransferToNormal,
  deleteTransaction: actionDeleteTransaction,
  listRules: (u) => actionListRules(u),
  createRule: actionCreateRule,
  updateRule: actionUpdateRule,
  deleteRule: actionDeleteRule,
  applyRulesToUncategorized: (u) => actionApplyRulesToUncategorized(u),
  listTargets: (u) => actionListTargets(u),
  setTarget: actionSetTarget,
  deleteTarget: actionDeleteTarget,
  getBankConnections: (u) => actionGetBankConnections(u),
  linkBankAccount: actionLinkBankAccount,
  listSyncLogs: (u) => actionListSyncLogs(u),
  exportData: (u) => actionExportData(u),
  migrateSplitPayload: (u) => actionMigrateSplitPayload(u),
  importReplaceBegin: actionImportReplaceBegin,
  importReplaceTransactions: actionImportReplaceTransactions,
  importReplaceAssignments: actionImportReplaceAssignments,
}

// Actions strictement en LECTURE : elles ne modifient aucune table, donc ne
// purgent pas le cache loadBudgetData (elles peuvent au contraire le peupler /
// le consommer pendant une rafale). Toute action ABSENTE de cet ensemble est
// traitee comme une ecriture : le dispatcher purge alors l'entree du user
// AVANT execution, garantissant qu'aucune lecture ulterieure (meme invocation
// chaude) ne serve un etat perime. Choix fail-safe : une action mal classee en
// ecriture ne fait que rater le cache (correct), jamais servir du perime.
const READ_ONLY_ACTIONS = new Set<string>([
  'bootstrap',
  'bootstrapFull',
  'getBudgetMonth',
  'getTransactions',
  'listTransactions',
  'getReports',
  'listRules',
  'listTargets',
  'getBankConnections',
  'listSyncLogs',
  'exportData',
])

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

    // Ecriture : purge le cache du user AVANT execution pour ne jamais servir
    // du perime (cle stricte par userId, aucun effet inter-tenant).
    if (!READ_ONLY_ACTIONS.has(action)) {
      invalidateBudgetCache(userId)
    }

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
