// Edge Function sync-bank — connexion bancaire Enable Banking (PSD2).
//
// AVERTISSEMENT : implementation NON TESTEE, conforme a la doc Enable Banking,
// a valider une fois l'app Enable Banking approuvee (production restreinte).
// Chaque hypothese sur la forme des reponses de l'API EB est commentee "HYP EB".
//
// Flux :
//   - startAuth   : construit le JWT RS256 EB, ouvre une session d'autorisation
//                   PSD2, renvoie l'URL de redirection vers la banque.
//   - finalizeAuth: echange le code de retour contre une session EB, chiffre et
//                   stocke la bank_connection (session_id, comptes, expiration).
//   - sync        : poll des transactions, mapping -> payload chiffre, dedup via
//                   tx_hash, categorisation par regles, liaison des reglements
//                   de carte a debit differe, journalisation.
//   - reconcile   : compare le solde Enable Banking de chaque compte lie au
//                   solde local (somme des transactions dechiffrees) et absorbe
//                   l'ecart dans la transaction "Solde d'ouverture".
//
// verify_jwt = false cote plateforme (voir config.toml) : on verifie a la main.
//   - header 'x-cron-secret' == SYNC_CRON_SECRET (non vide) -> mode CRON (tous
//     les utilisateurs, appele par pg_cron via pg_net).
//   - sinon : JWT utilisateur exige (auth.getUser + allowlist), agit sur ce user.
//
// INTERDIT : logger un payload dechiffre, la cle, un token EB, ou tout contenu
// metier. Les logs se limitent a : action, code, message statique.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  base64Decode,
  base64ToBytes,
  base64UrlEncode,
  bytesToBase64,
  decryptJson,
  deriveKeys,
  encryptJson,
  normalizeLabel,
  txHashIdx,
  txMonthIdx,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import { aggMarkStale, aggRecompute } from '../api/aggregates.ts'

// ---------------------------------------------------------------------------
// Types des payloads chiffres (memes contrats que l'Edge Function /api)
// ---------------------------------------------------------------------------

interface AccountPayload {
  name: string
  institution: string
  kind: 'checking' | 'savings' | 'investment' | 'card_deferred'
  onBudget: boolean
  closed: boolean
  connectionId?: string | null
  providerAccountUid?: string | null
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

// REF H : payload transaction scinde en enc_core (leger) et enc_text (lourd),
// chiffres avec une AAD distincte par colonne. Meme contrat que l'Edge /api.
// Transport base64 (REF D) : colonnes lues via enc_core_b64/enc_text_b64,
// ecrites via enc_insert/enc_update (decode(...,'base64')).
type TxCore = Pick<
  TxPayload,
  'accountId' | 'categoryId' | 'bookingDate' | 'bookingMonth' | 'amount' | 'transferGroupId'
>
type TxText = Pick<TxPayload, 'label' | 'counterparty' | 'notes'>

type RuleMatcher = { field: 'label'; op: 'contains' | 'equals' | 'startsWith'; value: string }
interface RulePayload {
  matcher: RuleMatcher
  categoryId: string
  priority: number
}

// Contenu chiffre d'une bank_connection (contrat de finalizeAuth / sync).
interface BankConnectionPayload {
  institution: string
  sessionId: string
  accounts: { uid: string; name?: string; iban?: string; product?: string }[]
  validUntil: string | null // ISO 8601
  sessionState: 'active' | 'expired'
}

interface SyncLogPayload {
  connectionId: string | null
  status: 'ok' | 'error'
  importedCount: number
  error?: string
}

type WithId<T> = T & { id: string }

// ---------------------------------------------------------------------------
// Environnement et clients
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Base de l'API Enable Banking (production). Aucune URL de banque en dur : les
// ASPSP sont resolus par nom via EB.
const EB_BASE_URL = 'https://api.enablebanking.com'

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

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// CORS (identique a /api : origines configurees hors depot + localhost dev)
// ---------------------------------------------------------------------------

const CONFIGURED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const ALLOWED_ORIGINS = new Set([
  ...CONFIGURED_ORIGINS,
  'http://localhost:5173',
  'http://localhost:4173',
])
const FALLBACK_ORIGIN = CONFIGURED_ORIGINS[0] ?? 'null'

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

// ---------------------------------------------------------------------------
// Acces aux donnees chiffrees (helpers mirroir de /api)
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

// PostgREST plafonne toute reponse a db-max-rows (1000 par defaut sur Supabase) :
// `.limit(N)` NE l'outrepasse pas. Il faut paginer avec `.range()` jusqu'a
// epuisement, sinon la dedup (tx_hash) et les lectures de comptes/regles sont
// tronquees a 1000 lignes -> doublons a la synchro des qu'on depasse 1000 tx.
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
  // enc_payload transporte en base64 (RPC enc_insert -> decode(...,'base64')).
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

// Transaction dechiffree accompagnee de son tx_hash en clair : permet de
// distinguer les saisies manuelles (tx_hash null) des imports bancaires.
interface DecryptedTx {
  id: string
  txHash: string | null
  payload: TxPayload
}

// ---------------------------------------------------------------------------
// Transactions : colonnes chiffrees enc_core / enc_text (REF H) sur transport
// base64 (REF D) + fallback legacy enc_payload
// ---------------------------------------------------------------------------

const txCoreCtx = (userId: string): string[] => ['transactions', 'core', userId]
const txTextCtx = (userId: string): string[] => ['transactions', 'text', userId]

// Ligne transaction lue en base : colonnes chiffrees exposees en base64 (REF D).
interface TxRow {
  id: string
  enc_core?: string | null
  enc_text?: string | null
  enc_payload?: string | null
  tx_hash?: string | null
}

// Reconstitue le payload complet : enc_core + enc_text (migre) ou enc_payload
// (legacy). Chaque colonne arrive en base64 (REF D). Compatible pendant et apres
// le backfill migrateSplitPayload.
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

// Colonnes chiffrees a ecrire (base64, REF D). enc_payload remis a NULL :
// migration au passage.
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

// Update d'une transaction (colonnes scindees, migre la ligne) via enc_update.
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

async function decryptTxRows(userId: string, rows: TxRow[]): Promise<DecryptedTx[]> {
  const keys = await getKeys()
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      txHash: row.tx_hash ?? null,
      payload: await decodeTx(keys, userId, row),
    })),
  )
}

// Mise a jour du payload chiffre d'une ligne existante (calque de /api). Conserve
// la ligne (donc son created_at) : utilise pour le re-consentement et l'expiration.
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

// Insertion d'une transaction importee. La dedup principale est faite en amont
// via seenHashes ; l'index unique PARTIEL (user_id, tx_hash) where tx_hash not
// null ne peut PAS servir d'arbitre a un upsert PostgREST (le WHERE est omis),
// donc on fait un INSERT simple et on ignore une eventuelle violation d'unicite
// (course concurrente cron/manuel) : code Postgres 23505.
async function insertImportedTransaction(
  userId: string,
  payload: TxPayload,
  monthIdx: string,
  txHash: string,
): Promise<void> {
  const keys = await getKeys()
  const cols = await encodeTxColumns(keys, userId, payload)
  const { error } = await admin.rpc('enc_insert', {
    p_table: 'transactions',
    p_rows: [
      {
        user_id: userId,
        ...cols,
        month_idx: monthIdx,
        tx_hash: txHash,
      },
    ],
  })
  // Violation d'unicite (course concurrente cron/manuel sur l'index partiel
  // tx_hash) : le SQLSTATE 23505 remonte tel quel depuis la RPC, on l'ignore.
  if (error && error.code !== '23505') {
    throw new ApiError(500, 'ecriture transactions impossible')
  }
}

// Journalisation d'une sync : ne throw jamais (best-effort). Un echec de log ne
// doit pas masquer le resultat de la synchronisation elle-meme.
async function logSyncSafe(userId: string, payload: SyncLogPayload): Promise<void> {
  try {
    await insertEncrypted('sync_logs', userId, payload)
  } catch {
    // run_at par defaut cote colonne ; on ignore un echec d'ecriture de log.
    console.error('sync-bank: ecriture sync_logs impossible')
  }
}

