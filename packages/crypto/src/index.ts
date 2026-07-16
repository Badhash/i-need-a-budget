// Module de chiffrement — Web Crypto pur, zero dependance.
// Compatible Deno (Edge Functions Supabase) et Node >= 20 (tests Vitest).
//
// - deriveKeys : ENCRYPTION_KEY (32 bytes base64) -> HKDF-SHA256 ->
//   k_enc (AES-256-GCM, payloads) et k_idx (HMAC-SHA256, index aveugles).
// - encryptJson / decryptJson : enveloppe versionnee [version || IV 12B || ciphertext+tag].
// - blindIndex et derives : HMAC-SHA256 avec separation de domaine, sortie base64url.
//
// INTERDIT : logger des payloads dechiffres ou des cles.

const FORMAT_VERSION = 1
const IV_LENGTH = 12
const KEY_LENGTH = 32
const DOMAIN_SEP = '\u001f' // US (unit separator) : jamais present dans les valeurs jointes

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const HKDF_SALT = encoder.encode('inab-hkdf-salt-v1')
const INFO_ENC = encoder.encode('inab/enc/v1')
const INFO_IDX = encoder.encode('inab/idx/v1')

export interface CryptoKeys {
  /** AES-256-GCM — chiffrement des payloads */
  encKey: CryptoKey
  /** HMAC-SHA256 — index aveugles */
  idxKey: CryptoKey
}

// ---------------------------------------------------------------------------
// Encodages
// ---------------------------------------------------------------------------

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function base64Encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Uint8Array -> base64 standard, encodage de TRANSPORT de enc_payload.
 * ~1,33 caractere/octet contre 2 pour l'hex Postgres : -33% de volume sur tout
 * le trafic chiffre (lecture via computed column encode(...,'base64'), ecriture
 * via RPC decode(...,'base64')). Le ciphertext stocke reste identique.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return base64Encode(bytes)
}

/**
 * base64 standard -> Uint8Array (decodage transport de enc_payload).
 * Tolere les blancs : encode(...,'base64') de Postgres (RFC 2045) insere un
 * saut de ligne tous les 76 caracteres ; on les retire avant de valider.
 */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = b64.replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    throw new Error('base64 de transport invalide')
  }
  return base64Decode(s)
}

/** Uint8Array -> litteral bytea Postgres ('\x...') pour insertion via supabase-js */
export function bytesToPgHex(bytes: Uint8Array): string {
  let hex = '\\x'
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
  return hex
}

/** Litteral bytea Postgres ('\x...') -> Uint8Array */
export function pgHexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!hex.startsWith('\\x')) throw new Error('bytea attendu au format \\x hexadecimal')
  const body = hex.slice(2)
  if (body.length % 2 !== 0) throw new Error('bytea hexadecimal de longueur impaire')
  if (!/^[0-9a-fA-F]*$/.test(body)) throw new Error('bytea hexadecimal invalide')
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

// ---------------------------------------------------------------------------
// Derivation des cles
// ---------------------------------------------------------------------------

export async function deriveKeys(masterKeyB64: string): Promise<CryptoKeys> {
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = base64Decode(masterKeyB64.trim())
  } catch {
    throw new Error('ENCRYPTION_KEY : base64 invalide')
  }
  if (raw.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY : ${raw.length} octets decodes, ${KEY_LENGTH} attendus`)
  }
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  raw.fill(0)
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: INFO_ENC },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const idxKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: INFO_IDX },
    master,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  )
  return { encKey, idxKey }
}

// ---------------------------------------------------------------------------
// Chiffrement des payloads
// ---------------------------------------------------------------------------

/**
 * Contexte d'authentification (AAD) : lie le ciphertext a son emplacement
 * (ex. ['transactions', userId]) pour empecher l'echange de payloads entre
 * tables ou entre utilisateurs. Risque residuel assume : echange entre deux
 * lignes de la meme table du meme utilisateur, et rollback d'une ligne vers
 * une version anterieure.
 */
function buildAad(context: readonly string[]): Uint8Array {
  assertNoSeparator(context)
  return encoder.encode(['aad', String(FORMAT_VERSION), ...context].join(DOMAIN_SEP))
}

export async function encryptJson(
  keys: CryptoKeys,
  value: unknown,
  context: readonly string[],
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = encoder.encode(JSON.stringify(value))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: buildAad(context) },
      keys.encKey,
      plaintext,
    ),
  )
  const out = new Uint8Array(1 + IV_LENGTH + ciphertext.length)
  out[0] = FORMAT_VERSION
  out.set(iv, 1)
  out.set(ciphertext, 1 + IV_LENGTH)
  return out
}

export async function decryptJson<T>(
  keys: CryptoKeys,
  data: Uint8Array<ArrayBuffer>,
  context: readonly string[],
): Promise<T> {
  if (data.length < 1 + IV_LENGTH + 16) {
    throw new Error('payload chiffre tronque')
  }
  if (data[0] !== FORMAT_VERSION) {
    throw new Error(`version de payload inconnue : ${data[0]}`)
  }
  const iv = data.slice(1, 1 + IV_LENGTH)
  const ciphertext = data.slice(1 + IV_LENGTH)
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: buildAad(context) },
      keys.encKey,
      ciphertext,
    )
  } catch {
    // GCM : echec d'authentification (payload altere ou mauvaise cle)
    throw new Error('dechiffrement impossible : payload altere ou cle incorrecte')
  }
  return JSON.parse(decoder.decode(plaintext)) as T
}

// ---------------------------------------------------------------------------
// Index aveugles
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 des parties jointes par un separateur de domaine, en base64url.
 * La premiere partie est TOUJOURS une etiquette de domaine ('month', 'tx'...)
 * pour empecher toute collision entre familles d'index.
 */
function assertNoSeparator(parts: readonly string[]): void {
  for (const part of parts) {
    if (part.includes(DOMAIN_SEP)) {
      throw new Error('separateur de domaine interdit dans une valeur indexee')
    }
  }
}

export async function blindIndex(keys: CryptoKeys, parts: readonly string[]): Promise<string> {
  assertNoSeparator(parts)
  const mac = await crypto.subtle.sign('HMAC', keys.idxKey, encoder.encode(parts.join(DOMAIN_SEP)))
  return base64UrlEncode(new Uint8Array(mac))
}

/** Normalisation de libelle pour la dedup : minuscules, sans accents, espaces reduits. */
export function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Index mensuel des transactions (domaine distinct de celui des assignments). */
export function txMonthIdx(keys: CryptoKeys, userId: string, month: string): Promise<string> {
  return blindIndex(keys, ['tx-month', userId, month])
}

/** Index mensuel des assignments (domaine distinct de celui des transactions). */
export function assignMonthIdx(keys: CryptoKeys, userId: string, month: string): Promise<string> {
  return blindIndex(keys, ['assign-month', userId, month])
}

/** Dedup des imports bancaires : HMAC(compte + date + montant + libelle normalise). */
export function txHashIdx(
  keys: CryptoKeys,
  userId: string,
  accountId: string,
  bookingDate: string,
  amountCents: number,
  label: string,
): Promise<string> {
  return blindIndex(keys, [
    'tx',
    userId,
    accountId,
    bookingDate,
    String(amountCents),
    normalizeLabel(label),
  ])
}

export function assignIdx(
  keys: CryptoKeys,
  userId: string,
  categoryId: string,
  month: string,
): Promise<string> {
  return blindIndex(keys, ['assign', userId, categoryId, month])
}

export function targetIdx(keys: CryptoKeys, userId: string, categoryId: string): Promise<string> {
  return blindIndex(keys, ['target', userId, categoryId])
}
