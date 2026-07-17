// REF I — Agregats chiffres pre-calcules (optimisation egress).
//
// Ce module maintient et lit trois tables d'agregats chiffres (voir
// supabase/migrations-manual/I-aggregates.sql) pour que bootstrap et
// getBudgetMonth n'aient plus a relire TOUT l'historique des transactions :
//
//   - account_balances : solde (somme des montants) par compte, TOUS comptes,
//     TOUTES transactions (transferts et hors-budget compris).
//   - month_rollups     : activity + assigned par (categorie, mois), limites au
//     perimetre "budget" (compte on-budget, hors transfert, categorie non nulle).
//     Reproduit exactement ce que le moteur agrege depuis les transactions brutes
//     (packages/engine filtre lui-meme : hors-budget, transferts et categoryId
//     null n'impactent ni activity ni RTA).
//   - uncat_counts       : nombre de transactions "a categoriser" par mois
//     (categoryId null, hors transfert), tous comptes — pour le badge de la nav.
//
// Un marqueur aggregate_state (1 ligne / user) porte l'etat : payload chiffre
// { version, status: 'ready' | 'building' } + colonne rev en clair (compteur de
// version CAS, pas une donnee metier). INVARIANT CENTRAL : status 'ready'
// implique des agregats corrects. Tout chemin qui ne peut pas le garantir doit
// invalider le marqueur (les lectures retombent alors sur le calcul complet,
// toujours juste, et bootstrapFull reconstruit a l'ouverture suivante).
//
// Protocole de fence (issu de la revue adversariale) :
//   * ECRITURE (aggMaintain) : bump rev AVANT les ajustements, ajustements,
//     puis POST-CHECK : si rev a encore bouge (un recompute est passe), on
//     invalide — les ajustements ont pu atterrir sur des tables reconstruites
//     qui les integraient deja (double comptage), on prefere le fallback.
//   * RECOMPUTE (aggRecompute) : pose 'building' (bump rev, garde memorisee),
//     PUIS charge la source (jamais l'inverse : une ecriture pendant le
//     chargement bumpe rev et fait echouer la bascule finale), reconstruit,
//     et ne bascule 'ready' QUE si rev n'a pas bouge (CAS). Un recompute
//     perdant invalide le marqueur (il peut avoir insere des lignes parasites
//     apres la bascule d'un recompute gagnant concurrent).
//
// Transport : lectures via computed columns base64 (REF D, enc_b64) ; ecritures
// directes PostgREST en litteral hex bytea (les RPC enc_insert/enc_update ne
// couvrent pas le CAS conditionnel sur rev, et l'ingress n'est pas facture).
//
// AAD / index aveugles : memes schemas HMAC que l'existant (packages/crypto),
// domaines distincts ('acct-balance', 'rollup', 'rollup-month', 'uncat-month').
//
// Fuites residuelles assumees (metadonnees techniques, en plus de celles du
// CLAUDE.md) : rev revele un nombre d'ecritures, built_at un horodatage de
// reconstruction — equivalents des created_at deja en clair partout.
//
// INTERDIT : logger des payloads dechiffres ou la cle.

