// Web Push sans dependance (WebCrypto uniquement, Deno et navigateurs/Node).
//
//  - Chiffrement du message : RFC 8291 (Message Encryption for Web Push) sur
//    le codage de contenu aes128gcm (RFC 8188), un seul enregistrement.
//  - Authentification du serveur d'application : VAPID (RFC 8292), JWT ES256.
//  - Cle VAPID derivee de ENCRYPTION_KEY (HKDF, domaine dedie) : aucun nouveau
//    secret a configurer. Des secrets VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
//    (base64url, point non compresse / scalaire brut) priment s'ils existent.
//
// Le contenu d'une notification transite chiffre de bout en bout jusqu'a
// l'appareil : le service de push (Apple, Google, Mozilla) ne le lit pas.

const enc = new TextEncoder()

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

/** Importe une cle privee P-256 depuis son scalaire brut et son point public. */
async function importP256Private(
  d: Uint8Array,
  publicRaw: Uint8Array,
  usage: 'ECDH' | 'ECDSA',
): Promise<CryptoKey> {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error('cle publique P-256 invalide')
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: b64urlEncode(d),
    x: b64urlEncode(publicRaw.slice(1, 33)),
    y: b64urlEncode(publicRaw.slice(33, 65)),
    ext: true,
  }
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: usage, namedCurve: 'P-256' },
    false,
    usage === 'ECDH' ? ['deriveBits'] : ['sign'],
  )
}

// ---------------------------------------------------------------------------
// Cles VAPID
// ---------------------------------------------------------------------------

export interface VapidKeys {
  /** Point public non compresse (65 octets) en base64url : applicationServerKey. */
  publicKey: string
  signingKey: CryptoKey
}

// En-tete PKCS#8 d'une cle EC P-256 sans cle publique embarquee : le runtime
// recalcule le point public a l'import, ce qui evite toute arithmetique de
// courbe ici.
const PKCS8_P256_PREFIX = new Uint8Array([
  0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
  0x01, 0x04, 0x20,
])

async function publicFromScalar(d: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    concat(PKCS8_P256_PREFIX, d),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return concat(new Uint8Array([4]), b64urlDecode(jwk.x!), b64urlDecode(jwk.y!))
}

/** Cles VAPID depuis des secrets explicites (base64url). */
export async function vapidFromSecrets(publicKey: string, privateKey: string): Promise<VapidKeys> {
  const pub = b64urlDecode(publicKey)
  return { publicKey: b64urlEncode(pub), signingKey: await importP256Private(b64urlDecode(privateKey), pub, 'ECDSA') }
}

/**
 * Cles VAPID derivees de la cle maitre (base64 standard, 32 octets) : stables
 * tant que ENCRYPTION_KEY ne change pas, donc les abonnements restent valides
 * d'un deploiement a l'autre. Domaine HKDF dedie (independant de k_enc/k_idx).
 */
export async function deriveVapidKeys(masterKeyB64: string): Promise<VapidKeys> {
  const ikm = Uint8Array.from(atob(masterKeyB64), (c) => c.charCodeAt(0))
  // Un scalaire >= n (probabilite ~2^-32) est refuse a l'import : on derive
  // alors le candidat suivant.
  for (let i = 0; i < 8; i++) {
    const d = await hkdf(new Uint8Array(0), ikm, enc.encode(`inab/vapid/p256/${i}`), 32)
    try {
      const pub = await publicFromScalar(d)
      return { publicKey: b64urlEncode(pub), signingKey: await importP256Private(d, pub, 'ECDSA') }
    } catch {
      // candidat suivant
    }
  }
  throw new Error('derivation VAPID impossible')
}

/** En-tete Authorization VAPID (RFC 8292) pour l'origine du point de push. */
export async function vapidAuthorization(
  vapid: VapidKeys,
  endpoint: string,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64urlEncode(
    enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject })),
  )
  const unsigned = `${header}.${claims}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.signingKey,
    enc.encode(unsigned),
  )
  return `vapid t=${unsigned}.${b64urlEncode(new Uint8Array(sig))}, k=${vapid.publicKey}`
}

// ---------------------------------------------------------------------------
// Chiffrement du message (RFC 8291 / aes128gcm)
// ---------------------------------------------------------------------------

export interface PushTarget {
  /** Cle publique ECDH de l'agent utilisateur (base64url, 65 octets). */
  p256dh: string
  /** Secret d'authentification de l'abonnement (base64url, 16 octets). */
  auth: string
}

/** Parametres imposes (vecteurs de test uniquement) : sel et cle ephemere. */
export interface FixedSenderForTest {
  salt: Uint8Array
  privateKey: Uint8Array
  publicKey: Uint8Array
}

const RECORD_SIZE = 4096

/** Corps chiffre aes128gcm d'un message Web Push (un seul enregistrement). */
export async function encryptPushPayload(
  target: PushTarget,
  plaintext: Uint8Array,
  fixed?: FixedSenderForTest,
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(target.p256dh)
  const authSecret = b64urlDecode(target.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('abonnement push invalide')
  // Un enregistrement unique : contenu + delimiteur + tag doivent tenir dans rs.
  if (plaintext.length + 1 + 16 > RECORD_SIZE) throw new Error('message push trop long')

  let asPrivate: CryptoKey
  let asPublic: Uint8Array
  if (fixed) {
    asPrivate = await importP256Private(fixed.privateKey, fixed.publicKey, 'ECDH')
    asPublic = fixed.publicKey
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    asPrivate = pair.privateKey
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  }
  const salt = fixed ? fixed.salt : crypto.getRandomValues(new Uint8Array(16))

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256),
  )

  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic)
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  // Dernier (et seul) enregistrement : delimiteur 0x02, sans bourrage.
  const record = concat(plaintext, new Uint8Array([2]))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  )

  const header = new Uint8Array(16 + 4 + 1)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = asPublic.length
  return concat(header, asPublic, ciphertext)
}
