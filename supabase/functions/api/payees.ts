// Memoire de tiers chiffree (REF N, table payee_memory : 1 ligne / user / tiers).
// Partage entre /api et sync-bank. Chaque categorisation manuelle apprend le
// tiers (cle derivee du libelle, packages/crypto/src/payee.ts) ; les imports
// bancaires et le repli de applyRulesToUncategorized relisent la categorie par
// defaut apprise. Table toleree absente en lecture (memoire vide).
//
// Regle de defaut « 2 des 3 dernieres concordent » : l'historique garde les
// 3 dernieres categories (plus recente en tete) ; le defaut bascule vers X des
// que 2 entrees de l'historique valent X, sinon il reste inchange. Un choix
// isole ne fait donc pas changer d'avis la memoire, deux choix successifs oui.
//
// INTERDIT : logger des payloads dechiffres ou la cle.

import {
  base64ToBytes,
  bytesToPgHex,
  decryptJson,
  encryptJson,
  payeeIdx,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import { payeeKey } from '../../../packages/crypto/src/payee.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface PayeeMemory {
  /** Cle de tiers (payeeKey du libelle) : permet de re-derive l'index. */
  key: string
  /** Categorie par defaut proposee pour ce tiers. */
  categoryId: string
  /** 3 dernieres categories choisies, plus recente en tete. */
  history: string[]
}

const HISTORY_SIZE = 3
const CTX = (userId: string) => ['payee_memory', userId]
const TABLE = 'payee_memory'
const MISSING_MESSAGE = 'table payee_memory absente : appliquer N-payee-memory.sql'

function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

async function decode(keys: CryptoKeys, userId: string, b64: string): Promise<PayeeMemory> {
  const p = await decryptJson<Partial<PayeeMemory>>(keys, base64ToBytes(b64), CTX(userId))
  return {
    key: p.key ?? '',
    categoryId: p.categoryId ?? '',
    history: Array.isArray(p.history) ? p.history.slice(0, HISTORY_SIZE) : [],
  }
}

/**
 * Charge toute la memoire de tiers : Map cle de tiers -> categorie par defaut.
 * O(tiers), une seule lecture, petites lignes. Table absente = memoire vide.
 */
export async function loadPayeeDefaults(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data, error } = await admin
    .from(TABLE)
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
  if (error) {
    if (isMissingTable(error)) return out
    throw new Error('lecture payee_memory impossible')
  }
  for (const row of data ?? []) {
    const m = await decode(keys, userId, (row as { enc_payload: string }).enc_payload)
    if (m.key && m.categoryId) out.set(m.key, m.categoryId)
  }
  return out
}

async function loadOne(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  idx: string,
): Promise<PayeeMemory | null> {
  const { data, error } = await admin
    .from(TABLE)
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
    .eq('payee_idx', idx)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error('lecture payee_memory impossible')
  }
  if (!data) return null
  return decode(keys, userId, data.enc_payload as string)
}

async function upsertOne(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  idx: string,
  memory: PayeeMemory,
): Promise<void> {
  const { error } = await admin.from(TABLE).upsert(
    {
      user_id: userId,
      payee_idx: idx,
      enc_payload: bytesToPgHex(await encryptJson(keys, memory, CTX(userId))),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,payee_idx' },
  )
  if (error) {
    if (isMissingTable(error)) throw new Error(MISSING_MESSAGE)
    throw new Error('ecriture payee_memory impossible')
  }
}

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

/**
 * Apprend une categorisation manuelle. Libelle sans mot stable : no-op.
 * Leve une erreur explicite si la table est absente : les appelants qui
 * apprennent en passant (categorisation) DOIVENT l'avaler.
 */
export async function learnPayee(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  label: string,
  categoryId: string,
): Promise<void> {
  const key = payeeKey(label)
  if (!key) return
  const idx = await payeeIdx(keys, userId, key)
  const old = await loadOne(admin, keys, userId, idx)
  const history = [categoryId, ...(old?.history ?? [])].slice(0, HISTORY_SIZE)
  const fallback = old?.categoryId || categoryId
  await upsertOne(admin, keys, userId, idx, {
    key,
    categoryId: old ? pickDefault(history, fallback) : categoryId,
    history,
  })
}

/**
 * Force la categorie par defaut d'un tiers (historique remis a [categoryId]),
 * ou supprime la memoire de ce tiers si categoryId est null. Renvoie la cle.
 */
export async function setPayeeDefault(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  label: string,
  categoryId: string | null,
): Promise<string> {
  const key = payeeKey(label)
  if (!key) return key
  const idx = await payeeIdx(keys, userId, key)
  if (categoryId === null) {
    const { error } = await admin.from(TABLE).delete().eq('user_id', userId).eq('payee_idx', idx)
    if (error && !isMissingTable(error)) throw new Error('effacement payee_memory impossible')
    return key
  }
  await upsertOne(admin, keys, userId, idx, { key, categoryId, history: [categoryId] })
  return key
}

/** Efface toute la memoire de tiers (wipe / import de remplacement). Table absente toleree. */
export async function clearPayees(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from(TABLE).delete().eq('user_id', userId)
  if (error && !isMissingTable(error)) throw new Error('effacement payee_memory impossible')
}
