import { describe, expect, it } from 'vitest'
import {
  assignIdx,
  base64Encode,
  blindIndex,
  bytesToPgHex,
  decryptJson,
  deriveKeys,
  encryptJson,
  txMonthIdx,
  assignMonthIdx,
  normalizeLabel,
  pgHexToBytes,
  txHashIdx,
} from './index.ts'

const KEY_A = base64Encode(new Uint8Array(32).fill(7))
const KEY_B = base64Encode(new Uint8Array(32).fill(8))
const USER = '11111111-1111-1111-1111-111111111111'
const CTX = ['transactions', USER]

describe('deriveKeys', () => {
  it('accepte une cle de 32 octets en base64', async () => {
    const keys = await deriveKeys(KEY_A)
    expect(keys.encKey.type).toBe('secret')
    expect(keys.idxKey.type).toBe('secret')
  })

  it('rejette une cle de mauvaise longueur', async () => {
    await expect(deriveKeys(base64Encode(new Uint8Array(16)))).rejects.toThrow('32 attendus')
    await expect(deriveKeys(base64Encode(new Uint8Array(64)))).rejects.toThrow('32 attendus')
  })

  it('rejette une cle qui n est pas du base64', async () => {
    await expect(deriveKeys('pas du base64 !!!')).rejects.toThrow('base64 invalide')
  })
})

describe('encryptJson / decryptJson', () => {
  it('fait l aller-retour sur un objet complexe (accents, montants negatifs)', async () => {
    const keys = await deriveKeys(KEY_A)
    const payload = {
      label: 'Boulangerie Chez Amélie — carte',
      amount: -1250,
      categoryId: null,
      nested: { notes: 'reçu n°42', tags: ['été', 'süß'] },
    }
    const encrypted = await encryptJson(keys, payload, CTX)
    const decrypted = await decryptJson<typeof payload>(keys, encrypted, CTX)
    expect(decrypted).toEqual(payload)
  })

  it('produit un chiffre different a chaque appel (IV aleatoire)', async () => {
    const keys = await deriveKeys(KEY_A)
    const a = await encryptJson(keys, { v: 1 }, CTX)
    const b = await encryptJson(keys, { v: 1 }, CTX)
    expect(base64Encode(a)).not.toBe(base64Encode(b))
    expect(await decryptJson(keys, a, CTX)).toEqual(await decryptJson(keys, b, CTX))
  })

  it('refuse un payload altere (authentification GCM)', async () => {
    const keys = await deriveKeys(KEY_A)
    const encrypted = await encryptJson(keys, { secret: 'valeur' }, CTX)
    encrypted[encrypted.length - 1] ^= 0xff
    await expect(decryptJson(keys, encrypted, CTX)).rejects.toThrow('altere ou cle incorrecte')
  })

  it('refuse le dechiffrement avec une autre cle', async () => {
    const keysA = await deriveKeys(KEY_A)
    const keysB = await deriveKeys(KEY_B)
    const encrypted = await encryptJson(keysA, { secret: 'valeur' }, CTX)
    await expect(decryptJson(keysB, encrypted, CTX)).rejects.toThrow('altere ou cle incorrecte')
  })

  it('refuse un payload tronque ou d une version inconnue', async () => {
    const keys = await deriveKeys(KEY_A)
    await expect(decryptJson(keys, new Uint8Array(5), CTX)).rejects.toThrow('tronque')
    const encrypted = await encryptJson(keys, { v: 1 }, CTX)
    encrypted[0] = 9
    await expect(decryptJson(keys, encrypted, CTX)).rejects.toThrow('version de payload inconnue')
  })
})

