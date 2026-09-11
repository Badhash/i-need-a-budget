// Reglages utilisateur chiffres (REF M, table user_settings : 1 ligne / user).
// Partage entre /api et sync-bank. Contenu actuel : le mois de depart du
// budget (« Nouveau budget »). Table toleree absente : aucun reglage.
//
// INTERDIT : logger des payloads dechiffres ou la cle.

import {
  base64ToBytes,
  bytesToPgHex,
  decryptJson,
  encryptJson,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface UserSettings {
  /** Mois de depart du budget (YYYY-MM) ; null = budget depuis l'origine. */
  budgetStartMonth: string | null
}

const EMPTY: UserSettings = { budgetStartMonth: null }
const CTX = (userId: string) => ['user_settings', userId]

function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

export async function loadUserSettings(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await admin
    .from('user_settings')
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return EMPTY
    throw new Error('lecture user_settings impossible')
  }
  if (!data) return EMPTY
  const p = await decryptJson<Partial<UserSettings>>(
    keys,
    base64ToBytes(data.enc_payload as string),
    CTX(userId),
  )
  return { budgetStartMonth: p.budgetStartMonth ?? null }
}

export async function saveUserSettings(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const { error } = await admin.from('user_settings').upsert(
    {
      user_id: userId,
      enc_payload: bytesToPgHex(await encryptJson(keys, settings, CTX(userId))),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('table user_settings absente : appliquer M-user-settings.sql')
    }
    throw new Error('ecriture user_settings impossible')
  }
}

/** Supprime les reglages (retour au comportement historique). Table absente toleree. */
export async function clearUserSettings(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from('user_settings').delete().eq('user_id', userId)
  if (error && !isMissingTable(error)) throw new Error('effacement user_settings impossible')
}