import {
  assignIdx,
  base64ToBytes,
  blindIndex,
  bytesToPgHex,
  decryptJson,
  encryptJson,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

// Version de la LOGIQUE d'agregation. La bumper force un recompute : un
// marqueur d'une version anterieure est traite comme "non pret" (fallback).
const AGG_VERSION = 1
const READ_PAGE = 1000
const INSERT_CHUNK = 500
const MAX_CAS_ATTEMPTS = 5

type Db = SupabaseClient

// Vue minimale d'une transaction pour l'agregation (sous-ensemble de TxCore).
export interface AggTx {
  accountId: string
  categoryId: string | null
  bookingMonth: string
  amount: number
  transferGroupId?: string | null
}

interface BalancePayload {
  accountId: string
  balance: number
}
interface RollupPayload {
  categoryId: string
  month: string
  activity: number
  assigned: number
}
interface UncatPayload {
  month: string
  count: number
}
interface StatePayload {
  version: number
  status: 'ready' | 'building'
}

const STATE_CTX = (userId: string) => ['aggregate_state', userId]

// Table absente du schema (SQL REF I pas encore applique) : PGRST205 = table
// inconnue du cache PostgREST, 42P01 = relation inexistante cote Postgres.
// Dans ces cas les agregats sont simplement INACTIFS (pas une erreur).
function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

// ---------------------------------------------------------------------------
// Index aveugles (domaines dedies aux agregats)
// ---------------------------------------------------------------------------

const balanceIdx = (k: CryptoKeys, u: string, accountId: string) =>
  blindIndex(k, ['acct-balance', u, accountId])
const rollupIdx = (k: CryptoKeys, u: string, categoryId: string, month: string) =>
  blindIndex(k, ['rollup', u, categoryId, month])
const rollupMonthIdx = (k: CryptoKeys, u: string, month: string) =>
  blindIndex(k, ['rollup-month', u, month])
const uncatMonthIdx = (k: CryptoKeys, u: string, month: string) =>
  blindIndex(k, ['uncat-month', u, month])

// ---------------------------------------------------------------------------
// Chargement pagine generique (PostgREST plafonne a 1000 lignes / reponse)
// ---------------------------------------------------------------------------

async function loadRows<R>(admin: Db, table: string, userId: string, columns: string): Promise<R[]> {
  const rows: R[] = []
  for (let from = 0; ; from += READ_PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1)
    if (error) throw new Error(`lecture agregat ${table} impossible`)
    if (!data || data.length === 0) break
    rows.push(...(data as R[]))
    if (data.length < READ_PAGE) break
  }
  return rows
}

async function insertChunked(
  admin: Db,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await admin.from(table).insert(rows.slice(i, i + INSERT_CHUNK))
    if (error) throw new Error(`ecriture agregat ${table} impossible`)
  }
}

// ---------------------------------------------------------------------------
// Marqueur d'etat (aggregate_state) : version + statut chiffres, rev en clair
// ---------------------------------------------------------------------------

interface StateSnapshot {
  rev: number
  payload: StatePayload
}

// Lit et dechiffre le marqueur. null = marqueur ABSENT ou table absente (SQL
// pas applique) : agregats inactifs. Toute autre erreur (reseau, marqueur
// indechiffrable) LEVE : l'appelant decide (aggIsReady -> false ; aggMaintain
// -> invalidation). Ne JAMAIS confondre une erreur transitoire avec une
// absence : sauter silencieusement une maintenance laisserait un 'ready' faux.
async function readState(admin: Db, keys: CryptoKeys, userId: string): Promise<StateSnapshot | null> {
  const { data, error } = await admin
    .from('aggregate_state')
    .select('rev, enc_payload:enc_b64')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error('lecture aggregate_state impossible')
  }
  if (!data) return null
  const payload = await decryptJson<StatePayload>(
    keys,
    base64ToBytes(data.enc_payload as string),
    STATE_CTX(userId),
  )
  return { rev: Number(data.rev), payload }
}

export async function aggIsReady(admin: Db, keys: CryptoKeys, userId: string): Promise<boolean> {
  try {
    const state = await readState(admin, keys, userId)
    return state !== null && state.payload.version === AGG_VERSION && state.payload.status === 'ready'
  } catch {
    return false // lecture impossible / marqueur corrompu : fallback silencieux
  }
}

// Incremente rev par CAS (fence). Retourne le rev POST-bump, ou null si le
// marqueur a disparu entre-temps (agregats invalides : ne rien maintenir).
// Contention persistante -> leve (l'appelant invalide).
async function bumpStateRev(admin: Db, userId: string): Promise<number | null> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, error } = await admin
      .from('aggregate_state')
      .select('rev')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error('lecture aggregate_state impossible')
    if (!data) return null
    const rev = Number(data.rev)
    const { data: upd, error: updErr } = await admin
      .from('aggregate_state')
      .update({ rev: rev + 1 })
      .eq('user_id', userId)
      .eq('rev', rev)
      .select('user_id')
    if (updErr) throw new Error('ecriture aggregate_state impossible')
    if (upd && upd.length > 0) return rev + 1
  }
  throw new Error('aggregate_state : contention persistante (CAS)')
}

/**
 * Invalide les agregats (suppression du marqueur) : les lectures repassent au
 * calcul complet et bootstrapFull reconstruira. Retente sur erreur transitoire
 * (c'est le filet de securite : il doit reussir). Ne LEVE que si la suppression
 * echoue durablement — table absente = deja inactif, jamais une erreur.
 */