describe('index aveugles', () => {
  it('est deterministe pour les memes entrees', async () => {
    const keys = await deriveKeys(KEY_A)
    expect(await txMonthIdx(keys, USER, '2026-07')).toBe(await txMonthIdx(keys, USER, '2026-07'))
  })

  it('change avec le mois, l utilisateur, le domaine et la cle', async () => {
    const keysA = await deriveKeys(KEY_A)
    const keysB = await deriveKeys(KEY_B)
    const ref = await txMonthIdx(keysA, USER, '2026-07')
    expect(await txMonthIdx(keysA, USER, '2026-08')).not.toBe(ref)
    expect(await txMonthIdx(keysA, 'autre-user', '2026-07')).not.toBe(ref)
    expect(await assignMonthIdx(keysA, USER, '2026-07')).not.toBe(ref)
    expect(await txMonthIdx(keysB, USER, '2026-07')).not.toBe(ref)
  })

  it('separe les domaines meme avec des parties ambigues', async () => {
    const keys = await deriveKeys(KEY_A)
    // sans separateur, ['ab','c'] et ['a','bc'] seraient identiques
    expect(await blindIndex(keys, ['ab', 'c'])).not.toBe(await blindIndex(keys, ['a', 'bc']))
  })

  it('produit une sortie base64url sans caracteres speciaux', async () => {
    const keys = await deriveKeys(KEY_A)
    const idx = await assignIdx(keys, USER, 'cat-1', '2026-07')
    expect(idx).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('txHashIdx normalise le libelle (dedup stable)', async () => {
    const keys = await deriveKeys(KEY_A)
    const a = await txHashIdx(keys, USER, 'acc-1', '2026-07-10', -5800, 'SNCF  CONNECT ')
    const b = await txHashIdx(keys, USER, 'acc-1', '2026-07-10', -5800, 'sncf connect')
    expect(a).toBe(b)
    const c = await txHashIdx(keys, USER, 'acc-1', '2026-07-10', -5801, 'sncf connect')
    expect(c).not.toBe(a)
  })
})

describe('contexte AAD', () => {
  it('refuse un payload rejoue dans une autre table ou pour un autre utilisateur', async () => {
    const keys = await deriveKeys(KEY_A)
    const encrypted = await encryptJson(keys, { amount: -5000 }, ['transactions', USER])
    await expect(decryptJson(keys, encrypted, ['assignments', USER])).rejects.toThrow(
      'altere ou cle incorrecte',
    )
    await expect(decryptJson(keys, encrypted, ['transactions', 'autre-user'])).rejects.toThrow(
      'altere ou cle incorrecte',
    )
  })

  it('refuse un separateur de domaine dans le contexte ou un index', async () => {
    const keys = await deriveKeys(KEY_A)
    await expect(encryptJson(keys, {}, ['table\u001fpiege', USER])).rejects.toThrow('separateur')
    await expect(blindIndex(keys, ['tx', 'a\u001fb'])).rejects.toThrow('separateur')
  })

  it('neutralise les caracteres de controle dans les libelles indexes', async () => {
    const keys = await deriveKeys(KEY_A)
    const a = await txHashIdx(keys, USER, 'acc-1', '2026-07-10', -100, 'SNCF\u001fCONNECT')
    const b = await txHashIdx(keys, USER, 'acc-1', '2026-07-10', -100, 'sncf connect')
    expect(a).toBe(b)
  })
})

describe('normalizeLabel', () => {
  it('minuscules, accents supprimes, espaces reduits', () => {
    expect(normalizeLabel('  CARREFOUR   City ')).toBe('carrefour city')
    expect(normalizeLabel('Épargne Auto-Générée')).toBe('epargne auto-generee')
    expect(normalizeLabel('CAFÉ\t\tOBERKAMPF')).toBe('cafe oberkampf')
  })
})

describe('conversion bytea Postgres', () => {
  it('fait l aller-retour', () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255, 128])
    expect(pgHexToBytes(bytesToPgHex(bytes))).toEqual(bytes)
  })

  it('rejette les formats invalides', () => {
    expect(() => pgHexToBytes('deadbeef')).toThrow('format')
    expect(() => pgHexToBytes('\\xabc')).toThrow('impaire')
    expect(() => pgHexToBytes('\\xzz')).toThrow('invalide')
  })

  it('reste coherent avec un payload chiffre', async () => {
    const keys = await deriveKeys(KEY_A)
    const encrypted = await encryptJson(keys, { montant: 123456 }, CTX)
    const roundtrip = pgHexToBytes(bytesToPgHex(encrypted))
    expect(await decryptJson(keys, roundtrip, CTX)).toEqual({ montant: 123456 })
  })
})