// ---------------------------------------------------------------------------
// JWT RS256 Enable Banking
// ---------------------------------------------------------------------------

// Import de la cle privee PEM PKCS8 en cle RSASSA-PKCS1-v1_5 SHA-256 (signature).
function pemToPkcs8Der(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new ApiError(500, 'cle privee Enable Banking absente ou invalide')
  return base64Decode(body)
}

let ebPrivateKeyPromise: Promise<CryptoKey> | null = null
function getEbPrivateKey(): Promise<CryptoKey> {
  ebPrivateKeyPromise ??= (async () => {
    const pem = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''
    const der = pemToPkcs8Der(pem)
    return crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
  })().catch((err) => {
    ebPrivateKeyPromise = null
    throw err
  })
  return ebPrivateKeyPromise
}

function jsonToBase64Url(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)))
}

// Cache du JWT EB (valable 1h) : evite de re-signer a chaque appel dans une sync.
let ebTokenCache: { token: string; exp: number } | null = null

async function getEbToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  // Marge de securite de 60s avant expiration reelle.
  if (ebTokenCache && ebTokenCache.exp - 60 > now) return ebTokenCache.token

  const appId = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
  if (!appId) throw new ApiError(500, 'ENABLE_BANKING_APP_ID absent')

  // HYP EB : header {typ, alg RS256, kid = App ID} ; payload {iss, aud, iat, exp}.
  const iat = now
  const exp = iat + 3600
  const header = { typ: 'JWT', alg: 'RS256', kid: appId }
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp }
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`

  const key = await getEbPrivateKey()
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      new TextEncoder().encode(signingInput),
    ),
  )
  const token = `${signingInput}.${base64UrlEncode(signature)}`
  ebTokenCache = { token, exp }
  return token
}

// Appel HTTP a l'API EB, authentifie par le JWT en Bearer. Ne loggue jamais le
// corps de reponse (peut contenir des donnees bancaires).
async function ebFetch(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<unknown> {
  const token = await getEbToken()
  const res = await fetch(`${EB_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    // Detail de l'erreur EB remonte pour le diagnostic (c'est un message
    // d'erreur d'API, pas une donnee de compte). A restreindre une fois
    // l'integration Enable Banking validee.
    const detail = await res.text().catch(() => '')
    throw new ApiError(502, `Enable Banking a repondu ${res.status}: ${detail.slice(0, 400)}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Regles de categorisation
// ---------------------------------------------------------------------------

function matchRule(rule: RulePayload, label: string): boolean {
  // Insensible casse/accents des deux cotes via normalizeLabel.
  const needle = normalizeLabel(rule.matcher.value)
  const haystack = normalizeLabel(label)
  if (!needle) return false
  switch (rule.matcher.op) {
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

function categorize(rules: RulePayload[], label: string): string | null {
  // rules deja triees par priority croissant : la premiere qui matche gagne.
  for (const rule of rules) {
    if (matchRule(rule, label)) return rule.categoryId
  }
  return null
}

// ---------------------------------------------------------------------------
// Mapping des transactions Enable Banking -> TxPayload
// ---------------------------------------------------------------------------

// HYP EB : montant sous forme de chaine decimale ("123.45"), non signe ; le
// signe vient de credit_debit_indicator (CRDT = entrant, DBIT = sortant).
// Parsing sans flottant pour eviter les erreurs d'arrondi.
function amountStringToCents(raw: string): number {
  const clean = String(raw).trim()
  // Format documente EB : entier, eventuellement suivi d'une fraction decimale.
  // Toute autre forme est ecartee (NaN) plutot que devinee.
  if (!/^\d+(\.\d+)?$/.test(clean)) return NaN
  const [intPart, fracRaw = ''] = clean.split('.')
  // Partie entiere et 2 premieres decimales : parsees sans flottant.
  const frac2 = (fracRaw + '00').slice(0, 2)
  let cents = Number(intPart) * 100 + Number(frac2)
  // Arrondi (et non troncature) des decimales au-dela de la 2e.
  const rest = fracRaw.slice(2)
  if (rest && Math.round(Number(`0.${rest}`)) >= 1) cents += 1
  return cents
}

// Format strict (identique a /api) : mois 01-12, jour 01-31.
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

// Forme partielle d'une transaction EB (champs reellement utilises).
interface EbTransaction {
  transaction_amount?: { amount?: string; currency?: string }
  credit_debit_indicator?: string // 'CRDT' | 'DBIT'
  status?: string // 'BOOK' | 'PDNG'
  booking_date?: string
  value_date?: string
  transaction_date?: string
  remittance_information?: string[] | string
  creditor?: { name?: string }
  debtor?: { name?: string }
}

interface MappedTx {
  bookingDate: string
  bookingMonth: string
  amount: number
  label: string
  counterparty: string | null
}

// Renvoie null si la transaction n'est pas exploitable (date manquante).
function mapEbTransaction(tx: EbTransaction): MappedTx | null {
  // On n'importe que les operations comptabilisees (BOOK). Un provisoire (PDNG)
  // serait reimporte au reglement : on l'ignore pour eviter un doublon.
  if ((tx.status ?? 'BOOK').toUpperCase() !== 'BOOK') return null

  // HYP EB : booking_date au format YYYY-MM-DD. Repli sur value_date puis
  // transaction_date si absent (transactions en attente).
  const rawDate = tx.booking_date ?? tx.value_date ?? tx.transaction_date ?? ''
  const bookingDate = rawDate.slice(0, 10)
  if (!DATE_RE.test(bookingDate)) return null

  const indicator = (tx.credit_debit_indicator ?? '').toUpperCase()
  // Montant non conforme au format documente : transaction ecartee.
  const cents = amountStringToCents(tx.transaction_amount?.amount ?? '0')
  if (Number.isNaN(cents)) return null
  const magnitude = Math.abs(cents)
  // DBIT = debit (depense) -> negatif ; tout le reste (CRDT) -> positif.
  const amount = indicator === 'DBIT' ? -magnitude : magnitude

  // HYP EB : remittance_information est une liste de lignes (parfois une chaine).
  const remittance = Array.isArray(tx.remittance_information)
    ? tx.remittance_information.join(' ')
    : (tx.remittance_information ?? '')
  // La contrepartie depend du sens : sur un debit, on paie un crediteur ; sur
  // un credit, on est paye par un debiteur.
  const counterpartyName =
    (indicator === 'DBIT' ? tx.creditor?.name : tx.debtor?.name)?.trim() || null

  const label = (remittance.trim() || counterpartyName || 'Transaction').slice(0, 200)

  return {
    bookingDate,
    bookingMonth: bookingDate.slice(0, 7),
    amount,
    label,
    counterparty: counterpartyName,
  }
}

// ---------------------------------------------------------------------------
// Soldes Enable Banking (reconciliation)
// ---------------------------------------------------------------------------

// HYP EB : GET /accounts/{uid}/balances -> { balances: [...] }. Chaque balance
// porte un type (name ou balance_type selon les ASPSP) et balance_amount
// { currency, amount: chaine decimale en euros }.
interface EbBalance {
  name?: string
  balance_type?: string
  balance_amount?: { currency?: string; amount?: string }
}

function ebBalanceType(b: EbBalance): string {
  return String(b.balance_type ?? b.name ?? '').toUpperCase()
}

// Prefere le solde comptable arrete (CLBD, closing booked), sinon le solde
// previsionnel (XPCD, expected), sinon la premiere balance disponible.
function pickBalance(balances: EbBalance[]): EbBalance | null {
  return (
    balances.find((b) => ebBalanceType(b) === 'CLBD') ??
    balances.find((b) => ebBalanceType(b) === 'XPCD') ??
    balances[0] ??
    null
  )
}

// Solde EB en centimes, ou null si inexploitable. Contrairement aux montants de
// transactions, un solde peut etre negatif : parseFloat puis arrondi.
function ebBalanceToCents(balance: EbBalance): number | null {
  const raw = balance.balance_amount?.amount
  if (typeof raw !== 'string' || !raw.trim()) return null
  const cents = Math.round(parseFloat(raw) * 100)
  return Number.isFinite(cents) ? cents : null
}

// ---------------------------------------------------------------------------
// Dates : marqueur incremental de sync
// ---------------------------------------------------------------------------

function shiftDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function maxDate(a: string, b: string): string {
  return a >= b ? a : b
}

// Ecart absolu en jours entre deux dates YYYY-MM-DD (interpretees en UTC).
function dayDiff(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`))
  return Math.round(ms / 86_400_000)
}