export async function aggMarkStale(admin: Db, userId: string): Promise<void> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin.from('aggregate_state').delete().eq('user_id', userId)
    if (!error || isMissingTable(error)) return
    lastError = error
  }
  throw new Error('invalidation aggregate_state impossible', { cause: lastError })
}

// ---------------------------------------------------------------------------
// Ensemble des comptes on-budget (charge une fois par lot de maintenance)
// ---------------------------------------------------------------------------

async function loadOnBudget(admin: Db, keys: CryptoKeys, userId: string): Promise<Set<string>> {
  const rows = await loadRows<{ id: string; enc_payload: string }>(
    admin,
    'accounts',
    userId,
    'id, enc_payload:enc_b64',
  )
  const set = new Set<string>()
  for (const r of rows) {
    const p = await decryptJson<{ onBudget: boolean }>(keys, base64ToBytes(r.enc_payload), [
      'accounts',
      userId,
    ])
    if (p.onBudget) set.add(r.id)
  }
  return set
}

// ---------------------------------------------------------------------------
// Primitives de mise a jour incrementale — CONCURRENCE OPTIMISTE (CAS)
// ---------------------------------------------------------------------------
//
// La valeur agregee est CHIFFREE : impossible de faire un increment atomique en
// SQL pur, et les advisory locks de session ne survivent pas au pooling stateless
// de PostgREST. On applique donc un compare-and-swap sur une colonne `rev` :
//
//   1. SELECT id, rev, enc_payload de la ligne (ou absence).
//   2. Dechiffre, applique le delta via compute() (rappele A CHAQUE tentative :
//      il peut relire la verite metier), calcule la nouvelle valeur.
//   3a. Ligne presente, valeur non vide  -> UPDATE ... WHERE id=? AND rev=<lu>,
//       SET rev=rev+1. Si 0 ligne touchee (rev a bouge entre 1 et 3) -> RE-LIS.
//   3b. Ligne presente, valeur vide       -> DELETE ... WHERE id=? AND rev=<lu>.
//       Si 0 ligne touchee -> RE-LIS.
//   3c. Ligne absente, valeur non vide     -> INSERT (rev=0). Conflit d'unicite
//       (23505, ligne apparue en parallele) -> RE-LIS.
//   3d. Ligne absente, valeur vide         -> rien a faire.
//
// Boucle bornee (MAX_CAS_ATTEMPTS). Si la contention persiste au-dela, on LEVE :
// aggMaintain (appelant) capture, invalide, et les lectures repassent au calcul
// complet -> jamais de chiffre faux fige.

// `compute(current)` recoit la valeur courante dechiffree (ou null si absente)
// et renvoie le nouveau payload a persister, ou null pour "cellule vide"
// (SUPPRIME si presente, NE FAIT RIEN si absente). Peut etre asynchrone.
async function casAdjust<P>(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  table: string,
  matchCol: string,
  matchVal: string,
  extraInsert: Record<string, unknown>,
  compute: (current: P | null) => P | null | Promise<P | null>,
): Promise<void> {
  const context = [table, userId]
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, error } = await admin
      .from(table)
      .select('id, rev, enc_payload:enc_b64')
      .eq('user_id', userId)
      .eq(matchCol, matchVal)
      .maybeSingle()
    if (error) throw new Error(`lecture agregat ${table} impossible`)

    if (!data) {
      const next = await compute(null)
      if (next === null) return // rien a materialiser
      const { error: insErr } = await admin.from(table).insert({
        user_id: userId,
        [matchCol]: matchVal,
        ...extraInsert,
        rev: 0,
        enc_payload: bytesToPgHex(await encryptJson(keys, next, context)),
      })
      if (!insErr) return
      // 23505 = unique_violation : une ligne concurrente est apparue -> re-lis.
      if ((insErr as { code?: string }).code === '23505') continue
      throw new Error(`ecriture agregat ${table} impossible`)
    }

    const rev = Number(data.rev)
    const current = await decryptJson<P>(keys, base64ToBytes(data.enc_payload as string), context)
    const next = await compute(current)

    if (next === null) {
      // Cellule devenue vide : suppression conditionnelle (CAS).
      const { data: del, error: delErr } = await admin
        .from(table)
        .delete()
        .eq('id', data.id)
        .eq('rev', rev)
        .select('id')
      if (delErr) throw new Error(`ecriture agregat ${table} impossible`)
      if (del && del.length > 0) return
      continue // rev a change -> re-lis
    }

    // Mise a jour conditionnelle (CAS) : n'ecrit que si rev n'a pas bouge.
    const { data: upd, error: updErr } = await admin
      .from(table)
      .update({
        ...extraInsert,
        rev: rev + 1,
        enc_payload: bytesToPgHex(await encryptJson(keys, next, context)),
      })
      .eq('id', data.id)
      .eq('rev', rev)
      .select('id')
    if (updErr) throw new Error(`ecriture agregat ${table} impossible`)
    if (upd && upd.length > 0) return
    // rev a change entre le SELECT et l'UPDATE -> quelqu'un a ecrit, on recommence.
  }
  throw new Error(`agregat ${table} : contention persistante (CAS)`)
}

