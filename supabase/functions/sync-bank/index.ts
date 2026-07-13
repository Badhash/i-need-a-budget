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
//                   tx_hash, categorisation par regles, journalisation.
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
  base64UrlEncode,
  bytesToPgHex,
  decryptJson,
  deriveKeys,
  encryptJson,
  normalizeLabel,
  pgHexToBytes,
  txHashIdx,
  txMonthIdx,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'

// ---------------------------------------------------------------------------
// Types des payloads chiffres (memes contrats que l'Edge Function /api)
// ---------------------------------------------------------------------------

interface AccountPayload {
  name: string
  institution: string
  kind: 'checking' | 'savings' | 'investment'
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
  accounts: { uid: string; name?: string }[]
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
  const { error } = await admin
    .from(table)
    .update({ enc_payload: bytesToPgHex(await encryptJson(keys, payload, [table, userId])), ...extra })
    .eq('user_id', userId)
    .eq('id', id)
  if (error) throw new ApiError(500, `mise a jour ${table} impossible`)
}

// Insertion d'une transaction importee, idempotente sur (user_id, tx_hash).
// ignoreDuplicates : un doublon (run cron et run manuel concurrents) est ignore
// silencieusement. Aucun .select() : sur conflit, aucune ligne n'est renvoyee.
async function insertImportedTransaction(
  userId: string,
  payload: TxPayload,
  monthIdx: string,
  txHash: string,
): Promise<void> {
  const keys = await getKeys()
  const { error } = await admin.from('transactions').upsert(
    {
      user_id: userId,
      enc_payload: bytesToPgHex(await encryptJson(keys, payload, ['transactions', userId])),
      month_idx: monthIdx,
      tx_hash: txHash,
    },
    { onConflict: 'user_id,tx_hash', ignoreDuplicates: true },
  )
  if (error) throw new ApiError(500, 'ecriture transactions impossible')
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

// Nombre de jours de recouvrement volontaire entre deux syncs : on re-demande un
// peu de passe. La dedup (tx_hash) absorbe les doublons, donc etre large ne coute
// que de la bande passante, jamais la justesse.
const OVERLAP_DAYS = 7

// Charge et dechiffre les derniers sync_logs du user (run_at en clair, status
// chiffre). Retourne les entrees decodees, ordonnees du plus recent au plus
// ancien. Une entree indechiffrable est ignoree (ne doit pas bloquer la sync).
async function loadRecentSyncLogs(
  userId: string,
): Promise<{ runAt: string; payload: SyncLogPayload }[]> {
  const keys = await getKeys()
  const { data, error } = await admin
    .from('sync_logs')
    .select('id, enc_payload, run_at')
    .eq('user_id', userId)
    .order('run_at', { ascending: false })
    .limit(500)
  if (error) throw new ApiError(500, 'lecture sync_logs impossible')
  const out: { runAt: string; payload: SyncLogPayload }[] = []
  for (const row of data ?? []) {
    try {
      const payload = await decryptJson<SyncLogPayload>(
        keys,
        pgHexToBytes(row.enc_payload),
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
// Synchronisation d'un utilisateur
// ---------------------------------------------------------------------------

async function syncUser(userId: string): Promise<number> {
  const keys = await getKeys()

  // Connexions bancaires actives de l'utilisateur.
  const { data: connRows, error: connErr } = await admin
    .from('bank_connections')
    .select('id, enc_payload, created_at')
    .eq('user_id', userId)
    .limit(100)
  if (connErr) throw new ApiError(500, 'lecture bank_connections impossible')

  const connections = await Promise.all(
    (connRows ?? []).map(async (row) => ({
      id: row.id,
      createdAt: row.created_at as string,
      payload: await decryptJson<BankConnectionPayload>(
        keys,
        pgHexToBytes(row.enc_payload),
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
  if (activeConnections.length === 0) return 0

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

  // Ensemble des tx_hash existants du user (dedup import bancaire).
  const { data: hashRows, error: hashErr } = await admin
    .from('transactions')
    .select('tx_hash')
    .eq('user_id', userId)
    .not('tx_hash', 'is', null)
    .limit(200000)
  if (hashErr) throw new ApiError(500, 'lecture tx_hash impossible')
  const seenHashes = new Set<string>((hashRows ?? []).map((r) => r.tx_hash as string))

  // Marqueur incremental : on charge et dechiffre les derniers sync_logs pour
  // retrouver, par connexion, la derniere sync REUSSIE (status 'ok' relu apres
  // dechiffrement). Un run en echec n'avance donc jamais la borne d'une
  // connexion, et une connexion saine n'influe pas sur une connexion en panne.
  const recentLogs = await loadRecentSyncLogs(userId)

  let importedTotal = 0

  for (const conn of activeConnections) {
    let importedForConn = 0
    try {
      // Date de depart : derniere sync REUSSIE de CETTE connexion (moins le
      // recouvrement), sinon date d'activation (created_at, en clair). On ne
      // remonte jamais avant l'activation : seules les transactions posterieures
      // sont importees (le solde d'ouverture est saisi manuellement).
      const activationDate = conn.createdAt.slice(0, 10)
      const lastOkDate = lastSuccessfulRunDate(recentLogs, conn.id)
      const dateFrom = lastOkDate
        ? maxDate(shiftDays(lastOkDate, -OVERLAP_DAYS), activationDate)
        : activationDate

      for (const ebAccount of conn.payload.accounts) {
        const localAccount = accountByUid.get(ebAccount.uid)
        // Un compte EB non encore lie a un compte interne est ignore : la
        // liaison (providerAccountUid) se fait cote /api.
        if (!localAccount) continue

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
      await logSyncSafe(userId, {
        connectionId: conn.id,
        status: 'error',
        importedCount: importedForConn,
        error: message,
      })
    }
  }

  return importedTotal
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Params = Record<string, unknown>

// startAuth : ouvre une session d'autorisation PSD2, renvoie l'URL de la banque.
async function actionStartAuth(userId: string, params: Params) {
  const redirectUrl =
    typeof params.redirectUrl === 'string' && params.redirectUrl.trim()
      ? params.redirectUrl.trim()
      : Deno.env.get('ENABLE_BANKING_REDIRECT_URL') ?? ''
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
    accounts?: Array<string | { uid?: string; name?: string; account_id?: { name?: string } }>
    access?: { valid_until?: string }
    aspsp?: { name?: string }
  }
  if (!session.session_id) throw new ApiError(502, 'Enable Banking : session_id absent')

  const accounts: { uid: string; name?: string }[] = []
  for (const entry of session.accounts ?? []) {
    if (typeof entry === 'string') {
      accounts.push({ uid: entry })
    } else if (entry && typeof entry.uid === 'string') {
      const name = entry.name ?? entry.account_id?.name
      accounts.push(name ? { uid: entry.uid, name } : { uid: entry.uid })
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
async function actionSync(targetUserIds: string[], isCron: boolean) {
  let imported = 0
  for (const userId of targetUserIds) {
    try {
      imported += await syncUser(userId)
    } catch (err) {
      // Erreur "dure" (chargement impossible) : journalisee, puis on continue en
      // mode cron. En mode user, on la propage pour un retour d'erreur explicite.
      await logSyncSafe(userId, {
        connectionId: null,
        status: 'error',
        importedCount: 0,
        error: err instanceof ApiError ? err.message : 'synchronisation echouee',
      })
      if (!isCron) throw err
    }
  }
  return { imported }
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
        result = await actionSync(targets, isCron)
        break
      }
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