// Nombre de jours de recouvrement volontaire entre deux syncs : on re-demande un
// peu de passe. La dedup (tx_hash) absorbe les doublons, donc etre large ne coute
// que de la bande passante, jamais la justesse.
const OVERLAP_DAYS = 7
// Cartes a debit differe : la banque publie souvent les operations carte des
// JOURS apres leur date de comptabilisation (parfois par paquet au moment du
// prelevement). Une fenetre de 7 jours les raterait definitivement (EB filtre
// par date) : les connexions ayant un compte carte lie remontent plus loin.
const CARD_OVERLAP_DAYS = 35

// Charge et dechiffre les derniers sync_logs du user (run_at en clair, status
// chiffre). Retourne les entrees decodees, ordonnees du plus recent au plus
// ancien. Une entree indechiffrable est ignoree (ne doit pas bloquer la sync).
async function loadRecentSyncLogs(
  userId: string,
): Promise<{ runAt: string; payload: SyncLogPayload }[]> {
  const keys = await getKeys()
  const { data, error } = await admin
    .from('sync_logs')
    .select('id, enc_payload:enc_b64, run_at')
    .eq('user_id', userId)
    .order('run_at', { ascending: false })
    // 50 suffit largement : on ne cherche que la derniere sync `ok` par
    // connexion et le tri run_at desc garantit que la premiere correspondance
    // gagne. Une purge pg_cron borne par ailleurs la croissance de la table
    // (voir supabase/migrations-manual/F-purge-sync-logs.sql).
    .limit(50)
  if (error) throw new ApiError(500, 'lecture sync_logs impossible')
  const out: { runAt: string; payload: SyncLogPayload }[] = []
  for (const row of data ?? []) {
    try {
      const payload = await decryptJson<SyncLogPayload>(
        keys,
        base64ToBytes(row.enc_payload),
        ['sync_logs', userId],
      )
      out.push({ runAt: String(row.run_at), payload })
    } catch {
      // Entree corrompue : ignoree, ne doit pas faire avancer le marqueur.
    }
  }
  return out
}