async function adjustBalance(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  accountId: string,
  delta: number,
): Promise<void> {
  const idx = await balanceIdx(keys, userId, accountId)
  // Le solde conserve TOUJOURS une ligne (meme a 0) : jamais de retour null.
  await casAdjust<BalancePayload>(
    admin,
    keys,
    userId,
    'account_balances',
    'account_idx',
    idx,
    {},
    (cur) => ({ accountId, balance: (cur?.balance ?? 0) + delta }),
  )
}

// dActivity = delta sur activity. `readAssigned` (si fourni) est rappele a
// CHAQUE tentative CAS et doit renvoyer la valeur ABSOLUE courante d'assigned
// relue depuis la table assignments : deux maintenances concurrentes convergent
// ainsi vers la derniere valeur commitee, quel que soit leur ordre d'arrivee
// (une valeur figee en parametre pourrait ecraser une plus recente).
async function adjustRollup(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  categoryId: string,
  month: string,
  dActivity: number,
  readAssigned?: () => Promise<number>,
): Promise<void> {
  const idx = await rollupIdx(keys, userId, categoryId, month)
  const monthIdx = await rollupMonthIdx(keys, userId, month)
  await casAdjust<RollupPayload>(
    admin,
    keys,
    userId,
    'month_rollups',
    'rollup_idx',
    idx,
    { month_idx: monthIdx },
    async (cur) => {
      const activity = (cur?.activity ?? 0) + dActivity
      const assigned = readAssigned ? await readAssigned() : (cur?.assigned ?? 0)
      if (activity === 0 && assigned === 0) return null // cellule vide -> sparse
      return { categoryId, month, activity, assigned }
    },
  )
}

async function adjustUncat(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  month: string,
  dCount: number,
): Promise<void> {
  const idx = await uncatMonthIdx(keys, userId, month)
  await casAdjust<UncatPayload>(
    admin,
    keys,
    userId,
    'uncat_counts',
    'month_idx',
    idx,
    {},
    (cur) => {
      const count = (cur?.count ?? 0) + dCount
      if (count <= 0) return null
      return { month, count }
    },
  )
}

// Valeur ABSOLUE courante d'assigned pour (categorie, mois), relue depuis la
// table assignments (source de verite). Ligne absente = 0.
async function readAssignedAmount(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  categoryId: string,
  month: string,
): Promise<number> {
  const idx = await assignIdx(keys, userId, categoryId, month)
  const { data, error } = await admin
    .from('assignments')
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
    .eq('assign_idx', idx)
    .maybeSingle()
  if (error) throw new Error('lecture assignments impossible')
  if (!data) return 0
  const p = await decryptJson<{ amount: number }>(
    keys,
    base64ToBytes(data.enc_payload as string),
    ['assignments', userId],
  )
  return p.amount
}

// Contribution d'une transaction aux agregats (sign = +1 ajout, -1 retrait).
async function applyContribution(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  onBudget: Set<string>,
  sign: number,
  tx: AggTx,
): Promise<void> {
  // Solde : TOUTES les transactions (transferts, hors-budget, a categoriser).
  await adjustBalance(admin, keys, userId, tx.accountId, sign * tx.amount)

  if (tx.transferGroupId) return // transfert : neutre pour activity et uncat

  if (tx.categoryId == null) {
    // A categoriser : compte pour le badge (tous comptes, cf. bootstrap).
    await adjustUncat(admin, keys, userId, tx.bookingMonth, sign)
    return
  }
  // Categorisee et hors transfert : activity uniquement si compte on-budget
  // (le moteur ignore les comptes de suivi). Vaut pour categorie de revenus
  // (inflow) comme pour categorie d'enveloppe (depense).
  if (onBudget.has(tx.accountId)) {
    await adjustRollup(admin, keys, userId, tx.categoryId, tx.bookingMonth, sign * tx.amount)
  }
}

