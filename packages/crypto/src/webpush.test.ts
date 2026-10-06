import { describe, expect, it } from 'vitest'
import {
  b64urlDecode,
  b64urlEncode,
  deriveVapidKeys,
  encryptPushPayload,
  vapidAuthorization,
  vapidFromSecrets,
} from './webpush'

// Vecteur de test officiel : RFC 8291, annexe A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

const MASTER = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7 + 1)))

// Dechiffrement cote agent utilisateur (reference de test, RFC 8291 section 3).
async function decryptAsUa(body: Uint8Array, uaPrivateD: string, uaPublic: string, auth: string) {
  const salt = body.slice(0, 16)
  const idlen = body[20]
  const asPublic = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)
  const ua = b64urlDecode(uaPublic)
  const priv = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: uaPrivateD,
      x: b64urlEncode(ua.slice(1, 33)),
      y: b64urlEncode(ua.slice(33)),
    },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, priv, 256))
  const hk = async (salt: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, len: number) => {
    const k = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
    const i = typeof info === 'string' ? new TextEncoder().encode(info) : info
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: i as BufferSource }, k, len * 8))
  }
  const keyInfo = new Uint8Array([...new TextEncoder().encode('WebPush: info\0'), ...ua, ...asPublic])
  const ikm = await hk(b64urlDecode(auth), secret, keyInfo, 32)
  const cek = await hk(salt, ikm, 'Content-Encoding: aes128gcm\0', 16)
  const nonce = await hk(salt, ikm, 'Content-Encoding: nonce\0', 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt'])
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext))
  expect(record[record.length - 1]).toBe(2)
  return new TextDecoder().decode(record.slice(0, -1))
}

describe('encryptPushPayload', () => {
  it('reproduit le vecteur de la RFC 8291', async () => {
    const body = await encryptPushPayload(
      { p256dh: RFC.uaPublic, auth: RFC.auth },
      new TextEncoder().encode(RFC.plaintext),
      {
        salt: b64urlDecode(RFC.salt),
        privateKey: b64urlDecode(RFC.asPrivate),
        publicKey: b64urlDecode(RFC.asPublic),
      },
    )
    expect(b64urlEncode(body)).toBe(RFC.body)
  })

  it('se dechiffre cote appareil avec une cle ephemere aleatoire', async () => {
    const message = JSON.stringify({ title: 'Synchro', body: '3 nouvelles transactions' })
    const a = await encryptPushPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(message))
    const b = await encryptPushPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new TextEncoder().encode(message))
    expect(b64urlEncode(a)).not.toBe(b64urlEncode(b))
    expect(await decryptAsUa(a, RFC.uaPrivate, RFC.uaPublic, RFC.auth)).toBe(message)
  })

  it('refuse un abonnement invalide ou un message trop long', async () => {
    await expect(encryptPushPayload({ p256dh: 'AAAA', auth: RFC.auth }, new Uint8Array(1))).rejects.toThrow()
    await expect(
      encryptPushPayload({ p256dh: RFC.uaPublic, auth: RFC.auth }, new Uint8Array(5000)),
    ).rejects.toThrow()
  })
})

describe('VAPID', () => {
  it('derive des cles stables depuis la cle maitre', async () => {
    const a = await deriveVapidKeys(MASTER)
    const b = await deriveVapidKeys(MASTER)
    expect(a.publicKey).toBe(b.publicKey)
    expect(b64urlDecode(a.publicKey)).toHaveLength(65)
    const other = await deriveVapidKeys(btoa(String.fromCharCode(...new Uint8Array(32).fill(9))))
    expect(other.publicKey).not.toBe(a.publicKey)
  })

  it('signe un JWT ES256 verifiable avec la cle publique', async () => {
    const vapid = await deriveVapidKeys(MASTER)
    const header = await vapidAuthorization(vapid, 'https://web.push.apple.com/abc', 'mailto:x@example.org', 1000)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(m).not.toBeNull()
    const [, h, c, s, k] = m!
    expect(k).toBe(vapid.publicKey)
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)))
    expect(claims).toEqual({ aud: 'https://web.push.apple.com', exp: 1000 + 12 * 3600, sub: 'mailto:x@example.org' })
    const pub = await crypto.subtle.importKey('raw', b64urlDecode(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ])
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      b64urlDecode(s),
      new TextEncoder().encode(`${h}.${c}`),
    )
    expect(ok).toBe(true)
  })

  it('accepte des secrets explicites', async () => {
    const vapid = await vapidFromSecrets(RFC.asPublic, RFC.asPrivate)
    expect(vapid.publicKey).toBe(RFC.asPublic)
  })
})