// run_at (date YYYY-MM-DD) de la derniere sync REUSSIE de cette connexion, ou
// null si aucune. Les logs sont supposes tries du plus recent au plus ancien :
// la premiere correspondance gagne. Un run en echec ne fait donc jamais avancer
// le marqueur, et une autre connexion saine n'influe pas sur celle-ci.
function lastSuccessfulRunDate(
  logs: { runAt: string; payload: SyncLogPayload }[],
  connectionId: string,
): string | null {
  for (const log of logs) {
    if (log.payload.status === 'ok' && log.payload.connectionId === connectionId) {
      return log.runAt.slice(0, 10)
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Cartes a debit differe : liaison automatique du prelevement mensuel
// ---------------------------------------------------------------------------

// Libelles typiques du prelevement de reglement d'une carte a debit differe
// (ex. "CARTE DEPENSES", "DEPENSES CARTE", "CARTE X1234 AU 05/07"). Applique au
// libelle passe par normalizeLabel (accents retires, espaces normalises).
const CARD_SETTLEMENT_RE = /CARTE\s+DEPENSES|DEPENSES\s+CARTE|CARTE\s+X?\d{4}\s+AU\s+\d{2}\/\d{2}/i

// Detecte les prelevements de reglement de carte a debit differe importes et
// les transforme en transferts (sans categorie, hors activity/RTA) :
//   1. debit sans categorie ni transfert dont le libelle matche ci-dessus ;
//   2. credit exactement oppose sur un AUTRE compte, sans categorie ni
//      transfert, a +/- 5 jours -> liaison si le match est UNIQUE et non
//      ambigu dans les deux sens ;
//   3. sinon, s'il existe EXACTEMENT UN compte 'card_deferred', creation de la
//      transaction miroir crediteuse sur ce compte puis liaison.
// Conservateur par construction : au moindre doute (plusieurs matches
// possibles), on ne touche a rien. Renvoie le nombre de paires liees.

// Mois suivant (YYYY-MM) : enumere la fenetre d'analyse ci-dessous.
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function linkDeferredCardSettlements(userId: string, sinceDays?: number): Promise<number> {
  const keys = await getKeys()

  // Fenetre d'analyse : par defaut les 2 derniers mois (~45 jours). Si la sync
  // vient d'importer un historique plus profond (sinceDays), on couvre TOUS les
  // mois de la fenetre importee : le meme historique doit produire la meme
  // semantique (reglements carte -> transferts) quelle que soit sa date.
  const now = new Date()
  const currentMonth = now.toISOString().slice(0, 7)
  const today = now.toISOString().slice(0, 10)
  const startMonth =
    sinceDays != null
      ? shiftDays(today, -sinceDays).slice(0, 7)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
          .toISOString()
          .slice(0, 7)
  const months: string[] = []
  // Borne de securite : sinceDays est plafonne a 730 jours en amont (~25 mois).
  for (let m = startMonth; m <= currentMonth && months.length < 40; m = nextMonth(m)) {
    months.push(m)
  }
  const monthIdxs = await Promise.all(months.map((m) => txMonthIdx(keys, userId, m)))
  // Pagine (plafond PostgREST) : sur une fenetre profonde (import historique)
  // la fenetre peut depasser 1000 transactions.
  const data: TxRow[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data: page, error } = await admin
      .from('transactions')
      .select('id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64, tx_hash')
      .eq('user_id', userId)
      .in('month_idx', monthIdxs)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new ApiError(500, 'lecture transactions impossible')
    if (!page || page.length === 0) break
    data.push(...(page as TxRow[]))
    if (page.length < READ_PAGE) break
  }
  const txs = await decryptTxRows(userId, data)

  // Compte miroir de repli : uniquement s'il en existe EXACTEMENT UN.
  const accounts = await loadAll<AccountPayload>('accounts', userId)
  const cardAccounts = accounts.filter((a) => a.kind === 'card_deferred' && !a.closed)
  const cardAccount = cardAccounts.length === 1 ? cardAccounts[0] : null

  // Candidats : debits sans categorie ni transfert au libelle de reglement carte.
  const candidates = txs.filter(
    (t) =>
      t.payload.amount < 0 &&
      !t.payload.categoryId &&
      !t.payload.transferGroupId &&
      CARD_SETTLEMENT_RE.test(normalizeLabel(t.payload.label)),
  )

  // Credit lie a un candidat : montant exactement oppose, autre compte, sans
  // categorie ni transfert, a +/- 5 jours.
  const isCounterpart = (credit: DecryptedTx, debit: DecryptedTx): boolean =>
    credit.id !== debit.id &&
    credit.payload.accountId !== debit.payload.accountId &&
    credit.payload.amount === -debit.payload.amount &&
    !credit.payload.categoryId &&
    !credit.payload.transferGroupId &&
    dayDiff(credit.payload.bookingDate, debit.payload.bookingDate) <= 5

  const used = new Set<string>()
  let linkedPairs = 0

  for (const candidate of candidates) {
    if (used.has(candidate.id)) continue

    const matches = txs.filter((t) => !used.has(t.id) && isCounterpart(t, candidate))

    if (matches.length === 1) {
      const credit = matches[0]
      // Ambiguite inverse : si ce credit pourrait aussi solder un AUTRE
      // candidat encore libre, on s'abstient (aucun faux positif tolere).
      const rivals = candidates.filter(
        (c) => c.id !== candidate.id && !used.has(c.id) && isCounterpart(credit, c),
      )
      if (rivals.length > 0) continue

      const transferGroupId = crypto.randomUUID()
      await updateTx(userId, candidate.id, {
        ...candidate.payload,
        categoryId: null,
        transferGroupId,
      })
      await updateTx(userId, credit.id, {
        ...credit.payload,
        categoryId: null,
        transferGroupId,
      })
      used.add(candidate.id)
      used.add(credit.id)
      linkedPairs += 1
    } else if (
      matches.length === 0 &&
      cardAccount &&
      // Un compte carte lui-meme synchronise via Enable Banking recevra le
      // credit de reglement REEL a un import ulterieur (tx_hash propre, non
      // dedupliquable contre un miroir tx_hash null) : creer le miroir
      // produirait un doublon. Le repli est reserve aux comptes carte manuels.
      !cardAccount.providerAccountUid &&
      cardAccount.id !== candidate.payload.accountId
    ) {
      // Aucun credit correspondant : le releve de la carte n'est pas (encore)
      // importe. On cree la transaction miroir sur l'unique compte carte
      // (saisie systeme : tx_hash null, pas de dedup bancaire).
      const transferGroupId = crypto.randomUUID()
      const mirror: TxPayload = {
        accountId: cardAccount.id,
        categoryId: null,
        bookingDate: candidate.payload.bookingDate,
        bookingMonth: candidate.payload.bookingMonth,
        amount: -candidate.payload.amount,
        label: candidate.payload.label,
        counterparty: null,
        transferGroupId,
        notes: null,
      }
      await insertTx(userId, mirror, {
        month_idx: await txMonthIdx(keys, userId, mirror.bookingMonth),
      })
      await updateTx(userId, candidate.id, {
        ...candidate.payload,
        categoryId: null,
        transferGroupId,
      })
      used.add(candidate.id)
      linkedPairs += 1
    }
    // matches.length > 1 : ambigu, on ne fait rien (conservateur).
  }

  return linkedPairs
}

// ---------------------------------------------------------------------------
// Fenetre de dedup
// ---------------------------------------------------------------------------

// Repli sur le chargement complet si la fenetre est anormalement large (ex.
// connexion activee il y a des annees mais jamais synchronisee avec succes :
// dateFrom = activation). Au-dela de ce plafond, on prefere payer un scan
// complet plutot que de risquer de laisser passer un doublon. Valeur large :
// le mode incremental normal ne couvre que quelques jours, et sinceDays est
// deja plafonne a ~730 jours (~25 mois) en amont.
const DEDUP_WINDOW_MAX_MONTHS = 120

// Charge les tx_hash existants pertinents pour la dedup de ce run, restreints
// aux mois de la fenetre [plus ancienne dateFrom .. mois courant] via l'index
// aveugle month_idx. Garantie anti-doublon : un tx_hash ne collisionne qu'avec
// une transaction de MEME booking_date (le hash en depend), donc de meme mois,
// et ce mois est necessairement >= le mois de la dateFrom de sa connexion
// (EB ne renvoie rien avant date_from) et <= le mois courant. La fenetre couvre
// donc l'integralite des collisions possibles. En repli (fenetre trop large ou
// absente), on recharge tous les tx_hash du user : justesse preservee.
// Index aveugles des mois de la fenetre de dedup, ou null si la fenetre est
// absente/trop large (repli = scan complet, justesse preservee).
// padMonthsBefore : mois supplementaires AVANT la fenetre (jumeaux carte dont
// la date YNAB peut preceder de ± CARD_TWIN_DAY_TOLERANCE jours la premiere
// date importee).
async function dedupWindowMonthIdxs(
  userId: string,
  dateFromByConn: Map<string, string>,
  padMonthsBefore = 0,
): Promise<string[] | null> {
  const keys = await getKeys()
  let earliest: string | null = null
  for (const d of dateFromByConn.values()) {
    if (earliest === null || d < earliest) earliest = d
  }
  if (earliest === null) return null

  let startMonth = earliest.slice(0, 7)
  for (let i = 0; i < padMonthsBefore; i++) startMonth = prevMonth(startMonth)

  const currentMonth = new Date().toISOString().slice(0, 7)
  const months: string[] = []
  for (let m = startMonth; m <= currentMonth; m = nextMonth(m)) {
    if (months.length >= DEDUP_WINDOW_MAX_MONTHS + padMonthsBefore) return null
    months.push(m)
  }
  return Promise.all(months.map((m) => txMonthIdx(keys, userId, m)))
}

async function loadSeenHashesWindow(
  userId: string,
  monthIdxs: string[] | null,
): Promise<Set<string>> {
  const seenHashes = new Set<string>()

  for (let from = 0; ; from += READ_PAGE) {
    let query = admin
      .from('transactions')
      .select('tx_hash')
      .eq('user_id', userId)
      .not('tx_hash', 'is', null)
    if (monthIdxs) query = query.in('month_idx', monthIdxs)
    const { data, error } = await query
      .order('tx_hash', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new ApiError(500, 'lecture tx_hash impossible')
    if (!data || data.length === 0) break
    for (const r of data) seenHashes.add(r.tx_hash as string)
    if (data.length < READ_PAGE) break
  }

  return seenHashes
}

// ---------------------------------------------------------------------------
// Garde anti-doublon "jumeaux" : transactions SANS tx_hash (import YNAB,
// saisies manuelles) deja presentes en base. La dedup par tx_hash ne peut pas
// les reconnaitre (leurs libelles/dates viennent d'une autre source que EB) :
// avant d'inserer un import bancaire, on verifie qu'aucune ligne sans hash du
// MEME compte, MEME montant et date proche (± TWIN_DAY_TOLERANCE jours l'une
// de l'autre) n'existe deja — sinon l'import est saute (la copie existante,
// souvent categorisee, fait foi). Chaque jumeau n'absorbe qu'UN import (deux
// depenses identiques legitimes restent possibles).
// ---------------------------------------------------------------------------

const TWIN_DAY_TOLERANCE = 2
// Cartes a debit differe : la banque publie les operations avec des dates
// d'arrete pouvant differer de SEMAINES des dates YNAB/manuelles (releve
// mensuel). Tolerance large — le risque de faux positif (deux achats
// identiques dans la fenetre) est limite car chaque jumeau n'absorbe qu'UN
// import.
const CARD_TWIN_DAY_TOLERANCE = 45

type TwinIndex = Map<string, string[]> // `${accountId}|${amount}` -> bookingDates

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

// Charge les transactions sans tx_hash de la fenetre (enc_core seul) et les
// indexe par (compte, montant). Meme filtre month_idx que la dedup par hash.
async function loadManualTwinsWindow(
  userId: string,
  monthIdxs: string[] | null,
): Promise<TwinIndex> {
  const keys = await getKeys()
  const twins: TwinIndex = new Map()

  for (let from = 0; ; from += READ_PAGE) {
    let query = admin
      .from('transactions')
      .select('id, enc_core:enc_core_b64, enc_payload:enc_b64')
      .eq('user_id', userId)
      .is('tx_hash', null)
    if (monthIdxs) query = query.in('month_idx', monthIdxs)
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new ApiError(500, 'lecture transactions impossible')
    if (!data || data.length === 0) break
    for (const row of data) {
      const r = row as TxRow
      const core = r.enc_core
        ? await decryptJson<TxCore>(keys, base64ToBytes(r.enc_core), txCoreCtx(userId))
        : r.enc_payload
          ? await decryptJson<TxCore>(keys, base64ToBytes(r.enc_payload), ['transactions', userId])
          : null
      if (!core) continue
      const key = `${core.accountId}|${core.amount}`
      const dates = twins.get(key)
      if (dates) dates.push(core.bookingDate)
      else twins.set(key, [core.bookingDate])
    }
    if (data.length < READ_PAGE) break
  }

  return twins
}

// Consomme le jumeau le plus proche en date (± toleranceDays) s'il existe.
function consumeTwin(
  twins: TwinIndex,
  accountId: string,
  amount: number,
  date: string,
  toleranceDays: number,
): boolean {
  const dates = twins.get(`${accountId}|${amount}`)
  if (!dates || dates.length === 0) return false
  const target = dayNumber(date)
  let bestIdx = -1
  let bestDiff = toleranceDays + 1
  for (let i = 0; i < dates.length; i++) {
    const diff = Math.abs(dayNumber(dates[i]) - target)
    if (diff < bestDiff) {
      bestDiff = diff
      bestIdx = i
    }
  }
  if (bestIdx === -1 || bestDiff > toleranceDays) return false
  dates.splice(bestIdx, 1)
  return true
}

// ---------------------------------------------------------------------------
// Synchronisation d'un utilisateur
// ---------------------------------------------------------------------------

async function syncUser(
  userId: string,
  sinceDays?: number,
  connectionId?: string,
): Promise<{ imported: number; linked: number; transfersLinked: number; errors: string[] }> {
  const keys = await getKeys()

  // Connexions bancaires actives de l'utilisateur.
  const { data: connRows, error: connErr } = await admin
    .from('bank_connections')
    .select('id, enc_payload:enc_b64, created_at')
    .eq('user_id', userId)
    .limit(100)
  if (connErr) throw new ApiError(500, 'lecture bank_connections impossible')

  const connections = await Promise.all(
    (connRows ?? []).map(async (row) => ({
      id: row.id,
      createdAt: row.created_at as string,
      payload: await decryptJson<BankConnectionPayload>(
        keys,
        base64ToBytes(row.enc_payload),
        ['bank_connections', userId],
      ),
    })),
  )
  // Re-consentement : une session encore 'active' mais dont la date d'expiration
  // est passee est marquee 'expired' (write-back chiffre) et exclue du poll. Le
  // front s'appuie sur ce statut pour afficher la banniere de reconnexion.
  const now = Date.now()
  const activeConnections: typeof connections = []
  for (const conn of connections) {
    if (conn.payload.sessionState !== 'active') continue
    const validUntil = conn.payload.validUntil
    if (validUntil && Date.parse(validUntil) < now) {
      await updateEncrypted('bank_connections', userId, conn.id, {
        ...conn.payload,
        sessionState: 'expired',
      })
      continue
    }
    activeConnections.push(conn)
  }
  // Import cible sur UNE connexion (ex. importer l'historique d'une seule banque
  // sans re-toucher aux autres — evite de re-dupliquer un compte deja importe
  // depuis un autre canal, ex. un import YNAB sans tx_hash).
  const connectionsToSync = connectionId
    ? activeConnections.filter((c) => c.id === connectionId)
    : activeConnections
  if (connectionsToSync.length === 0) {
    return { imported: 0, linked: 0, transfersLinked: 0, errors: [] }
  }

  // Comptes (pour lier uid EB -> id compte interne) et regles de categorisation.
  const [accounts, rules] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<RulePayload>('rules', userId),
  ])
  rules.sort((a, b) => a.priority - b.priority)

  const accountByUid = new Map<string, WithId<AccountPayload>>()
  for (const acc of accounts) {
    if (acc.providerAccountUid) accountByUid.set(acc.providerAccountUid, acc)
  }

  // Marqueur incremental : on charge et dechiffre les derniers sync_logs pour
  // retrouver, par connexion, la derniere sync REUSSIE (status 'ok' relu apres
  // dechiffrement). Un run en echec n'avance donc jamais la borne d'une
  // connexion, et une connexion saine n'influe pas sur une connexion en panne.
  const recentLogs = await loadRecentSyncLogs(userId)

  // Date de depart de chaque connexion, precalculee AVANT le poll : elle sert a
  // la fois de borne date_from EB et de borne basse a la fenetre de dedup.
  //   - derniere sync REUSSIE de CETTE connexion (moins le recouvrement), sinon
  //     date d'activation (created_at, en clair). On ne remonte jamais avant
  //     l'activation : seules les transactions posterieures sont importees (le
  //     solde d'ouverture est saisi manuellement).
  //   - sinceDays (mode user, diagnostic / import initial) : force la fenetre a
  //     aujourd'hui - N jours, en ignorant la borne d'activation.
  const today = new Date().toISOString().slice(0, 10)
  const dateFromByConn = new Map<string, string>()
  for (const conn of connectionsToSync) {
    const activationDate = conn.createdAt.slice(0, 10)
    const lastOkDate = lastSuccessfulRunDate(recentLogs, conn.id)
    // Connexion avec carte a debit differe liee : fenetre elargie (les
    // operations carte sont publiees en retard par la banque, une fenetre de
    // 7 jours les raterait definitivement — EB filtre par date).
    const hasDeferredCard = conn.payload.accounts.some(
      (a) => accountByUid.get(a.uid)?.kind === 'card_deferred',
    )
    const overlapDays = hasDeferredCard ? CARD_OVERLAP_DAYS : OVERLAP_DAYS
    const dateFrom =
      sinceDays != null
        ? shiftDays(today, -sinceDays)
        : lastOkDate
          ? maxDate(shiftDays(lastOkDate, -overlapDays), activationDate)
          : activationDate
    dateFromByConn.set(conn.id, dateFrom)
  }

  // Ensemble des tx_hash existants susceptibles de collisionner avec ce run,
  // limite aux mois couverts par la fenetre de dedup [plus ancienne dateFrom ..
  // mois courant]. Un doublon partage FORCEMENT la meme booking_date que la
  // transaction importee (tx_hash en depend), donc le meme mois : filtrer par
  // month_idx sur cette fenetre contient a coup sur tout doublon potentiel.
  const dedupMonthIdxs = await dedupWindowMonthIdxs(userId, dateFromByConn)
  const seenHashes = await loadSeenHashesWindow(userId, dedupMonthIdxs)
  // Jumeaux sans tx_hash (import YNAB, saisies manuelles) : empeche la
  // re-insertion par la banque d'operations deja presentes via une autre
  // source (cause des doublons de la sync profonde).
  // Fenetre elargie de 2 mois en amont : un jumeau carte peut etre date
  // jusqu'a CARD_TWIN_DAY_TOLERANCE jours avant la premiere date importee.
  const twinMonthIdxs = await dedupWindowMonthIdxs(userId, dateFromByConn, 2)
  const manualTwins = await loadManualTwinsWindow(userId, twinMonthIdxs)

  let importedTotal = 0
  let linkedCount = 0
  const errors: string[] = []
  // Garde REF I : invalide les agregats avant la premiere ecriture reelle et
  // compte les ecritures (independamment du succes global des connexions).
  const aggWrites: AggWriteGuard = { count: 0, staled: false }

  for (const conn of connectionsToSync) {
    let importedForConn = 0
    try {
      const dateFrom = dateFromByConn.get(conn.id)!

      for (const ebAccount of conn.payload.accounts) {
        const localAccount = accountByUid.get(ebAccount.uid)
        // Un compte EB non encore lie a un compte interne est ignore : la
        // liaison (providerAccountUid) se fait cote /api.
        if (!localAccount) continue
        linkedCount += 1

        // Pagination EB via continuation_key. Bornee pour eviter toute boucle
        // infinie : nombre de pages plafonne et arret si la cle se repete.
        let continuationKey: string | null = null
        let pageCount = 0
        do {
          const query = new URLSearchParams({ date_from: dateFrom })
          if (continuationKey) query.set('continuation_key', continuationKey)
          // HYP EB : GET /accounts/{uid}/transactions?date_from=YYYY-MM-DD,
          // reponse { transactions: [...], continuation_key?: string }.
          const page = (await ebFetch(
            `/accounts/${encodeURIComponent(ebAccount.uid)}/transactions?${query.toString()}`,
          )) as { transactions?: EbTransaction[]; continuation_key?: string | null }

          for (const ebTx of page.transactions ?? []) {
            const mapped = mapEbTransaction(ebTx)
            if (!mapped) continue

            const hash = await txHashIdx(
              keys,
              userId,
              localAccount.id,
              mapped.bookingDate,
              mapped.amount,
              mapped.label,
            )
            // Dedup : deja en base OU deja inseree dans ce run (seenHashes est
            // mis a jour au fur et a mesure).
            if (seenHashes.has(hash)) continue
            // Jumeau sans hash (YNAB / manuel) au meme compte, meme montant,
            // date proche : la copie existante fait foi, on n'insere pas.
            const twinTolerance =
              localAccount.kind === 'card_deferred' ? CARD_TWIN_DAY_TOLERANCE : TWIN_DAY_TOLERANCE
            if (
              consumeTwin(manualTwins, localAccount.id, mapped.amount, mapped.bookingDate, twinTolerance)
            ) {
              seenHashes.add(hash)
              continue
            }
            seenHashes.add(hash)

            const categoryId = categorize(rules, mapped.label)
            const payload: TxPayload = {
              accountId: localAccount.id,
              categoryId,
              bookingDate: mapped.bookingDate,
              bookingMonth: mapped.bookingMonth,
              amount: mapped.amount,
              label: mapped.label,
              counterparty: mapped.counterparty,
              transferGroupId: null,
              notes: null,
            }
            // Invalidation des agregats AVANT le premier insert (voir
            // aggStaleBeforeWrite) : un crash/echec partiel apres ce point
            // laisse un etat non-pret, jamais un 'ready' faux.
            await aggStaleBeforeWrite(userId, aggWrites)
            await insertImportedTransaction(
              userId,
              payload,
              await txMonthIdx(keys, userId, mapped.bookingMonth),
              hash,
            )
            importedForConn += 1
          }

          const nextKey = page.continuation_key ?? null
          pageCount += 1
          // Cle identique a celle envoyee : l'API tourne en rond, on arrete.
          if (nextKey !== null && nextKey === continuationKey) break
          continuationKey = nextKey
        } while (continuationKey && pageCount < 1000)
      }

      importedTotal += importedForConn
      await logSyncSafe(userId, {
        connectionId: conn.id,
        status: 'ok',
        importedCount: importedForConn,
      })
    } catch (err) {
      // Echec d'une connexion : on journalise et on passe a la suivante, sans
      // interrompre les autres connexions/utilisateurs. Message statique.
      const message = err instanceof ApiError ? err.message : 'synchronisation echouee'
      errors.push(message)
      await logSyncSafe(userId, {
        connectionId: conn.id,
        status: 'error',
        importedCount: importedForConn,
        error: message,
      })
    }
  }

  // Liaison des prelevements de carte a debit differe : uniquement si du neuf a
  // ete importe. Best-effort : un echec de liaison ne doit pas masquer un
  // import reussi, on le remonte comme simple erreur.
  let transfersLinked = 0
  if (importedTotal > 0) {
    try {
      transfersLinked = await linkDeferredCardSettlements(userId, sinceDays)
    } catch (err) {
      errors.push(err instanceof ApiError ? err.message : 'liaison carte differee echouee')
    }
  }

  // Agregats (REF I) : si des transactions ont ete ecrites (l'invalidation a
  // eu lieu AVANT la premiere ecriture, cf. aggStaleBeforeWrite), on remet les
  // agregats a la verite par un recompute complet, qui re-pose 'ready'. En cas
  // d'echec, le marqueur reste absent/non-pret : les lectures /api retombent
  // sur le calcul complet (toujours juste) et bootstrapFull reconstruira a la
  // prochaine ouverture de l'app. Un echec PARTIEL d'import (erreur EB en
  // cours de pagination apres N inserts) passe aussi par ici : le compteur
  // aggWrites reflete les ecritures REELLES, pas le succes des connexions.
  if (aggWrites.count > 0) {
    await refreshAggregatesSafe(userId)
  }

  return { imported: importedTotal, linked: linkedCount, transfersLinked, errors }
}

// Compteur d'ecritures reelles + invalidation AVANT la premiere ecriture.
// INVARIANT REF I : jamais d'ecriture de transaction sous un marqueur 'ready'
// hors du chemin de maintenance de /api. On supprime donc le marqueur avant le
// premier insert : pendant l'import les lectures retombent sur le calcul
// complet (correct), et un crash au milieu laisse un etat non-pret que
// bootstrapFull reconstruit — jamais un 'ready' faux. Si l'invalidation
// echoue durablement (aggMarkStale retente, ignore seulement le cas table
// absente), on LEVE : la sync echoue proprement et sera rejouee.
interface AggWriteGuard {
  count: number
  staled: boolean
}

async function aggStaleBeforeWrite(userId: string, guard: AggWriteGuard): Promise<void> {
  if (!guard.staled) {
    await aggMarkStale(admin, userId)
    guard.staled = true
  }
  guard.count += 1
}

// Recompute complet des agregats depuis les tables sources (transactions lues
// en enc_core seulement : l'agregation n'a pas besoin des libelles). La fence
// est posee par aggRecompute AVANT le chargement. En cas d'echec, invalidation
// best-effort — jamais d'agregat partiel marque pret.
async function refreshAggregatesSafe(userId: string): Promise<void> {
  try {
    const keys = await getKeys()
    await aggRecompute(admin, keys, userId, async () => {
      const [accounts, txRows, assignments] = await Promise.all([
        loadAll<AccountPayload>('accounts', userId),
        loadAllRows<TxRow>('transactions', userId, 'id, enc_core:enc_core_b64, enc_payload:enc_b64'),
        loadAll<{ categoryId: string; month: string; amount: number }>('assignments', userId),
      ])
      const transactions = await Promise.all(
        txRows.map(async (row) => {
          if (row.enc_core) {
            return decryptJson<TxCore>(keys, base64ToBytes(row.enc_core), txCoreCtx(userId))
          }
          if (!row.enc_payload) throw new ApiError(500, 'transaction sans payload dechiffrable')
          return decryptJson<TxCore>(keys, base64ToBytes(row.enc_payload), ['transactions', userId])
        }),
      )
      return {
        accounts: accounts.map((a) => ({ id: a.id, onBudget: a.onBudget })),
        transactions: transactions.map((t) => ({
          accountId: t.accountId,
          categoryId: t.categoryId,
          bookingMonth: t.bookingMonth,
          amount: t.amount,
          transferGroupId: t.transferGroupId ?? null,
        })),
        assignments: assignments.map((a) => ({
          categoryId: a.categoryId,
          month: a.month,
          amount: a.amount,
        })),
      }
    })
  } catch {
    await aggMarkStale(admin, userId).catch(() => {})
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>

// startAuth : ouvre une session d'autorisation PSD2, renvoie l'URL de la banque.
async function actionStartAuth(userId: string, params: Params) {
  // On privilegie l'URL du secret ENABLE_BANKING_REDIRECT_URL : elle DOIT etre
  // identique a la Redirect URL enregistree dans l'app Enable Banking, sinon EB
  // renvoie REDIRECT_URI_NOT_ALLOWED. Le param du front n'est qu'un repli.
  const redirectUrl =
    (Deno.env.get('ENABLE_BANKING_REDIRECT_URL') ?? '').trim() ||
    (typeof params.redirectUrl === 'string' ? params.redirectUrl.trim() : '')
  if (!redirectUrl) throw new ApiError(400, 'redirectUrl manquante')

  // Le nom d'ASPSP est configurable : param optionnel (aspspName) ou secret
  // ENABLE_BANKING_ASPSP_NAME. Pays fixe a la France (perimetre initial).
  const aspspName =
    typeof params.aspspName === 'string' && params.aspspName.trim()
      ? params.aspspName.trim()
      : Deno.env.get('ENABLE_BANKING_ASPSP_NAME') ?? ''
  if (!aspspName) throw new ApiError(400, 'nom ASPSP manquant (ENABLE_BANKING_ASPSP_NAME)')

  // valid_until en ISO 8601. 90 jours : plafond PSD2 usuel des ASPSP (180 j
  // n'est accepte que par certaines banques et provoque un 400 sinon).
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  // state anti-CSRF/correlation : aleatoire, renvoye par EB au redirect.
  const state = crypto.randomUUID()

  // HYP EB : POST /auth -> { url, authorization_id, ... }. On ne renvoie que url.
  const body = {
    access: { valid_until: validUntil },
    aspsp: { name: aspspName, country: 'FR' },
    state,
    redirect_url: redirectUrl,
    psu_type: 'personal',
  }
  const res = (await ebFetch('/auth', { method: 'POST', body })) as { url?: string }
  if (!res.url) throw new ApiError(502, 'Enable Banking : URL d autorisation absente')
  return { url: res.url }
}

// finalizeAuth : echange le code de retour contre une session EB persistee.
async function actionFinalizeAuth(userId: string, params: Params) {
  const code = typeof params.code === 'string' ? params.code.trim() : ''
  if (!code) throw new ApiError(400, 'code d autorisation manquant')

  // HYP EB : POST /sessions { code } -> { session_id, accounts, access,
  // aspsp }. `accounts` peut etre une liste d'uid (chaines) ou d'objets { uid,
  // name/account_id }. On gere les deux formes.
  const session = (await ebFetch('/sessions', { method: 'POST', body: { code } })) as {
    session_id?: string
    accounts?: Array<
      | string
      | {
          uid?: string
          name?: string
          product?: string
          account_id?: { iban?: string; name?: string; other?: { identification?: string } }
        }
    >
    access?: { valid_until?: string }
    aspsp?: { name?: string }
  }
  if (!session.session_id) throw new ApiError(502, 'Enable Banking : session_id absent')

  const accounts: { uid: string; name?: string; iban?: string; product?: string }[] = []
  for (const entry of session.accounts ?? []) {
    if (typeof entry === 'string') {
      accounts.push({ uid: entry })
    } else if (entry && typeof entry.uid === 'string') {
      const name = entry.name ?? entry.account_id?.name
      const iban = entry.account_id?.iban ?? entry.account_id?.other?.identification
      accounts.push({
        uid: entry.uid,
        ...(name ? { name } : {}),
        ...(iban ? { iban } : {}),
        ...(entry.product ? { product: entry.product } : {}),
      })
    }
  }

  const institution =
    session.aspsp?.name ?? Deno.env.get('ENABLE_BANKING_ASPSP_NAME') ?? 'Banque'
  const payload: BankConnectionPayload = {
    institution,
    sessionId: session.session_id,
    accounts,
    validUntil: session.access?.valid_until ?? null,
    sessionState: 'active',
  }

  // Re-consentement : si une connexion existe deja pour le meme ASPSP (meme
  // institution) ou partageant au moins un uid de compte, on la MET A JOUR en
  // conservant sa ligne (donc son created_at, pour ne pas re-borner dateFrom a
  // aujourd'hui). Sinon on cree une nouvelle connexion.
  const existing = await loadAll<BankConnectionPayload>('bank_connections', userId)
  const newUids = new Set(accounts.map((a) => a.uid))
  const match = existing.find(
    (c) =>
      c.institution === institution ||
      c.accounts.some((a) => newUids.has(a.uid)),
  )
  if (match) {
    await updateEncrypted('bank_connections', userId, match.id, payload)
    return { ok: true, connectionId: match.id }
  }

  const connectionId = await insertEncrypted('bank_connections', userId, payload)
  return { ok: true, connectionId }
}

// listAspsps : liste des banques (ASPSP) disponibles pour la France. Sert au
// selecteur de banque du front (evite de saisir le nom exact a la main).
async function actionListAspsps() {
  // HYP EB : GET /aspsps?country=FR -> { aspsps: [{ name, country, logo, psu_types }] }
  const res = (await ebFetch('/aspsps?country=FR')) as {
    aspsps?: Array<{ name?: string; country?: string; logo?: string; psu_types?: string[] }>
  }
  const seen = new Set<string>()
  const aspsps: { name: string; country: string; logo: string | null }[] = []
  for (const a of res.aspsps ?? []) {
    if (!a.name || seen.has(a.name)) continue
    if (a.psu_types && !a.psu_types.includes('personal')) continue
    seen.add(a.name)
    aspsps.push({ name: a.name, country: a.country ?? 'FR', logo: a.logo ?? null })
  }
  aspsps.sort((x, y) => x.name.localeCompare(y.name))
  return { aspsps }
}

// sync : synchronise les utilisateurs cibles. En mode cron, ne jamais laisser un
// user isole faire echouer les autres.
async function actionSync(
  targetUserIds: string[],
  isCron: boolean,
  sinceDays?: number,
  connectionId?: string,
) {
  let imported = 0
  let linked = 0
  let transfersLinked = 0
  const errors: string[] = []
  for (const userId of targetUserIds) {
    try {
      const r = await syncUser(userId, sinceDays, connectionId)
      imported += r.imported
      linked += r.linked
      transfersLinked += r.transfersLinked
      errors.push(...r.errors)
    } catch (err) {
      // Erreur "dure" (chargement impossible) : journalisee, puis on continue en
      // mode cron. En mode user, on la propage pour un retour d'erreur explicite.
      const message = err instanceof ApiError ? err.message : 'synchronisation echouee'
      errors.push(message)
      await logSyncSafe(userId, {
        connectionId: null,
        status: 'error',
        importedCount: 0,
        error: message,
      })
      if (!isCron) throw err
    }
  }
  // `linked` = nombre de comptes bancaires effectivement associes a un compte
  // local : permet au front de dire "associe d'abord un compte" si 0.
  // `transfersLinked` = paires de reglements de carte differee liees en transfert.
  return { imported, linked, transfersLinked, errors }
}

// Libelle de la transaction de solde d'ouverture semee par /api
// (actionCreateAccount) : contrat partage, ne pas modifier d'un seul cote.
const OPENING_BALANCE_LABEL = "Solde d'ouverture"

// reconcile : pour chaque compte lie a Enable Banking, compare le solde EB
// (CLBD de preference) a la somme des transactions locales dechiffrees, et
// absorbe l'ecart dans la transaction "Solde d'ouverture" (ajustee ou creee).
// Reserve au mode utilisateur (JWT) : action explicite, jamais lancee par cron.
async function actionReconcile(userId: string) {
  const keys = await getKeys()

  // Connexions bancaires actives (session non expiree). Pas de write-back du
  // statut ici : c'est le role de la sync, reconcile reste en lecture cote EB.
  const { data: connRows, error: connErr } = await admin
    .from('bank_connections')
    .select('id, enc_payload:enc_b64')
    .eq('user_id', userId)
    .limit(100)
  if (connErr) throw new ApiError(500, 'lecture bank_connections impossible')
  const connections = await decryptRows<BankConnectionPayload>(
    'bank_connections',
    userId,
    connRows ?? [],
  )
  const now = Date.now()
  const activeConnections = connections.filter(
    (c) =>
      c.sessionState === 'active' && (!c.validUntil || Date.parse(c.validUntil) >= now),
  )
  if (activeConnections.length === 0) return { adjusted: [] }

  const [accounts, categories] = await Promise.all([
    loadAll<AccountPayload>('accounts', userId),
    loadAll<CategoryPayload>('categories', userId),
  ])
  const accountByUid = new Map<string, WithId<AccountPayload>>()
  for (const acc of accounts) {
    if (acc.providerAccountUid) accountByUid.set(acc.providerAccountUid, acc)
  }

  // Meme choix de categorie que /api actionCreateAccount : la categorie de
  // revenus "Solde d'ouverture" de preference, sinon n'importe quel revenu.
  const incomeCategory =
    categories.find((c) => c.isIncome && c.name === OPENING_BALANCE_LABEL) ??
    categories.find((c) => c.isIncome)

  // TOUTES les transactions du user (tx_hash en clair pour reperer les saisies
  // manuelles), dechiffrees une fois puis regroupees par compte local. Pagine
  // (plafond PostgREST) sinon le rapprochement ignore les tx au-dela de 1000.
  const txRows = await loadAllRows<TxRow>(
    'transactions',
    userId,
    'id, enc_core:enc_core_b64, enc_text:enc_text_b64, enc_payload:enc_b64, tx_hash',
  )
  const allTxs = await decryptTxRows(userId, txRows)
  const txsByAccount = new Map<string, DecryptedTx[]>()
  for (const tx of allTxs) {
    const list = txsByAccount.get(tx.payload.accountId)
    if (list) list.push(tx)
    else txsByAccount.set(tx.payload.accountId, [tx])
  }

  const adjusted: {
    accountId: string
    accountName: string
    delta: number
    newBalance: number
  }[] = []
  const processed = new Set<string>()
  // Garde REF I (voir aggStaleBeforeWrite) : invalidation avant 1re ecriture.
  const aggWrites: AggWriteGuard = { count: 0, staled: false }

  for (const conn of activeConnections) {
    for (const ebAccount of conn.accounts) {
      const localAccount = accountByUid.get(ebAccount.uid)
      // Compte EB non lie, ou deja traite via une autre connexion : ignore.
      if (!localAccount || processed.has(localAccount.id)) continue
      processed.add(localAccount.id)

      // HYP EB : GET /accounts/{uid}/balances -> { balances: [...] }.
      const res = (await ebFetch(
        `/accounts/${encodeURIComponent(ebAccount.uid)}/balances`,
      )) as { balances?: EbBalance[] }
      const balance = pickBalance(res.balances ?? [])
      const ebCents = balance ? ebBalanceToCents(balance) : null
      // Solde inexploitable : on n'ajuste rien plutot que de deviner.
      if (ebCents === null) continue

      const accountTxs = txsByAccount.get(localAccount.id) ?? []
      const localCents = accountTxs.reduce((sum, tx) => sum + tx.payload.amount, 0)
      const delta = ebCents - localCents
      if (delta === 0) continue

      // Transaction de solde d'ouverture : saisie manuelle (tx_hash null) au
      // libelle seme par /api. En cas de doublon, la plus ancienne gagne.
      const opening = accountTxs
        .filter((tx) => tx.txHash === null && tx.payload.label === OPENING_BALANCE_LABEL)
        .sort((a, b) => (a.payload.bookingDate < b.payload.bookingDate ? -1 : 1))[0]

      // Invalidation des agregats AVANT la premiere ecriture (REF I) : un
      // echec en milieu de boucle laisse un etat non-pret, jamais un 'ready'
      // ignorant les ajustements deja commites.
      await aggStaleBeforeWrite(userId, aggWrites)
      if (opening) {
        // Ajustement : l'ecart est absorbe dans le montant d'ouverture. Pas
        // d'extra : month_idx et tx_hash de la ligne restent intacts.
        await updateTx(userId, opening.id, {
          ...opening.payload,
          amount: opening.payload.amount + delta,
        })
      } else {
        // Aucune ouverture : on en cree une datee de la veille de la plus
        // ancienne transaction du compte (ou aujourd'hui si compte vide),
        // meme forme de payload que /api actionCreateAccount.
        const oldestDate = accountTxs.reduce<string | null>(
          (min, tx) => (min === null || tx.payload.bookingDate < min ? tx.payload.bookingDate : min),
          null,
        )
        const bookingDate = oldestDate
          ? shiftDays(oldestDate, -1)
          : new Date().toISOString().slice(0, 10)
        const bookingMonth = bookingDate.slice(0, 7)
        const payload: TxPayload = {
          accountId: localAccount.id,
          categoryId: localAccount.onBudget ? (incomeCategory?.id ?? null) : null,
          bookingDate,
          bookingMonth,
          amount: delta,
          label: OPENING_BALANCE_LABEL,
          transferGroupId: null,
        }
        // tx_hash reste NULL : saisie systeme, pas de dedup bancaire.
        await insertTx(userId, payload, {
          month_idx: await txMonthIdx(keys, userId, bookingMonth),
        })
      }

      adjusted.push({
        accountId: localAccount.id,
        accountName: localAccount.name,
        delta,
        newBalance: ebCents,
      })
    }
  }

  // Agregats (REF I) : remise a la verite apres les ajustements (le marqueur a
  // ete invalide avant la premiere ecriture, cf. aggStaleBeforeWrite).
  if (aggWrites.count > 0) {
    await refreshAggregatesSafe(userId)
  }

  return { adjusted }
}

// ---------------------------------------------------------------------------
// Lecture bornee du corps (identique a /api)
// ---------------------------------------------------------------------------

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

// Enumere les user_id ayant au moins une connexion bancaire (mode cron).
async function allUsersWithConnections(): Promise<string[]> {
  const { data, error } = await admin
    .from('bank_connections')
    .select('user_id')
    .limit(100000)
  if (error) throw new ApiError(500, 'lecture bank_connections impossible')
  return [...new Set((data ?? []).map((r) => r.user_id as string))]
}

// Verifie le JWT utilisateur + allowlist (identique a /api). Renvoie le userId.
async function requireUser(req: Request): Promise<string> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) throw new ApiError(401, 'authentification requise')
  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: authError } = await authClient.auth.getUser()
  if (authError || !userData.user) throw new ApiError(401, 'session invalide')
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
  return userData.user.id
}