// ---------------------------------------------------------------------------
// Session de maintenance : fence + lot d'operations + post-check
// ---------------------------------------------------------------------------

export interface AggBatch {
  /** Ajoute (+1) ou retire (-1) la contribution d'une transaction. */
  applyTx(sign: number, tx: AggTx): Promise<void>
  /** Retire l'ancienne version puis ajoute la nouvelle (edition / categorisation). */
  replaceTx(oldTx: AggTx, newTx: AggTx): Promise<void>
  /**
   * Synchronise assigned pour (categorie, mois) : la valeur est RELUE depuis
   * la table assignments a chaque tentative (jamais passee en parametre).
   */
  setAssigned(categoryId: string, month: string): Promise<void>
  /** Garantit l'existence d'une ligne de solde (a 0) pour un compte. */
  ensureAccount(accountId: string): Promise<void>
}

export interface AggSession {
  batch: AggBatch
  /** rev du marqueur juste apres la fence : sert au post-check d'aggMaintain. */
  fenceRev: number
}

/**
 * Ouvre une session de maintenance. Incremente TOUJOURS rev quand le marqueur
 * existe (fence : un recompute concurrent ne marquera pas 'ready' un etat qui
 * ignore cette ecriture), puis retourne la session seulement si les agregats
 * sont prets. null = inactifs / en reconstruction : l'appelant ne fait rien,
 * les lectures retombent sur le calcul complet.
 */
export async function aggBegin(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
): Promise<AggSession | null> {
  const state = await readState(admin, keys, userId)
  if (state === null) return null
  // Fence AVANT les ajustements : voir l'en-tete du module.
  const fenceRev = await bumpStateRev(admin, userId)
  if (fenceRev === null) return null // marqueur disparu : agregats invalides
  if (state.payload.version !== AGG_VERSION || state.payload.status !== 'ready') return null
  const onBudget = await loadOnBudget(admin, keys, userId)
  return {
    fenceRev,
    batch: {
      applyTx: (sign, tx) => applyContribution(admin, keys, userId, onBudget, sign, tx),
      replaceTx: async (oldTx, newTx) => {
        await applyContribution(admin, keys, userId, onBudget, -1, oldTx)
        await applyContribution(admin, keys, userId, onBudget, +1, newTx)
      },
      setAssigned: (categoryId, month) =>
        adjustRollup(admin, keys, userId, categoryId, month, 0, () =>
          readAssignedAmount(admin, keys, userId, categoryId, month),
        ),
      ensureAccount: (accountId) => adjustBalance(admin, keys, userId, accountId, 0),
    },
  }
}

/**
 * Post-check de fence : a appeler APRES les ajustements d'une session. Si rev
 * a bouge depuis la fence, un recompute (ou une autre ecriture) s'est
 * intercale : nos ajustements ont pu atterrir sur des tables reconstruites qui
 * les integraient deja (double comptage). On invalide — faux positif possible
 * avec une simple maintenance concurrente, mais la degradation (fallback +
 * reconstruction) est toujours sure.
 */
export async function aggPostCheck(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  fenceRev: number,
): Promise<void> {
  const state = await readState(admin, keys, userId)
  if (state !== null && state.rev !== fenceRev) {
    await aggMarkStale(admin, userId)
  }
}

// ---------------------------------------------------------------------------
// Lectures agregees (utilisees par bootstrap / getBudgetMonth quand actives)
// ---------------------------------------------------------------------------

export async function aggReadBalances(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
): Promise<Map<string, number>> {
  const rows = await loadRows<{ enc_payload: string }>(
    admin,
    'account_balances',
    userId,
    'id, enc_payload:enc_b64',
  )
  const out = new Map<string, number>()
  for (const r of rows) {
    const p = await decryptJson<BalancePayload>(keys, base64ToBytes(r.enc_payload), [
      'account_balances',
      userId,
    ])
    out.set(p.accountId, p.balance)
  }
  return out
}

/** Somme des compteurs "a categoriser" des mois <= maxMonth. */
export async function aggReadUncatCount(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  maxMonth: string,
): Promise<number> {
  const rows = await loadRows<{ enc_payload: string }>(
    admin,
    'uncat_counts',
    userId,
    'id, enc_payload:enc_b64',
  )
  let total = 0
  for (const r of rows) {
    const p = await decryptJson<UncatPayload>(keys, base64ToBytes(r.enc_payload), [
      'uncat_counts',
      userId,
    ])
    if (p.month <= maxMonth) total += p.count
  }
  return total
}

export async function aggReadRollups(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
): Promise<RollupPayload[]> {
  const rows = await loadRows<{ enc_payload: string }>(
    admin,
    'month_rollups',
    userId,
    'id, enc_payload:enc_b64',
  )
  return Promise.all(
    rows.map((r) =>
      decryptJson<RollupPayload>(keys, base64ToBytes(r.enc_payload), ['month_rollups', userId]),
    ),
  )
}

// ---------------------------------------------------------------------------
// Recompute complet (reconstruction / secours) et purge
// ---------------------------------------------------------------------------

const AGG_DATA_TABLES = ['month_rollups', 'account_balances', 'uncat_counts'] as const

/**
 * Efface les agregats d'un user. ORDRE CRITIQUE : le MARQUEUR d'abord (des sa
 * suppression, les agregats sont inactifs et les residus des tables de donnees
 * sont inertes — purges par le prochain recompute). L'inverse laisserait, sur
 * echec partiel, un marqueur 'ready' pointant des tables amputees.
 */
export async function aggClear(admin: Db, userId: string): Promise<void> {
  await aggMarkStale(admin, userId)
  for (const table of AGG_DATA_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error && !isMissingTable(error)) throw new Error(`purge agregat ${table} impossible`)
  }
}

export interface AggSourceData {
  accounts: { id: string; onBudget: boolean }[]
  transactions: AggTx[]
  assignments: { categoryId: string; month: string; amount: number }[]
}