// Comparaison a temps constant de deux chaines (secret cron). On ne compare pas
// les chaines brutes (dont la longueur/le contenu fuiraient par le timing) mais
// leurs HMAC-SHA256 sous une cle ephemere aleatoire : deux digests de 32 octets
// compares par accumulation XOR sans court-circuit.
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const enc = new TextEncoder()
  const da = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(a)))
  const db = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(b)))
  let diff = 0
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i]
  return diff === 0
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

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
    // Mode d'appel : cron (secret partage, tous les users) ou user (JWT).
    const cronSecret = Deno.env.get('SYNC_CRON_SECRET') ?? ''
    const providedCron = req.headers.get('x-cron-secret') ?? ''
    const isCron = cronSecret.length > 0 && (await constantTimeEqual(providedCron, cronSecret))

    let userId: string | null = null
    if (!isCron) {
      userId = await requireUser(req)
    }

    const rawBody = await readBoundedBody(req, 64_000)
    let body: { action?: unknown; params?: unknown }
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody))
    } catch {
      throw new ApiError(400, 'corps JSON invalide')
    }
    if (typeof body?.action !== 'string') {
      throw new ApiError(400, 'action inconnue')
    }
    action = body.action
    const params = (body.params as Params) ?? {}

    let result: unknown
    switch (action) {
      case 'startAuth':
        if (isCron || !userId) throw new ApiError(401, 'action reservee a un utilisateur')
        result = await actionStartAuth(userId, params)
        break
      case 'finalizeAuth':
        if (isCron || !userId) throw new ApiError(401, 'action reservee a un utilisateur')
        result = await actionFinalizeAuth(userId, params)
        break
      case 'listAspsps':
        if (isCron || !userId) throw new ApiError(401, 'action reservee a un utilisateur')
        result = await actionListAspsps()
        break
      case 'sync': {
        const targets = isCron ? await allUsersWithConnections() : [userId as string]
        // sinceDays : diagnostic / import initial reserve au mode user, borne a 2 ans.
        const rawSince = (params as { sinceDays?: unknown }).sinceDays
        const sinceDays =
          !isCron && typeof rawSince === 'number' && rawSince > 0
            ? Math.min(Math.floor(rawSince), 730)
            : undefined
        // Import cible sur une seule connexion (mode user) : n'importer que la
        // banque demandee, sans re-toucher aux autres comptes deja synchronises.
        const rawConn = (params as { connectionId?: unknown }).connectionId
        const connectionId =
          !isCron && typeof rawConn === 'string' && rawConn ? rawConn : undefined
        const syncResult = await actionSync(targets, isCron, sinceDays, connectionId)
        // sinceDays peut importer des transactions ANTERIEURES a la date
        // d'activation (donc au solde d'ouverture saisi manuellement) : la
        // reconciliation est enchainee COTE SERVEUR pour garantir des soldes
        // justes sans dependre d'un second appel du front. Best-effort : un
        // echec de reconciliation ne masque pas un import reussi.
        if (!isCron && userId && sinceDays != null) {
          try {
            const rec = await actionReconcile(userId)
            result = { ...syncResult, adjusted: rec.adjusted }
          } catch (err) {
            const message = err instanceof ApiError ? err.message : 'reconciliation echouee'
            result = { ...syncResult, errors: [...syncResult.errors, message] }
          }
        } else {
          result = syncResult
        }
        break
      }
      case 'reconcile':
        if (isCron || !userId) throw new ApiError(401, 'action reservee a un utilisateur')
        result = await actionReconcile(userId)
        break
      default:
        throw new ApiError(400, 'action inconnue')
    }

    return new Response(JSON.stringify(result), { status: 200, headers })
  } catch (err) {
    if (err instanceof ApiError) {
      console.error(`sync-bank action=${action} status=${err.status} message=${err.message}`)
      return new Response(JSON.stringify({ error: err.message }), { status: err.status, headers })
    }
    console.error(`sync-bank action=${action} status=500 erreur inattendue`)
    return new Response(JSON.stringify({ error: 'erreur interne' }), { status: 500, headers })
  }
})