// Pose (ou bascule) le marqueur en 'building' et renvoie le rev de garde qui
// protegera la bascule finale vers 'ready'.
async function setBuilding(admin: Db, keys: CryptoKeys, userId: string): Promise<number> {
  const payloadHex = bytesToPgHex(
    await encryptJson(keys, { version: AGG_VERSION, status: 'building' } satisfies StatePayload, STATE_CTX(userId)),
  )
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const { data, error } = await admin
      .from('aggregate_state')
      .select('rev')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw new Error('lecture aggregate_state impossible')

    if (!data) {
      const { error: insErr } = await admin.from('aggregate_state').insert({
        user_id: userId,
        rev: 0,
        enc_payload: payloadHex,
        built_at: new Date().toISOString(),
      })
      if (!insErr) return 0
      if ((insErr as { code?: string }).code === '23505') continue
      throw new Error('ecriture aggregate_state impossible')
    }

    const rev = Number(data.rev)
    const { data: upd, error: updErr } = await admin
      .from('aggregate_state')
      .update({ rev: rev + 1, enc_payload: payloadHex, built_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('rev', rev)
      .select('user_id')
    if (updErr) throw new Error('ecriture aggregate_state impossible')
    if (upd && upd.length > 0) return rev + 1
  }
  throw new Error('aggregate_state : contention persistante (CAS)')
}

/**
 * Reconstruit integralement les agregats. ORDRE CRITIQUE : pose d'abord la
 * fence ('building', rev de garde), PUIS charge la source via `load` — toute
 * ecriture commitee avant la fence est dans le snapshot, toute ecriture apres
 * bumpe rev et fait echouer la bascule finale. Retourne true si le marqueur a
 * pu etre bascule en 'ready' ; false si une ecriture concurrente a empoisonne
 * la reconstruction (le marqueur est alors INVALIDE : un recompute perdant
 * peut avoir insere des lignes parasites apres la bascule d'un gagnant, on
 * prefere le fallback + reconstruction future). En cas d'echec au milieu, le
 * marqueur reste 'building' : non-pret, jamais de chiffre faux.
 */
export async function aggRecompute(
  admin: Db,
  keys: CryptoKeys,
  userId: string,
  load: () => Promise<AggSourceData>,
): Promise<boolean> {
  // 1. Fence AVANT le snapshot.
  const guardRev = await setBuilding(admin, keys, userId)

  // 2. Snapshot de la verite (posterieur a la fence).
  const data = await load()

  // 3. Purge des tables de donnees (PAS le marqueur : il porte la fence).
  for (const table of AGG_DATA_TABLES) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error) throw new Error(`purge agregat ${table} impossible`)
  }

  const onBudget = new Set(data.accounts.filter((a) => a.onBudget).map((a) => a.id))

  // Soldes : une ligne par compte (meme a 0), somme de TOUTES les transactions.
  const balances = new Map<string, number>()
  for (const a of data.accounts) balances.set(a.id, 0)
  for (const t of data.transactions) {
    balances.set(t.accountId, (balances.get(t.accountId) ?? 0) + t.amount)
  }

  // Rollups : activity (perimetre budget) + assigned, par (categorie, mois).
  const key = (c: string, m: string) => `${c} ${m}`
  const rollups = new Map<string, RollupPayload>()
  const bump = (c: string, m: string): RollupPayload => {
    const k = key(c, m)
    let r = rollups.get(k)
    if (!r) {
      r = { categoryId: c, month: m, activity: 0, assigned: 0 }
      rollups.set(k, r)
    }
    return r
  }
  for (const t of data.transactions) {
    if (t.transferGroupId) continue
    if (t.categoryId == null) continue
    if (!onBudget.has(t.accountId)) continue
    bump(t.categoryId, t.bookingMonth).activity += t.amount
  }
  for (const a of data.assignments) {
    bump(a.categoryId, a.month).assigned += a.amount
  }

  // Compteur "a categoriser" par mois (tous comptes, hors transfert).
  const uncat = new Map<string, number>()
  for (const t of data.transactions) {
    if (t.transferGroupId) continue
    if (t.categoryId != null) continue
    uncat.set(t.bookingMonth, (uncat.get(t.bookingMonth) ?? 0) + 1)
  }

  // 4. Materialisation.
  const balanceRows: Record<string, unknown>[] = []
  for (const [accountId, balance] of balances) {
    balanceRows.push({
      user_id: userId,
      account_idx: await balanceIdx(keys, userId, accountId),
      enc_payload: bytesToPgHex(
        await encryptJson(keys, { accountId, balance } satisfies BalancePayload, [
          'account_balances',
          userId,
        ]),
      ),
    })
  }
  await insertChunked(admin, 'account_balances', balanceRows)

  const rollupRows: Record<string, unknown>[] = []
  for (const r of rollups.values()) {
    if (r.activity === 0 && r.assigned === 0) continue
    rollupRows.push({
      user_id: userId,
      rollup_idx: await rollupIdx(keys, userId, r.categoryId, r.month),
      month_idx: await rollupMonthIdx(keys, userId, r.month),
      enc_payload: bytesToPgHex(await encryptJson(keys, r, ['month_rollups', userId])),
    })
  }
  await insertChunked(admin, 'month_rollups', rollupRows)

  const uncatRows: Record<string, unknown>[] = []
  for (const [month, count] of uncat) {
    if (count <= 0) continue
    uncatRows.push({
      user_id: userId,
      month_idx: await uncatMonthIdx(keys, userId, month),
      enc_payload: bytesToPgHex(
        await encryptJson(keys, { month, count } satisfies UncatPayload, ['uncat_counts', userId]),
      ),
    })
  }
  await insertChunked(admin, 'uncat_counts', uncatRows)

  // 5. Bascule conditionnelle building -> ready : seulement si AUCUNE ecriture
  // concurrente n'a bumpe rev depuis la fence.
  const readyHex = bytesToPgHex(
    await encryptJson(keys, { version: AGG_VERSION, status: 'ready' } satisfies StatePayload, STATE_CTX(userId)),
  )
  const { data: upd, error: updErr } = await admin
    .from('aggregate_state')
    .update({ rev: guardRev + 1, enc_payload: readyHex, built_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('rev', guardRev)
    .select('user_id')
  if (updErr) throw new Error('ecriture aggregate_state impossible')
  if (upd && upd.length > 0) return true
  // Recompute perdant : nos inserts peuvent etre des parasites posterieurs a la
  // bascule d'un recompute gagnant concurrent -> invalidation (fallback sur).
  await aggMarkStale(admin, userId).catch(() => {})
  return false
}
